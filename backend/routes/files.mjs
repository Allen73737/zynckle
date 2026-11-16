import { db, persist } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';
import { fail, str, readRaw, securityHeaders } from '../lib/http.mjs';
import { now, id, requireEdit, requireOwnerOrAdmin, canSee, findVisible, logActivity, notify, emit, userById, publicUser, validMemberIds, signedPath, verifySignature } from '../lib/core.mjs';
import { putObject, getObject, removeObject, storageDriver } from '../lib/storage.mjs';

const TEXT = 'text/plain;charset=utf-8';
export const MIME = {
  txt: TEXT, md: 'text/markdown;charset=utf-8', mdx: 'text/markdown;charset=utf-8', csv: 'text/csv;charset=utf-8', json: 'application/json', log: TEXT,
  js: TEXT, jsx: TEXT, mjs: TEXT, cjs: TEXT, ts: TEXT, tsx: TEXT, py: TEXT, java: TEXT, kt: TEXT, c: TEXT, h: TEXT, cpp: TEXT, hpp: TEXT, cc: TEXT, cs: TEXT,
  html: TEXT, htm: TEXT, css: TEXT, scss: TEXT, sql: TEXT, yml: TEXT, yaml: TEXT, xml: TEXT, php: TEXT, go: TEXT, rs: TEXT, rb: TEXT, swift: TEXT,
  sh: TEXT, toml: TEXT, ini: TEXT, env: TEXT, tex: TEXT, bib: TEXT, vue: TEXT, svelte: TEXT, gradle: TEXT, dockerfile: TEXT,
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed',
  fig: 'application/octet-stream', sketch: 'application/octet-stream', psd: 'image/vnd.adobe.photoshop', ttf: 'font/ttf', woff2: 'font/woff2',
};
// Never accept native executables or installer formats, even though nothing is ever executed.
const BLOCKED = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'jar', 'apk', 'dll', 'dmg', 'app', 'deb', 'rpm', 'lnk']);
// Content types the browser may render inline from a signed URL. SVG and HTML are always downloads.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|video\/|audio\/|text\/plain|text\/markdown|text\/csv|application\/json)/;

export const isText = mime => mime.startsWith('text/') || mime === 'application/json';
export const extension = name => (name.includes('.') ? name.split('.').pop().toLowerCase() : name.toLowerCase());

export function validFileName(raw) {
  const name = str(raw, { min: 1, max: 180, field: 'File name' });
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name === '.' || name === '..') fail(400, 'File name contains unsupported characters');
  return name;
}

export function workspaceUsage(workspaceId) {
  const drive = db.files.filter(f => f.workspaceId === workspaceId).reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  const code = db.codeFiles.filter(f => f.workspaceId === workspaceId).reduce((sum, f) => sum + (f.sizeBytes || 0) + (f.versions || []).reduce((s, v) => s + (v.sizeBytes || 0), 0), 0);
  return { drive, code, total: drive + code };
}
export function assertQuota(workspaceId, adding) {
  if (workspaceUsage(workspaceId).total + adding > config.quotaBytes) fail(413, `This workspace has reached its ${Math.round(config.quotaBytes / 1048576)} MB storage quota`);
}

const fileView = file => {
  const { content, storageKey, storage, ...meta } = file;
  return { ...meta, owner: userById(file.ownerId)?.name || 'Former member', sharedWithUsers: (file.sharedWith || []).map(userById).filter(Boolean).map(publicUser) };
};
const fileAudience = file => file.visibility === 'private' ? [file.ownerId, ...(file.sharedWith || [])] : undefined;

async function fileBytes(file) {
  if (file.storageKey) return getObject(file.storageKey, file.storage);
  return Buffer.from(file.content || '', 'utf8');
}

async function storeFile(ctx, name, bytes, folderId) {
  const ext = extension(name);
  if (BLOCKED.has(ext)) fail(415, `.${ext} files are not allowed`);
  if (bytes.length > config.maxUploadBytes) fail(413, `Files are limited to ${Math.round(config.maxUploadBytes / 1048576)} MB`);
  assertQuota(ctx.workspace.id, bytes.length);
  if (folderId && !db.folders.some(f => f.id === folderId && f.workspaceId === ctx.workspace.id)) fail(400, 'Folder not found');
  const fileId = id();
  const storageKey = `files/${ctx.workspace.id}/${fileId}`;
  const storage = await putObject(storageKey, bytes);
  const file = {
    id: fileId, workspaceId: ctx.workspace.id, ownerId: ctx.user.id, folderId: folderId || null, name,
    mimeType: MIME[ext] || 'application/octet-stream', sizeBytes: bytes.length, storageKey, storage,
    visibility: 'workspace', sharedWith: [], createdAt: now(), updatedAt: now(),
  };
  db.files.unshift(file);
  logActivity(ctx, 'uploaded', 'file', file, { summary: name });
  emit({ type: 'file.changed', workspaceId: ctx.workspace.id, data: fileView(file) });
  return file;
}

