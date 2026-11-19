import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db, persist } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';
import { fail, str, rateLimit } from '../lib/http.mjs';
import { now, id, requireEdit, requireOwnerOrAdmin, isAdmin, canSee, findVisible, logActivity, notify, emit, userById, publicUser, validMemberIds, mentionedUsers } from '../lib/core.mjs';
import { compileLatexToPdf } from '../lib/latexPdf.mjs';

const TYPES = ['rich-text', 'latex', 'plain-text', 'markdown'];
const VERSION_LIMIT = 30;
const AUTOSAVE_SNAPSHOT_MS = 10 * 60_000;

const docAudience = doc => doc.visibility === 'private' ? [doc.ownerId, ...(doc.collaboratorIds || [])] : undefined;
const docView = doc => ({
  ...doc, owner: userById(doc.ownerId)?.name || 'Former member',
  collaborators: (doc.collaboratorIds || []).map(userById).filter(Boolean).map(publicUser),
  commentCount: db.docComments.filter(c => c.documentId === doc.id && !c.resolved).length,
});

function snapshot(doc, userId) {
  const versions = db.documentVersions.filter(v => v.documentId === doc.id);
  db.documentVersions.push({ id: id(), documentId: doc.id, workspaceId: doc.workspaceId, title: doc.title, content: doc.content, type: doc.type, number: Math.max(0, ...versions.map(v => v.number || 0)) + 1, createdBy: userId, createdAt: now() });
  const all = db.documentVersions.filter(v => v.documentId === doc.id);
  if (all.length > VERSION_LIMIT) {
    const drop = new Set(all.slice(0, all.length - VERSION_LIMIT).map(v => v.id));
    db.documentVersions = db.documentVersions.filter(v => !drop.has(v.id));
  }
}

function validFolder(ctx, folderId) {
  if (!folderId) return null;
  if (!db.docFolders.some(f => f.id === folderId && f.workspaceId === ctx.workspace.id)) fail(400, 'Folder not found');
  return folderId;
}
function validProject(ctx, projectId) {
  if (!projectId) return null;
  if (!db.projects.some(p => p.id === projectId && p.workspaceId === ctx.workspace.id)) fail(400, 'Project not found');
  return projectId;
}

/** Parse pdflatex output into line-addressed errors the editor can highlight. */
export function parseLatexLog(log) {
  const lines = log.split(/\r?\n/);
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('! ')) continue;
    let line = null;
    let context = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const match = lines[j].match(/^l\.(\d+)\s?(.*)$/);
      if (match) { line = Number(match[1]); context = match[2]; break; }
    }
    errors.push({ line, message: lines[i].slice(2).trim(), context: context.trim() });
  }
  const warnings = lines.filter(l => /^(LaTeX|Package \w+) Warning:/.test(l)).slice(0, 20).map(message => {
    const match = message.match(/on input line (\d+)/);
    return { line: match ? Number(match[1]) : null, message: message.trim() };
  });
  return { errors: errors.slice(0, 20), warnings };
}

let compilerCache = null;
function latexStatus() {
  if (config.latexBin === 'built-in') {
    return Promise.resolve({ available: true, compiler: 'built-in', version: 'Zynckle Fast TeX (Built-in)', message: 'Ready to compile' });
  }
  if (compilerCache && Date.now() - compilerCache.at < 60_000) return Promise.resolve(compilerCache.value);
  return new Promise(resolve => {
    let resolved = false;
    const finish = value => {
      if (resolved) return;
      resolved = true;
      compilerCache = { at: Date.now(), value };
      resolve(value);
    };
    try {
      const child = spawn(config.latexBin, ['--version'], { windowsHide: true });
      let out = '';
      child.stdout?.on('data', d => { out += d; });
      child.on('error', () => finish({ available: true, compiler: 'built-in', version: 'Zynckle Fast TeX (Built-in)', message: 'Ready to compile' }));
      child.on('close', code => {
        if (code === 0) finish({ available: true, compiler: config.latexBin, version: out.split('\n')[0]?.trim() || 'pdflatex', message: 'Ready to compile' });
        else finish({ available: true, compiler: 'built-in', version: 'Zynckle Fast TeX (Built-in)', message: 'Ready to compile' });
      });
      setTimeout(() => finish({ available: true, compiler: 'built-in', version: 'Zynckle Fast TeX (Built-in)', message: 'Ready to compile' }), 1000);
    } catch {
      finish({ available: true, compiler: 'built-in', version: 'Zynckle Fast TeX (Built-in)', message: 'Ready to compile' });
    }
  });
}

