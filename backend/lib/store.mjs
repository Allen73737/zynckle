import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { config } from './config.mjs';

const collections = [
  'users', 'sessions', 'workspaces', 'workspaceMembers', 'invites', 'projects', 'tasks', 'comments',
  'documents', 'documentVersions', 'docFolders', 'docComments', 'folders', 'files', 'codeProjects', 'codeFiles',
  'previews', 'notifications', 'activity', 'aiConversations', 'architectures', 'aiUsage', 'tokens',
];

export const db = Object.fromEntries(collections.map(name => [name, []]));

export const sha256 = value => createHash('sha256').update(value).digest('hex');

const defaultNotificationPrefs = { task: true, mention: true, invite: true, comment: true, project: true, file: true, deadline: true, team: true };
export { defaultNotificationPrefs };

/** Load the JSON store and upgrade records written by earlier versions of the local API. */
export async function loadStore() {
  try { Object.assign(db, JSON.parse(await readFile(config.dataFile, 'utf8'))); } catch { /* first run */ }
  for (const name of collections) if (!Array.isArray(db[name])) db[name] = [];
  const now = new Date().toISOString();
  for (const session of db.sessions) {
    if (session.token && !session.tokenHash) { session.tokenHash = sha256(session.token); delete session.token; }
    session.id ??= session.tokenHash.slice(0, 16);
    session.createdAt ??= now;
  }
  for (const w of db.workspaces) {
    w.createdAt ??= now;
    if (w.ownerId && !db.workspaceMembers.some(m => m.workspaceId === w.id && m.userId === w.ownerId) && db.users.some(u => u.id === w.ownerId)) {
      db.workspaceMembers.push({ workspaceId: w.id, userId: w.ownerId, role: 'OWNER', joinedAt: now });
    }
  }
  for (const u of db.users) {
    u.createdAt ??= now;
    u.notificationPrefs = { ...defaultNotificationPrefs, ...(u.notificationPrefs || {}) };
    u.preferences ??= { theme: 'light' };
    u.emailVerified ??= false;
    delete u.role;
  }
  for (const p of db.projects) { p.tags ??= []; p.memberIds ??= [p.ownerId].filter(Boolean); p.archived ??= false; p.createdAt ??= now; }
  for (const t of db.tasks) { t.createdAt ??= now; t.status ??= t.done ? 'Done' : 'To do'; t.assigneeId ??= null; t.position ??= 0; }
  for (const d of db.documents) { d.visibility ??= 'workspace'; d.folderId ??= null; d.createdAt ??= d.updated || now; }
  for (const f of db.files) { f.visibility ??= 'workspace'; f.sharedWith ??= []; }
  for (const p of db.previews) { p.description ??= ''; }
  // Earlier builds stored source files from the Code page in Drive; they stay in Drive.
  await flush();
}

let timer = null;
let chain = Promise.resolve();

async function write() {
  const json = JSON.stringify(db);
  const tmp = `${config.dataFile}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, json);
    try {
      await rename(tmp, config.dataFile);
    } catch {
      await writeFile(config.dataFile, json);
      try { await unlink(tmp); } catch {}
    }
  } catch {
    await writeFile(config.dataFile, json);
  }
}

/** Coalesce writes: mutations call persist(), the store is written atomically shortly after. */
export function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => { flush().catch(error => console.error('Store write failed', error)); }, 80);
}

export function flush() {
  clearTimeout(timer);
  chain = chain.then(write, write);
  return chain;
}
