import { config } from './config.mjs';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export function securityHeaders(req) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-resource-policy': 'same-origin',
  };
  const origin = req.headers.origin;
  if (origin && config.origins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET,POST,PATCH,PUT,DELETE,OPTIONS';
    headers['access-control-allow-headers'] = 'content-type,authorization,x-file-name,x-file-path,x-folder-id';
    headers.vary = 'Origin';
  }
  return headers;
}

export function sendJson(req, res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { ...securityHeaders(req), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(status === 204 ? undefined : JSON.stringify(data));
}

export function readJson(req, limit = 3_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** Buffer a raw request body, rejecting as soon as it passes the limit. */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, `Upload exceeds the ${Math.round(limit / 1048576)} MB limit`)); req.resume(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, `Upload exceeds the ${Math.round(limit / 1048576)} MB limit`)); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export class Router {
  routes = [];
  add(method, pattern, handler, options = {}) {
    const keys = [];
    const source = pattern.replace(/\*$/, '(.*)').replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
    if (pattern.endsWith('*')) keys.push('rest');
    this.routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, options });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  patch(p, h, o) { this.add('PATCH', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  delete(p, h, o) { this.add('DELETE', p, h, o); }
  match(method, path) {
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.regex.exec(path);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1] || ''); });
      return { route, params };
    }
    return pathMatched ? 'method' : null;
  }
}

// Sliding-window limiter kept in memory; adequate for a single API process.
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter(time => now - time < windowMs);
  if (hits.length >= limit) {
    const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
    throw new HttpError(429, `Too many requests. Try again in ${retry} seconds.`, { retryAfter: retry });
  }
  hits.push(now);
  buckets.set(key, hits);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) if (!hits.length || now - hits[hits.length - 1] > 86_400_000) buckets.delete(key);
}, 600_000).unref();

export function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

// Shared validation helpers used across route modules.
export const str = (value, { max = 1000, min = 0, field = 'Value', trim = true } = {}) => {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(400, `${field} must be text`);
  const result = trim ? value.trim() : value;
  if (result.length < min) fail(400, min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (result.length > max) fail(400, `${field} is limited to ${max} characters`);
  return result;
};
export const oneOf = (value, allowed, field = 'Value') => {
  if (!allowed.includes(value)) fail(400, `Unknown ${field.toLowerCase()}`);
  return value;
};
export const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
export const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value));