export default function register(router) {
  router.get('/api/files', async ctx => db.files.filter(f => canSee(f, ctx)).map(fileView));

  // Legacy JSON upload (base64 or text) for small files.
  router.post('/api/files', async ctx => {
    requireEdit(ctx);
    const name = validFileName(ctx.body.name);
    let bytes;
    if (typeof ctx.body.contentBase64 === 'string') {
      bytes = Buffer.from(ctx.body.contentBase64, 'base64');
      if (bytes.toString('base64').replace(/=+$/, '') !== ctx.body.contentBase64.replace(/=+$/, '')) fail(400, 'File data is invalid');
    } else if (typeof ctx.body.content === 'string') bytes = Buffer.from(ctx.body.content, 'utf8');
    else fail(400, 'File content is required');
    const file = await storeFile(ctx, name, bytes, typeof ctx.body.folderId === 'string' ? ctx.body.folderId : null);
    return [201, fileView(file)];
  });

  // Streaming binary upload: body is the raw file, metadata travels in headers.
  router.post('/api/files/upload', async ctx => {
    requireEdit(ctx);
    let name;
    try { name = decodeURIComponent(String(ctx.req.headers['x-file-name'] || '')); } catch { fail(400, 'File name is invalid'); }
    name = validFileName(name);
    const bytes = await readRaw(ctx.req, config.maxUploadBytes);
    const folderId = String(ctx.req.headers['x-folder-id'] || '') || null;
    const file = await storeFile(ctx, name, bytes, folderId);
    return [201, fileView(file)];
  }, { body: 'raw' });

  router.get('/api/files/:id', async ctx => {
    const file = findVisible('files', ctx.params.id, ctx, 'File');
    const view = fileView(file);
    if (isText(file.mimeType || TEXT) && file.sizeBytes <= 1_500_000) return { ...view, content: (await fileBytes(file)).toString('utf8') };
    return { ...view, url: signedPath(`/api/files/${file.id}/content`, `file:${file.id}`) };
  });

  router.get('/api/files/:id/url', async ctx => {
    const file = findVisible('files', ctx.params.id, ctx, 'File');
    return { url: signedPath(`/api/files/${file.id}/content`, `file:${file.id}`), expiresIn: 600 };
  });

  // Signed, short-lived URL usable directly by <img>, <video> and <iframe>.
  router.get('/api/files/:id/content', async ctx => {
    if (!verifySignature(`file:${ctx.params.id}`, ctx.query.get('exp'), ctx.query.get('sig'))) fail(403, 'This file link has expired');
    const file = db.files.find(f => f.id === ctx.params.id);
    if (!file) fail(404, 'File not found');
    const bytes = await fileBytes(file);
    const mime = file.mimeType || 'application/octet-stream';
    const inline = INLINE.test(mime) && ctx.query.get('download') !== '1';
    ctx.res.writeHead(200, {
      ...securityHeaders(ctx.req),
      'content-type': mime.startsWith('text/') && !mime.includes('charset') ? `${mime};charset=utf-8` : mime,
      'content-length': bytes.length,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': 'private, max-age=300',
    });
    ctx.res.end(bytes);
  }, { auth: false });

  router.get('/api/files/:id/download', async ctx => {
    const file = findVisible('files', ctx.params.id, ctx, 'File');
    const bytes = await fileBytes(file);
    ctx.res.writeHead(200, {
      ...securityHeaders(ctx.req), 'content-type': file.mimeType || 'application/octet-stream', 'content-length': bytes.length,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'cache-control': 'private, no-store',
    });
    ctx.res.end(bytes);
  });

  router.patch('/api/files/:id', async ctx => {
    requireEdit(ctx);
    const file = findVisible('files', ctx.params.id, ctx, 'File');
    if (ctx.body.name !== undefined) {
      const name = validFileName(ctx.body.name);
      if (BLOCKED.has(extension(name))) fail(415, 'That file extension is not allowed');
      file.name = name;
      file.mimeType = MIME[extension(name)] || file.mimeType;
    }
    if (Object.hasOwn(ctx.body, 'folderId')) {
      const folderId = typeof ctx.body.folderId === 'string' && ctx.body.folderId ? ctx.body.folderId : null;
      if (folderId && !db.folders.some(f => f.id === folderId && f.workspaceId === ctx.workspace.id)) fail(400, 'Folder not found');
      file.folderId = folderId;
    }
    if (ctx.body.visibility !== undefined || ctx.body.sharedWith !== undefined) {
      requireOwnerOrAdmin(file, ctx, 'change sharing');
      if (ctx.body.visibility !== undefined) file.visibility = ctx.body.visibility === 'private' ? 'private' : 'workspace';
      if (ctx.body.sharedWith !== undefined) {
        const before = new Set(file.sharedWith || []);
        file.sharedWith = validMemberIds(ctx.body.sharedWith, ctx.workspace.id).filter(x => x !== file.ownerId);
        const added = file.sharedWith.filter(x => !before.has(x));
        if (added.length) notify(ctx, { kind: 'file', title: `${ctx.user.name} shared a file with you`, body: file.name, link: `/drive?file=${file.id}`, to: added });
      }
      logActivity(ctx, 'changed sharing for', 'file', file, { summary: file.name, audit: true, private: true });
    }
    file.updatedAt = now();
    persist();
    emit({ type: 'file.changed', workspaceId: ctx.workspace.id, audience: fileAudience(file), data: fileView(file) });
    return fileView(file);
  });

  router.delete('/api/files/:id', async ctx => {
    requireEdit(ctx);
    const file = findVisible('files', ctx.params.id, ctx, 'File');
    if (file.visibility === 'private') requireOwnerOrAdmin(file, ctx, 'delete this file');
    if (file.storageKey) await removeObject(file.storageKey, file.storage);
    db.files = db.files.filter(f => f !== file);
    logActivity(ctx, 'deleted', 'file', file, { summary: file.name, private: file.visibility === 'private' });
    emit({ type: 'file.deleted', workspaceId: ctx.workspace.id, audience: fileAudience(file), data: { id: file.id } });
    return { deleted: true };
  });

  router.get('/api/storage/usage', async ctx => {
    const usage = workspaceUsage(ctx.workspace.id);
    const byType = {};
    for (const file of db.files.filter(f => f.workspaceId === ctx.workspace.id)) {
      const mime = file.mimeType || '';
      const group = mime.startsWith('image/') ? 'Images' : mime.startsWith('video/') || mime.startsWith('audio/') ? 'Media' : mime === 'application/pdf' || mime.includes('officedocument') || mime.includes('msword') ? 'Documents' : mime.includes('zip') || mime.includes('tar') || mime.includes('7z') ? 'Archives' : isText(mime) ? 'Text & source' : 'Other';
      byType[group] = (byType[group] || 0) + (file.sizeBytes || 0);
    }
    if (usage.code) byType['Code projects'] = usage.code;
    return { usedBytes: usage.total, quotaBytes: config.quotaBytes, fileCount: db.files.filter(f => f.workspaceId === ctx.workspace.id).length, byType, driver: storageDriver, maxUploadBytes: config.maxUploadBytes };
  });

  // ---- Drive folders ----
  router.get('/api/folders', async ctx => db.folders.filter(f => f.workspaceId === ctx.workspace.id));

  router.post('/api/folders', async ctx => {
    requireEdit(ctx);
    const name = str(ctx.body.name, { min: 1, max: 80, field: 'Folder name' });
    const parentId = typeof ctx.body.parentId === 'string' && ctx.body.parentId ? ctx.body.parentId : null;
    if (parentId && !db.folders.some(f => f.id === parentId && f.workspaceId === ctx.workspace.id)) fail(400, 'Parent folder not found');
    if (db.folders.some(f => f.workspaceId === ctx.workspace.id && f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase())) fail(409, 'A folder with this name already exists here');
    const folder = { id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id, parentId, name, createdAt: now() };
    db.folders.push(folder);
    persist();
    return [201, folder];
  });

  router.patch('/api/folders/:id', async ctx => {
    requireEdit(ctx);
    const folder = db.folders.find(f => f.id === ctx.params.id && f.workspaceId === ctx.workspace.id);
    if (!folder) fail(404, 'Folder not found');
    if (ctx.body.name !== undefined) {
      const name = str(ctx.body.name, { min: 1, max: 80, field: 'Folder name' });
      if (db.folders.some(f => f.workspaceId === ctx.workspace.id && f.parentId === folder.parentId && f.id !== folder.id && f.name.toLowerCase() === name.toLowerCase())) fail(409, 'A folder with this name already exists here');
      folder.name = name;
    }
    if (Object.hasOwn(ctx.body, 'parentId')) {
      const parentId = typeof ctx.body.parentId === 'string' && ctx.body.parentId ? ctx.body.parentId : null;
      let parent = parentId ? db.folders.find(f => f.id === parentId && f.workspaceId === ctx.workspace.id) : null;
      if (parentId && !parent) fail(400, 'Parent folder not found');
      while (parent) { if (parent.id === folder.id) fail(400, 'A folder cannot be moved into itself'); parent = db.folders.find(f => f.id === parent.parentId) || null; }
      folder.parentId = parentId;
    }
    folder.updatedAt = now();
    persist();
    return folder;
  });

  router.delete('/api/folders/:id', async ctx => {
    requireEdit(ctx);
    const folder = db.folders.find(f => f.id === ctx.params.id && f.workspaceId === ctx.workspace.id);
    if (!folder) fail(404, 'Folder not found');
    for (const child of db.folders) if (child.parentId === folder.id) child.parentId = folder.parentId || null;
    for (const file of db.files) if (file.folderId === folder.id) file.folderId = folder.parentId || null;
    db.folders = db.folders.filter(f => f !== folder);
    persist();
    return { deleted: true, contentsMoved: true };
  });
}
