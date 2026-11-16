import { db, persist } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';
import { fail, str, readRaw, rateLimit, securityHeaders } from '../lib/http.mjs';
import { now, id, requireEdit, requireOwnerOrAdmin, canSee, findVisible, logActivity, notify, emit, userById, publicUser, validMemberIds, sign, verifySignature } from '../lib/core.mjs';
import { putObject, getObject, removeObject } from '../lib/storage.mjs';
import { readZip, writeZip, normalizeEntryPath } from '../lib/zip.mjs';
import { assertQuota, MIME, extension } from './files.mjs';

const MAX_FILE = 1_000_000;
const MAX_FILES_PER_PROJECT = 3000;
const VERSION_LIMIT = 10;

export const LANGUAGES = {
  java: 'Java', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', py: 'Python',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sql: 'SQL', json: 'JSON',
  yml: 'YAML', yaml: 'YAML', xml: 'XML', svg: 'XML', md: 'Markdown', php: 'PHP', go: 'Go', rs: 'Rust', rb: 'Ruby', kt: 'Kotlin', cs: 'C#',
  sh: 'Shell', toml: 'TOML', vue: 'Vue', svelte: 'Svelte', swift: 'Swift', gradle: 'Gradle', txt: 'Text',
};
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'avif', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'mp3', 'pdf']);
const SITE_MIME = { ...MIME, html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8', css: 'text/css;charset=utf-8', js: 'text/javascript;charset=utf-8', mjs: 'text/javascript;charset=utf-8', svg: 'image/svg+xml', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', json: 'application/json' };

const looksBinary = bytes => bytes.subarray(0, 8000).includes(0);
const projectAudience = project => project.visibility === 'private' ? [project.ownerId, ...(project.sharedWith || [])] : undefined;

function projectView(project) {
  const files = db.codeFiles.filter(f => f.codeProjectId === project.id);
  const languages = {};
  for (const file of files) if (file.language && file.language !== 'Text') languages[file.language] = (languages[file.language] || 0) + file.sizeBytes;
  return {
    ...project, owner: userById(project.ownerId)?.name || 'Former member', fileCount: files.length,
    sizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0), languages,
    hasSite: files.some(f => /(^|\/)index\.html?$/i.test(f.path)),
    sharedWithUsers: (project.sharedWith || []).map(userById).filter(Boolean).map(publicUser),
  };
}
const fileMeta = ({ storageKey, storage, versions, ...meta }) => ({ ...meta, versionCount: (versions || []).length });

function findProject(ctx, projectId) {
  return findVisible('codeProjects', projectId, ctx, 'Code project');
}
function findFile(ctx, fileId) {
  const file = db.codeFiles.find(f => f.id === fileId && f.workspaceId === ctx.workspace.id);
  if (!file || !canSee(db.codeProjects.find(p => p.id === file.codeProjectId), ctx)) fail(404, 'File not found');
  return file;
}

export const readCodeFile = file => getObject(file.storageKey, file.storage);

/** Add or replace one file; replacing keeps the previous content as a version. */
async function upsertFile(ctx, project, path, bytes) {
  const existing = db.codeFiles.find(f => f.codeProjectId === project.id && f.path === path);
  const binary = BINARY_EXT.has(extension(path)) || looksBinary(bytes);
  const storageKey = `code/${ctx.workspace.id}/${id()}`;
  const storage = await putObject(storageKey, bytes);
  const record = { storageKey, storage, sizeBytes: bytes.length, binary, updatedAt: now(), updatedBy: ctx.user.id };
  if (existing) {
    existing.versions = [{ storageKey: existing.storageKey, storage: existing.storage, sizeBytes: existing.sizeBytes, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy }, ...(existing.versions || [])];
    for (const old of existing.versions.splice(VERSION_LIMIT)) await removeObject(old.storageKey, old.storage);
    Object.assign(existing, record);
    return { file: existing, replaced: true };
  }
  if (db.codeFiles.filter(f => f.codeProjectId === project.id).length >= MAX_FILES_PER_PROJECT) fail(413, `Code projects are limited to ${MAX_FILES_PER_PROJECT} files`);
  const file = { id: id(), workspaceId: ctx.workspace.id, codeProjectId: project.id, path, language: LANGUAGES[extension(path)] || (binary ? 'Binary' : 'Text'), createdAt: now(), versions: [], ...record };
  db.codeFiles.push(file);
  return { file, replaced: false };
}

