import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { config } from './lib/config.mjs';
import { loadStore, flush } from './lib/store.mjs';
import { Router, HttpError, sendJson, readJson, securityHeaders } from './lib/http.mjs';
import { sessionFor, resolveWorkspace } from './lib/core.mjs';
import { attachRealtime, flushRealtime } from './lib/realtime.mjs';
import { storageDriver } from './lib/storage.mjs';
import { aiStatus } from './lib/ai.mjs';
import auth from './routes/auth.mjs';
import workspaces from './routes/workspaces.mjs';
import projects, { runDeadlineReminders } from './routes/projects.mjs';
import documents from './routes/documents.mjs';
import files from './routes/files.mjs';
import code from './routes/code.mjs';
import previews from './routes/previews.mjs';
import ai from './routes/ai.mjs';
import notifications from './routes/notifications.mjs';

await loadStore();

const router = new Router();
router.get('/api/health', async () => ({ status: 'ok', service: 'zynckle-api', persistence: 'file', storage: storageDriver, ai: aiStatus().available, realtime: true }), { auth: false });
for (const register of [auth, workspaces, projects, documents, files, code, previews, ai, notifications]) register(router);

// Serve the built frontend (frontend/dist) when present, with SPA fallback.
const distDir = resolve(import.meta.dirname, '..', 'frontend', 'dist');
const staticTypes = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
async function serveStatic(req, res, pathname) {
  const target = normalize(join(distDir, decodeURIComponent(pathname)));
  if (!target.startsWith(distDir)) return false;
  let file = target;
  try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = join(distDir, 'index.html'); }
  try {
    const body = await readFile(file);
    const isIndex = file.endsWith('index.html');
    res.writeHead(200, {
      'content-type': staticTypes[extname(file)] || 'application/octet-stream',
      'cache-control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' https: http: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(body);
    return true;
  } catch { return false; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'OPTIONS') { res.writeHead(204, securityHeaders(req)); return res.end(); }
  const pathname = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const found = router.match(req.method, pathname);
  if (!found) {
    if (req.method === 'GET' && !pathname.startsWith('/api/') && await serveStatic(req, res, pathname)) return;
    return sendJson(req, res, 404, { error: 'Route not found' });
  }
  if (found === 'method') return sendJson(req, res, 405, { error: 'Method not allowed' });
  const { route, params } = found;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ctx = { req, res, url, query: url.searchParams, params, token, body: {} };
  try {
    const session = token ? sessionFor(token) : null;
    if (route.options.auth !== false && !session) throw new HttpError(401, 'Sign in required');
    if (session) Object.assign(ctx, { user: session.user, session: session.session }, resolveWorkspace(session.user));
    if (route.options.body !== 'raw' && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) ctx.body = await readJson(req);
    const result = await route.handler(ctx);
    if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
    if (route.options.redirect && result?.redirect) { res.writeHead(302, { location: result.redirect, 'cache-control': 'no-store' }); return res.end(); }
    const [status, data] = Array.isArray(result) && typeof result[0] === 'number' && result.length === 2 ? result : [200, result];
    sendJson(req, res, status, data ?? {});
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(`${req.method} ${url.pathname}`, error);
    if (res.headersSent) { res.end(); return; }
    if (route.options.redirect) { res.writeHead(302, { location: `${config.publicUrl}/signin?error=${encodeURIComponent(error.message || 'Sign-in failed')}` }); return res.end(); }
    const status = error instanceof HttpError ? error.status : 500;
    const headers = error.extra?.retryAfter ? { 'retry-after': String(error.extra.retryAfter) } : {};
    if (headers['retry-after']) res.setHeader('retry-after', headers['retry-after']);
    sendJson(req, res, status, { error: error instanceof HttpError ? error.message : 'Something went wrong on the server', ...(error.extra || {}) });
  }
});

server.requestTimeout = 120_000;
attachRealtime(server);

runDeadlineReminders();
setInterval(runDeadlineReminders, 30 * 60_000).unref();

server.listen(config.port, config.host, () => {
  console.log(`Zynckle API listening on http://${config.host}:${config.port}`);
  console.log(`  storage: ${storageDriver} · AI: ${aiStatus().available ? aiStatus().provider : 'not configured'} · data: ${config.dataFile}`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await flushRealtime().catch(() => {});
  await flush().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