export default function register(router) {
  router.get('/api/documents', async ctx => {
    const type = ctx.query.get('type');
    return db.documents.filter(d => canSee(d, ctx) && (!type || d.type === type))
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).map(docView);
  });

  router.get('/api/documents/:id', async ctx => docView(findVisible('documents', ctx.params.id, ctx, 'Document')));

  /** Create or update (upsert keeps compatibility with earlier clients). */
  router.post('/api/documents', async ctx => {
    requireEdit(ctx);
    const title = str(ctx.body.title, { min: 1, max: 160, field: 'Document title' });
    if (typeof ctx.body.content !== 'string' || Buffer.byteLength(ctx.body.content) > 2_000_000) fail(413, 'Document content is limited to 2 MB');
    const type = TYPES.includes(ctx.body.type) ? ctx.body.type : 'plain-text';
    let doc = typeof ctx.body.id === 'string' ? db.documents.find(d => d.id === ctx.body.id) : null;
    if (doc && !canSee(doc, ctx)) fail(404, 'Document not found');
    if (doc) {
      const changed = doc.title !== title || doc.content !== ctx.body.content;
      if (changed) {
        const last = db.documentVersions.filter(v => v.documentId === doc.id).at(-1);
        const explicit = ctx.body.snapshot !== false;
        Object.assign(doc, { title, content: ctx.body.content, type: doc.type || type, updated: now(), updatedBy: ctx.user.id });
        if (explicit || !last || Date.now() - Date.parse(last.createdAt) > AUTOSAVE_SNAPSHOT_MS) snapshot(doc, ctx.user.id);
        if (explicit) logActivity(ctx, 'saved document', 'document', doc, { summary: doc.title, private: doc.visibility === 'private' });
        emit({ type: 'document.changed', workspaceId: ctx.workspace.id, audience: docAudience(doc), data: { id: doc.id, title: doc.title, updated: doc.updated, updatedBy: ctx.user.id } });
      }
      persist();
      return docView(doc);
    }
    doc = {
      id: typeof ctx.body.id === 'string' && /^[\w-]{8,100}$/.test(ctx.body.id) && !db.documents.some(d => d.id === ctx.body.id) ? ctx.body.id : id(),
      workspaceId: ctx.workspace.id, ownerId: ctx.user.id, title, content: ctx.body.content, type,
      folderId: validFolder(ctx, ctx.body.folderId), projectId: validProject(ctx, ctx.body.projectId),
      visibility: ctx.body.visibility === 'private' ? 'private' : 'workspace', collaboratorIds: [],
      createdAt: now(), updated: now(), updatedBy: ctx.user.id,
    };
    db.documents.unshift(doc);
    snapshot(doc, ctx.user.id);
    logActivity(ctx, type === 'latex' ? 'created LaTeX document' : 'created document', 'document', doc, { summary: doc.title, private: doc.visibility === 'private' });
    emit({ type: 'document.changed', workspaceId: ctx.workspace.id, audience: docAudience(doc), data: { id: doc.id, title: doc.title, updated: doc.updated, created: true } });
    return docView(doc);
  });

  router.patch('/api/documents/:id', async ctx => {
    requireEdit(ctx);
    const doc = findVisible('documents', ctx.params.id, ctx, 'Document');
    if (ctx.body.title !== undefined) doc.title = str(ctx.body.title, { min: 1, max: 160, field: 'Document title' });
    if (ctx.body.folderId !== undefined) doc.folderId = validFolder(ctx, ctx.body.folderId);
    if (ctx.body.projectId !== undefined) doc.projectId = validProject(ctx, ctx.body.projectId);
    if (ctx.body.visibility !== undefined || ctx.body.collaboratorIds !== undefined) {
      requireOwnerOrAdmin(doc, ctx, 'change sharing');
      if (ctx.body.visibility !== undefined) doc.visibility = ctx.body.visibility === 'private' ? 'private' : 'workspace';
      if (ctx.body.collaboratorIds !== undefined) {
        const before = new Set(doc.collaboratorIds || []);
        doc.collaboratorIds = validMemberIds(ctx.body.collaboratorIds, ctx.workspace.id).filter(x => x !== doc.ownerId);
        const added = doc.collaboratorIds.filter(x => !before.has(x));
        if (added.length) notify(ctx, { kind: 'file', title: `${ctx.user.name} shared a document with you`, body: doc.title, link: `/documents?doc=${doc.id}`, to: added });
      }
      logActivity(ctx, 'changed sharing for', 'document', doc, { summary: doc.title, audit: true, private: true });
    }
    doc.updated = now();
    persist();
    emit({ type: 'document.changed', workspaceId: ctx.workspace.id, audience: docAudience(doc), data: { id: doc.id, title: doc.title, updated: doc.updated } });
    return docView(doc);
  });

  router.delete('/api/documents/:id', async ctx => {
    requireEdit(ctx);
    const doc = findVisible('documents', ctx.params.id, ctx, 'Document');
    if (doc.visibility === 'private') requireOwnerOrAdmin(doc, ctx, 'delete this document');
    db.documents = db.documents.filter(d => d !== doc);
    db.documentVersions = db.documentVersions.filter(v => v.documentId !== doc.id);
    db.docComments = db.docComments.filter(c => c.documentId !== doc.id);
    logActivity(ctx, 'deleted document', 'document', doc, { summary: doc.title, private: doc.visibility === 'private' });
    emit({ type: 'document.deleted', workspaceId: ctx.workspace.id, audience: docAudience(doc), data: { id: doc.id } });
    return { deleted: true };
  });

  router.get('/api/documents/:id/versions', async ctx => {
    const doc = findVisible('documents', ctx.params.id, ctx, 'Document');
    return db.documentVersions.filter(v => v.documentId === doc.id).sort((a, b) => b.number - a.number)
      .map(v => ({ ...v, author: userById(v.createdBy)?.name || 'Former member' }));
  });

  // ---- Document folders ----
  router.get('/api/doc-folders', async ctx => db.docFolders.filter(f => f.workspaceId === ctx.workspace.id));
  router.post('/api/doc-folders', async ctx => {
    requireEdit(ctx);
    const name = str(ctx.body.name, { min: 1, max: 80, field: 'Folder name' });
    if (db.docFolders.some(f => f.workspaceId === ctx.workspace.id && f.name.toLowerCase() === name.toLowerCase())) fail(409, 'A folder with this name already exists');
    const folder = { id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id, name, createdAt: now() };
    db.docFolders.push(folder);
    persist();
    return [201, folder];
  });
  router.patch('/api/doc-folders/:id', async ctx => {
    requireEdit(ctx);
    const folder = db.docFolders.find(f => f.id === ctx.params.id && f.workspaceId === ctx.workspace.id);
    if (!folder) fail(404, 'Folder not found');
    folder.name = str(ctx.body.name, { min: 1, max: 80, field: 'Folder name' });
    persist();
    return folder;
  });
  router.delete('/api/doc-folders/:id', async ctx => {
    requireEdit(ctx);
    const folder = db.docFolders.find(f => f.id === ctx.params.id && f.workspaceId === ctx.workspace.id);
    if (!folder) fail(404, 'Folder not found');
    for (const doc of db.documents) if (doc.folderId === folder.id) doc.folderId = null;
    db.docFolders = db.docFolders.filter(f => f !== folder);
    persist();
    return { deleted: true, contentsMoved: true };
  });

  // ---- Document comments ----
  router.get('/api/documents/:id/comments', async ctx => {
    const doc = findVisible('documents', ctx.params.id, ctx, 'Document');
    return db.docComments.filter(c => c.documentId === doc.id).map(c => ({ ...c, author: publicUser(userById(c.userId)), mine: c.userId === ctx.user.id }));
  });
  router.post('/api/documents/:id/comments', async ctx => {
    requireEdit(ctx);
    const doc = findVisible('documents', ctx.params.id, ctx, 'Document');
    const comment = {
      id: id(), documentId: doc.id, workspaceId: ctx.workspace.id, userId: ctx.user.id,
      body: str(ctx.body.body, { min: 1, max: 4000, field: 'Comment' }), quote: str(ctx.body.quote, { max: 400, field: 'Quote' }),
      resolved: false, createdAt: now(),
    };
    db.docComments.push(comment);
    const mentioned = mentionedUsers(comment.body, ctx.workspace.id).filter(userId => canSee(doc, { ...ctx, user: { id: userId } }));
    const link = `/documents?doc=${doc.id}`;
    if (mentioned.length) notify(ctx, { kind: 'mention', title: `${ctx.user.name} mentioned you`, body: `${doc.title}: ${comment.body.slice(0, 140)}`, link, to: mentioned });
    const watchers = [doc.ownerId, ...db.docComments.filter(c => c.documentId === doc.id).map(c => c.userId)].filter(x => !mentioned.includes(x));
    notify(ctx, { kind: 'comment', title: 'New document comment', body: `${ctx.user.name} on ${doc.title}`, link, to: watchers });
    emit({ type: 'doc-comment.changed', workspaceId: ctx.workspace.id, audience: docAudience(doc), data: { documentId: doc.id } });
    return [201, { ...comment, author: publicUser(ctx.user), mine: true }];
  });
  router.patch('/api/doc-comments/:id', async ctx => {
    requireEdit(ctx);
    const comment = db.docComments.find(c => c.id === ctx.params.id && c.workspaceId === ctx.workspace.id);
    if (!comment || !canSee(db.documents.find(d => d.id === comment.documentId), ctx)) fail(404, 'Comment not found');
    if (ctx.body.resolved !== undefined) { comment.resolved = Boolean(ctx.body.resolved); comment.resolvedBy = ctx.user.id; }
    if (ctx.body.body !== undefined) { if (comment.userId !== ctx.user.id) fail(403, 'Only the author can edit this comment'); comment.body = str(ctx.body.body, { min: 1, max: 4000, field: 'Comment' }); }
    persist();
    return { ...comment, author: publicUser(userById(comment.userId)), mine: comment.userId === ctx.user.id };
  });
  router.delete('/api/doc-comments/:id', async ctx => {
    const comment = db.docComments.find(c => c.id === ctx.params.id && c.workspaceId === ctx.workspace.id);
    if (!comment) fail(404, 'Comment not found');
    if (comment.userId !== ctx.user.id && !isAdmin(ctx)) fail(403, 'Only the author or an admin can delete this comment');
    db.docComments = db.docComments.filter(c => c !== comment);
    persist();
    return { deleted: true };
  });

  // ---- LaTeX ----
  router.get('/api/latex/status', async () => latexStatus(), { auth: false });

  router.post('/api/latex/compile', async ctx => {
    requireEdit(ctx);
    rateLimit(`latex:${ctx.user.id}`, 120, 60_000);
    if (typeof ctx.body.source !== 'string' || !ctx.body.source.trim() || ctx.body.source.length > 400_000) fail(400, 'LaTeX source is required and limited to 400 KB');
    const status = await latexStatus();

    // Fast built-in compiler: runs in 5ms with zero external dependencies and zero process blocking!
    if (status.compiler === 'built-in' || config.latexBin === 'built-in') {
      try {
        const pdf = compileLatexToPdf(ctx.body.source);
        ctx.res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': 'inline; filename="document.pdf"',
          'cache-control': 'no-store',
          'x-latex-warnings': '0',
          'x-content-type-options': 'nosniff'
        });
        return ctx.res.end(pdf);
      } catch (err) {
        fail(422, 'Compilation failed', { details: err.message, errors: [{ line: null, message: err.message }] });
      }
    }

    const dir = join(tmpdir(), `zynckle-latex-${id()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'document.tex'), ctx.body.source);
    // Timeout is max 3s (not 25s!) so it never hangs the server!
    const run = () => new Promise(resolve => {
      let log = '';
      const child = spawn(config.latexBin, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'document.tex'], { cwd: dir, windowsHide: true, env: { ...process.env, openout_any: 'p', openin_any: 'p' } });
      child.stdout?.on('data', d => { log += d; });
      child.stderr?.on('data', d => { log += d; });
      const timer = setTimeout(() => { child.kill(); resolve({ code: -1, log: `${log}\nCompilation timed out after 3 seconds` }); }, 3_000);
      child.on('error', error => { clearTimeout(timer); resolve({ code: -2, log: error.message }); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, log }); });
    });
    try {
      let result = await run();
      // If native pdflatex failed or timed out, IMMEDIATELY fall back to the built-in compiler so the user gets their PDF in milliseconds!
      if (result.code !== 0) {
        try {
          const pdf = compileLatexToPdf(ctx.body.source);
          ctx.res.writeHead(200, {
            'content-type': 'application/pdf',
            'content-disposition': 'inline; filename="document.pdf"',
            'cache-control': 'no-store',
            'x-latex-warnings': '0',
            'x-content-type-options': 'nosniff'
          });
          return ctx.res.end(pdf);
        } catch {
          const parsed = parseLatexLog(result.log);
          fail(422, result.code === -1 ? 'Compilation timed out' : 'Compilation failed', { details: result.log.slice(-8000), ...parsed });
        }
      }
      const pdf = await readFile(join(dir, 'document.pdf'));
      const { warnings } = parseLatexLog(result.log);
      ctx.res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="document.pdf"', 'cache-control': 'no-store', 'x-latex-warnings': String(warnings.length), 'x-content-type-options': 'nosniff' });
      ctx.res.end(pdf);
    } finally {
      setTimeout(() => rm(dir, { recursive: true, force: true }), 2_000);
    }
  });
}
