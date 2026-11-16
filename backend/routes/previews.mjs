import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { db, persist } from '../lib/store.mjs';
import { fail, str, rateLimit } from '../lib/http.mjs';
import { now, id, requireEdit, requireOwnerOrAdmin, canSee, findVisible, logActivity, userById, validMemberIds, notify } from '../lib/core.mjs';

function parseUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { fail(400, 'Enter a complete http or https URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail(400, 'Only http and https URLs are supported');
  if (url.username || url.password) fail(400, 'URLs with embedded credentials are not allowed');
  return url;
}

// Block loopback, private, link-local and metadata ranges so the checker cannot be used for SSRF.
function isPrivateAddress(address) {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true;
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return false;
  }
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const previewView = preview => ({ ...preview, owner: userById(preview.ownerId)?.name || 'Former member', project: db.projects.find(p => p.id === preview.projectId)?.name || null });

export default function register(router) {
  router.get('/api/previews', async ctx => db.previews.filter(p => canSee(p, ctx)).map(previewView));

  router.post('/api/previews', async ctx => {
    requireEdit(ctx);
    const url = parseUrl(ctx.body.url);
    const projectId = ctx.body.projectId && db.projects.some(p => p.id === ctx.body.projectId && p.workspaceId === ctx.workspace.id) ? ctx.body.projectId : null;
    const preview = {
      id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id, url: url.toString(),
      title: str(ctx.body.title || url.hostname, { min: 1, max: 120, field: 'Title' }), description: str(ctx.body.description, { max: 1000, field: 'Description' }),
      projectId, kind: ctx.body.kind === 'code-site' ? 'code-site' : 'url', codeProjectId: null,
      visibility: ctx.body.visibility === 'private' ? 'private' : 'workspace', sharedWith: [], createdAt: now(), updatedAt: now(),
    };
    if (preview.kind === 'code-site') {
      const code = db.codeProjects.find(p => p.id === ctx.body.codeProjectId && canSee(p, ctx));
      if (!code) fail(400, 'Choose a code project for the static site preview');
      preview.codeProjectId = code.id;
    }
    db.previews.unshift(preview);
    logActivity(ctx, 'added preview', 'preview', preview, { summary: preview.title });
    return [201, previewView(preview)];
  });

  router.patch('/api/previews/:id', async ctx => {
    requireEdit(ctx);
    const preview = findVisible('previews', ctx.params.id, ctx, 'Preview');
    if (ctx.body.url !== undefined && preview.kind !== 'code-site') preview.url = parseUrl(ctx.body.url).toString();
    if (ctx.body.title !== undefined) preview.title = str(ctx.body.title, { min: 1, max: 120, field: 'Title' });
    if (ctx.body.description !== undefined) preview.description = str(ctx.body.description, { max: 1000, field: 'Description' });
    if (ctx.body.projectId !== undefined) preview.projectId = ctx.body.projectId && db.projects.some(p => p.id === ctx.body.projectId && p.workspaceId === ctx.workspace.id) ? ctx.body.projectId : null;
    if (ctx.body.visibility !== undefined || ctx.body.sharedWith !== undefined) {
      requireOwnerOrAdmin(preview, ctx, 'change sharing');
      if (ctx.body.visibility !== undefined) preview.visibility = ctx.body.visibility === 'private' ? 'private' : 'workspace';
      if (ctx.body.sharedWith !== undefined) {
        const before = new Set(preview.sharedWith || []);
        preview.sharedWith = validMemberIds(ctx.body.sharedWith, ctx.workspace.id).filter(x => x !== preview.ownerId);
        const added = preview.sharedWith.filter(x => !before.has(x));
        if (added.length) notify(ctx, { kind: 'file', title: `${ctx.user.name} shared a preview with you`, body: preview.title, link: `/previews?preview=${preview.id}`, to: added });
      }
    }
    preview.updatedAt = now();
    persist();
    return previewView(preview);
  });

  router.delete('/api/previews/:id', async ctx => {
    requireEdit(ctx);
    const preview = findVisible('previews', ctx.params.id, ctx, 'Preview');
    if (preview.visibility === 'private') requireOwnerOrAdmin(preview, ctx, 'remove this preview');
    db.previews = db.previews.filter(p => p !== preview);
    logActivity(ctx, 'removed preview', 'preview', preview, { summary: preview.title });
    return { deleted: true };
  });

  /** Inspect framing headers so the UI can say honestly whether a site can be embedded. */
  router.post('/api/previews/check', async ctx => {
    rateLimit(`preview-check:${ctx.user.id}`, 20, 60_000);
    const url = parseUrl(ctx.body.url);
    let addresses;
    try { addresses = await lookup(url.hostname, { all: true }); } catch { return { reachable: false, embeddable: false, reason: 'The hostname could not be resolved' }; }
    if (addresses.some(a => isPrivateAddress(a.address))) return { reachable: null, embeddable: null, reason: 'Private or local addresses are not checked by the server. The preview will still try to load in your browser.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'ZyncklePreviewCheck/1.0' } });
      response.body?.cancel().catch(() => {});
      const xfo = (response.headers.get('x-frame-options') || '').toLowerCase();
      const csp = response.headers.get('content-security-policy') || '';
      const ancestors = csp.split(';').map(s => s.trim()).find(s => s.toLowerCase().startsWith('frame-ancestors'));
      let embeddable = true; let reason = 'No framing restrictions were detected';
      if (xfo.includes('deny') || xfo.includes('sameorigin')) { embeddable = false; reason = `The site sends X-Frame-Options: ${xfo.toUpperCase()}`; }
      else if (ancestors && !/\*|https?:/.test(ancestors.replace(/^frame-ancestors/i, ''))) { embeddable = false; reason = `The site restricts embedding (${ancestors})`; }
      const redirect = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      return { reachable: true, status: response.status, embeddable, reason: redirect ? `${reason}. The URL redirects to ${redirect}` : reason, https: url.protocol === 'https:' };
    } catch (error) {
      return { reachable: false, embeddable: false, reason: error.name === 'AbortError' ? 'The site did not respond within 8 seconds' : 'The site could not be reached from the server' };
    } finally { clearTimeout(timer); }
  });
}