async function importArchive(ctx, project, buffer, stripRoot = false) {
  let entries; let skipped;
  try { ({ entries, skipped } = readZip(buffer, { maxEntryBytes: MAX_FILE, maxTotalBytes: config.maxZipBytes * 3 })); }
  catch (error) { fail(400, error.message); }
  // GitHub archives wrap everything in a single "repo-branch/" folder.
  const roots = new Set(entries.map(e => e.name.split('/')[0]));
  const strip = (stripRoot || roots.size === 1) && entries.every(e => e.name.includes('/'));
  assertQuota(ctx.workspace.id, entries.reduce((sum, e) => sum + e.data.length, 0));
  let added = 0; let replaced = 0;
  for (const entry of entries) {
    const path = strip ? entry.name.split('/').slice(1).join('/') : entry.name;
    if (!path) continue;
    const result = await upsertFile(ctx, project, path, entry.data);
    if (result.replaced) replaced++; else added++;
  }
  project.updatedAt = now();
  persist();
  return { added, replaced, skipped };
}

export default function register(router) {
  router.get('/api/code-projects', async ctx => db.codeProjects.filter(p => canSee(p, ctx)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).map(projectView));

  router.post('/api/code-projects', async ctx => {
    requireEdit(ctx);
    const project = {
      id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id,
      name: str(ctx.body.name, { min: 1, max: 100, field: 'Project name' }), description: str(ctx.body.description, { max: 2000, field: 'Description' }),
      projectId: ctx.body.projectId && db.projects.some(p => p.id === ctx.body.projectId && p.workspaceId === ctx.workspace.id) ? ctx.body.projectId : null,
      visibility: ctx.body.visibility === 'private' ? 'private' : 'workspace', sharedWith: [], repoUrl: '', createdAt: now(), updatedAt: now(),
    };
    db.codeProjects.unshift(project);
    logActivity(ctx, 'created code project', 'code', project, { private: project.visibility === 'private' });
    return [201, projectView(project)];
  });

  router.post('/api/code-projects/import-github', async ctx => {
    requireEdit(ctx);
    rateLimit(`github:${ctx.user.id}`, 5, 300_000);
    const match = String(ctx.body.url || '').trim().match(/^https:\/\/github\.com\/([\w.-]{1,100})\/([\w.-]{1,100}?)(?:\.git)?\/?(?:tree\/([\w./-]{1,100}))?$/);
    if (!match) fail(400, 'Enter a public repository URL like https://github.com/owner/repo');
    const [, owner, repo, treeBranch] = match;
    const branch = str(ctx.body.branch || treeBranch || '', { max: 100, field: 'Branch' }) || 'HEAD';
    if (!/^[\w./-]+$/.test(branch)) fail(400, 'Branch name is invalid');
    // Only codeload.github.com is contacted, so user input cannot redirect the server elsewhere.
    const response = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/${branch === 'HEAD' ? 'HEAD' : `refs/heads/${branch}`}`, { redirect: 'follow' }).catch(() => null);
    if (!response?.ok) fail(response?.status === 404 ? 404 : 502, response?.status === 404 ? 'Repository or branch not found (private repositories are not supported yet)' : 'GitHub could not be reached');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > config.maxZipBytes) fail(413, 'This repository archive is too large to import');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > config.maxZipBytes) fail(413, 'This repository archive is too large to import');
    const project = {
      id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id, name: ctx.body.name ? str(ctx.body.name, { min: 1, max: 100, field: 'Project name' }) : repo,
      description: `Imported from github.com/${owner}/${repo}${branch !== 'HEAD' ? ` (${branch})` : ''}`, projectId: null, visibility: 'workspace', sharedWith: [],
      repoUrl: `https://github.com/${owner}/${repo}`, branch, createdAt: now(), updatedAt: now(),
    };
    db.codeProjects.unshift(project);
    try {
      const result = await importArchive(ctx, project, buffer, true);
      logActivity(ctx, 'imported repository', 'code', project, { summary: `${owner}/${repo}` });
      return [201, { project: projectView(project), ...result }];
    } catch (error) {
      db.codeProjects = db.codeProjects.filter(p => p !== project);
      for (const file of db.codeFiles.filter(f => f.codeProjectId === project.id)) await removeObject(file.storageKey, file.storage);
      db.codeFiles = db.codeFiles.filter(f => f.codeProjectId !== project.id);
      throw error;
    }
  });

  router.get('/api/code-projects/:id', async ctx => projectView(findProject(ctx, ctx.params.id)));

  router.patch('/api/code-projects/:id', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    if (ctx.body.name !== undefined) project.name = str(ctx.body.name, { min: 1, max: 100, field: 'Project name' });
    if (ctx.body.description !== undefined) project.description = str(ctx.body.description, { max: 2000, field: 'Description' });
    if (ctx.body.projectId !== undefined) project.projectId = ctx.body.projectId && db.projects.some(p => p.id === ctx.body.projectId && p.workspaceId === ctx.workspace.id) ? ctx.body.projectId : null;
    if (ctx.body.visibility !== undefined || ctx.body.sharedWith !== undefined) {
      requireOwnerOrAdmin(project, ctx, 'change sharing');
      if (ctx.body.visibility !== undefined) project.visibility = ctx.body.visibility === 'private' ? 'private' : 'workspace';
      if (ctx.body.sharedWith !== undefined) {
        const before = new Set(project.sharedWith || []);
        project.sharedWith = validMemberIds(ctx.body.sharedWith, ctx.workspace.id).filter(x => x !== project.ownerId);
        const added = project.sharedWith.filter(x => !before.has(x));
        if (added.length) notify(ctx, { kind: 'file', title: `${ctx.user.name} shared a code project with you`, body: project.name, link: `/code/${project.id}`, to: added });
      }
      logActivity(ctx, 'changed sharing for', 'code', project, { audit: true, private: true });
    }
    project.updatedAt = now();
    persist();
    emit({ type: 'code.changed', workspaceId: ctx.workspace.id, audience: projectAudience(project), data: { id: project.id } });
    return projectView(project);
  });

  router.delete('/api/code-projects/:id', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    requireOwnerOrAdmin(project, ctx, 'delete this code project');
    for (const file of db.codeFiles.filter(f => f.codeProjectId === project.id)) {
      for (const version of [file, ...(file.versions || [])]) await removeObject(version.storageKey, version.storage);
    }
    db.codeFiles = db.codeFiles.filter(f => f.codeProjectId !== project.id);
    db.codeProjects = db.codeProjects.filter(p => p !== project);
    logActivity(ctx, 'deleted code project', 'code', project, { audit: true });
    return { deleted: true };
  });

  router.get('/api/code-projects/:id/files', async ctx => {
    const project = findProject(ctx, ctx.params.id);
    return db.codeFiles.filter(f => f.codeProjectId === project.id).sort((a, b) => a.path.localeCompare(b.path)).map(fileMeta);
  });

  router.post('/api/code-projects/:id/files', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    let raw;
    try { raw = decodeURIComponent(String(ctx.req.headers['x-file-path'] || '')); } catch { fail(400, 'File path is invalid'); }
    const path = normalizeEntryPath(raw);
    if (!path) fail(400, 'File path is invalid');
    const bytes = await readRaw(ctx.req, MAX_FILE);
    assertQuota(ctx.workspace.id, bytes.length);
    const { file, replaced } = await upsertFile(ctx, project, path, bytes);
    project.updatedAt = now();
    persist();
    return [replaced ? 200 : 201, { ...fileMeta(file), replaced }];
  }, { body: 'raw' });

  router.post('/api/code-projects/:id/zip', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    const buffer = await readRaw(ctx.req, config.maxZipBytes);
    const result = await importArchive(ctx, project, buffer);
    logActivity(ctx, `imported ${result.added + result.replaced} files into`, 'code', project);
    return result;
  }, { body: 'raw' });

  router.get('/api/code-projects/:id/search', async ctx => {
    const project = findProject(ctx, ctx.params.id);
    const q = String(ctx.query.get('q') || '').trim();
    if (q.length < 2) return { query: q, results: [] };
    const needle = q.toLowerCase();
    const results = [];
    let scanned = 0;
    for (const file of db.codeFiles.filter(f => f.codeProjectId === project.id && !f.binary)) {
      const pathHit = file.path.toLowerCase().includes(needle);
      const matches = [];
      if (file.sizeBytes <= MAX_FILE && scanned < 40_000_000) {
        scanned += file.sizeBytes;
        const lines = (await readCodeFile(file)).toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < 5; i++) if (lines[i].toLowerCase().includes(needle)) matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
      if (pathHit || matches.length) results.push({ fileId: file.id, path: file.path, pathHit, matches });
      if (results.length >= 60) break;
    }
    return { query: q, results };
  });

  router.get('/api/code-projects/:id/download', async ctx => {
    const project = findProject(ctx, ctx.params.id);
    const files = [];
    for (const file of db.codeFiles.filter(f => f.codeProjectId === project.id)) files.push({ name: file.path, data: await readCodeFile(file) });
    const zip = writeZip(files);
    ctx.res.writeHead(200, { ...securityHeaders(ctx.req), 'content-type': 'application/zip', 'content-length': zip.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(project.name.replace(/[^\w.-]+/g, '-'))}.zip`, 'cache-control': 'no-store' });
    ctx.res.end(zip);
  });

  router.get('/api/code-files/:id', async ctx => {
    const file = findFile(ctx, ctx.params.id);
    const version = ctx.query.get('version');
    const source = version !== null ? (file.versions || [])[Number(version)] : file;
    if (!source) fail(404, 'Version not found');
    if (file.binary) return { ...fileMeta(file), content: null };
    return { ...fileMeta(file), content: (await getObject(source.storageKey, source.storage)).toString('utf8'), version: version !== null ? Number(version) : null };
  });

  router.get('/api/code-files/:id/versions', async ctx => {
    const file = findFile(ctx, ctx.params.id);
    return [{ index: null, current: true, sizeBytes: file.sizeBytes, updatedAt: file.updatedAt, author: userById(file.updatedBy)?.name || 'Former member' },
      ...(file.versions || []).map((v, index) => ({ index, current: false, sizeBytes: v.sizeBytes, updatedAt: v.updatedAt, author: userById(v.updatedBy)?.name || 'Former member' }))];
  });

  router.get('/api/code-files/:id/raw', async ctx => {
    const file = findFile(ctx, ctx.params.id);
    const bytes = await readCodeFile(file);
    ctx.res.writeHead(200, { ...securityHeaders(ctx.req), 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split('/').pop())}` });
    ctx.res.end(bytes);
  });

  router.patch('/api/code-files/:id', async ctx => {
    requireEdit(ctx);
    const file = findFile(ctx, ctx.params.id);
    const path = normalizeEntryPath(String(ctx.body.path || ''));
    if (!path) fail(400, 'File path is invalid');
    if (db.codeFiles.some(f => f.codeProjectId === file.codeProjectId && f.path === path && f !== file)) fail(409, 'Another file already uses that path');
    file.path = path;
    file.language = LANGUAGES[extension(path)] || file.language;
    persist();
    return fileMeta(file);
  });

  router.delete('/api/code-files/:id', async ctx => {
    requireEdit(ctx);
    const file = findFile(ctx, ctx.params.id);
    for (const version of [file, ...(file.versions || [])]) await removeObject(version.storageKey, version.storage);
    db.codeFiles = db.codeFiles.filter(f => f !== file);
    persist();
    return { deleted: true };
  });

  // ---- Static site preview served from a code project ----
  router.get('/api/code-projects/:id/site', async ctx => {
    const project = findProject(ctx, ctx.params.id);
    const entry = db.codeFiles.filter(f => f.codeProjectId === project.id && /(^|\/)index\.html?$/i.test(f.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
    if (!entry) fail(404, 'Add an index.html file to preview this project as a static site');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${project.id}.${exp}.${sign(`site:${project.id}:${exp}`)}`;
    return { url: `/sites/${token}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, expiresIn: 3600, entry: entry.path };
  });

  /**
   * Files are served under a signed path so relative asset URLs keep working. The response
   * is sandboxed (opaque origin) so scripts in the site cannot reach Zynckle's storage or API.
   */
  router.get('/sites/:token/*', async ctx => {
    const [projectId, exp, sig] = ctx.params.token.split('.');
    if (!projectId || !verifySignature(`site:${projectId}`, exp, sig)) fail(403, 'This preview link has expired');
    const path = normalizeEntryPath(ctx.params.rest || 'index.html');
    const file = path && db.codeFiles.find(f => f.codeProjectId === projectId && (f.path === path || f.path === `${path}/index.html`));
    if (!file) {
      ctx.res.writeHead(404, { 'content-type': 'text/plain;charset=utf-8', 'content-security-policy': 'sandbox' });
      return ctx.res.end('Not found in this code project');
    }
    const bytes = await readCodeFile(file);
    ctx.res.writeHead(200, {
      'content-type': SITE_MIME[extension(file.path)] || 'application/octet-stream', 'content-length': bytes.length,
      'content-security-policy': "sandbox allow-scripts allow-forms allow-popups; default-src 'self' 'unsafe-inline' data: blob: https:; connect-src https:",
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'private, max-age=60',
    });
    ctx.res.end(bytes);
  }, { auth: false });
}
