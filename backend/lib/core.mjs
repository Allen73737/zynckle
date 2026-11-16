import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { db, persist, sha256 } from './store.mjs';
import { config } from './config.mjs';
import { fail } from './http.mjs';

export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
export const now = () => new Date().toISOString();
export const id = () => randomUUID();

// ---- Passwords & sessions ------------------------------------------------
export const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');
export function verifyPassword(user, password) {
  if (!user?.password || !user.salt || typeof password !== 'string') return false;
  const expected = Buffer.from(user.password, 'hex');
  const actual = Buffer.from(hashPassword(password, user.salt), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function setPassword(user, password) {
  user.salt = randomBytes(16).toString('hex');
  user.password = hashPassword(password, user.salt);
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) fail(400, 'Password must be between 10 and 200 characters');
  if (!/[A-Za-z]/.test(password) || !/[^A-Za-z]/.test(password)) fail(400, 'Use letters plus at least one number or symbol in your password');
}

export function createSession(user, req) {
  const token = randomBytes(32).toString('hex');
  db.sessions.push({
    id: randomBytes(8).toString('hex'), tokenHash: sha256(token), userId: user.id,
    createdAt: now(), lastSeenAt: now(), expires: Date.now() + 14 * 86_400_000,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200), ip: req.socket.remoteAddress || '',
  });
  persist();
  return token;
}

export function sessionFor(token) {
  if (!token) return null;
  const hash = sha256(token);
  const session = db.sessions.find(s => s.tokenHash === hash && s.expires > Date.now());
  if (!session) return null;
  const user = db.users.find(u => u.id === session.userId);
  if (!user) return null;
  if (Date.now() - Date.parse(session.lastSeenAt || 0) > 300_000) { session.lastSeenAt = now(); persist(); }
  return { session, user };
}

// One-time tokens for password reset, email verification and OAuth state.
export function issueToken(kind, userId, ttlMs, data = {}) {
  const token = randomBytes(24).toString('hex');
  db.tokens = db.tokens.filter(t => !(t.kind === kind && t.userId === userId) && t.expires > Date.now());
  db.tokens.push({ kind, userId, tokenHash: sha256(token), expires: Date.now() + ttlMs, ...data });
  persist();
  return token;
}
export function consumeToken(kind, token) {
  if (typeof token !== 'string' || !token) return null;
  const hash = sha256(token);
  const record = db.tokens.find(t => t.kind === kind && t.tokenHash === hash);
  if (!record) return null;
  db.tokens = db.tokens.filter(t => t !== record);
  persist();
  return record.expires > Date.now() ? record : null;
}

// ---- Signed URLs ------------------------------------------------------------
export const sign = value => createHmac('sha256', config.secret).update(value).digest('base64url');
export function signedPath(base, subject, ttlSeconds = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${base}?exp=${exp}&sig=${sign(`${subject}:${exp}`)}`;
}
export function verifySignature(subject, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(`${subject}:${exp}`));
  const actual = Buffer.from(String(sig));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---- Workspace membership -----------------------------------------------------
export const membership = (userId, workspaceId) => db.workspaceMembers.find(m => m.userId === userId && m.workspaceId === workspaceId);

export function createWorkspace(user, name) {
  const workspace = { id: id(), name, ownerId: user.id, createdAt: now() };
  db.workspaces.push(workspace);
  db.workspaceMembers.push({ workspaceId: workspace.id, userId: user.id, role: 'OWNER', joinedAt: now() });
  user.workspaceId = workspace.id;
  persist();
  return workspace;
}

/** Resolve the active workspace for a user, repairing stale selections. */
export function resolveWorkspace(user) {
  let member = membership(user.id, user.workspaceId);
  if (!member) {
    member = db.workspaceMembers.find(m => m.userId === user.id && db.workspaces.some(w => w.id === m.workspaceId));
    if (member) user.workspaceId = member.workspaceId;
    else { createWorkspace(user, 'Personal'); member = membership(user.id, user.workspaceId); }
    persist();
  }
  const workspace = db.workspaces.find(w => w.id === member.workspaceId);
  return { workspace, member, role: member.role };
}

export const publicUser = user => user ? ({ id: user.id, name: user.name, email: user.email, avatar: initials(user.name) }) : { id: null, name: 'Former member', email: '', avatar: '—' };
export const initials = name => String(name || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
export const userById = userId => db.users.find(u => u.id === userId);
export const userName = userId => userById(userId)?.name || 'Former member';

export const isAdmin = ctx => ['OWNER', 'ADMIN'].includes(ctx.role);
export function requireEdit(ctx) { if (ctx.role === 'VIEWER') fail(403, 'Viewers cannot change workspace content'); }
export function requireAdmin(ctx) { if (!isAdmin(ctx)) fail(403, 'Workspace admin role required'); }

/** Private items are visible to their owner and to people they were shared with. */
export function canSee(item, ctx) {
  if (!item || item.workspaceId !== ctx.workspace.id) return false;
  if (item.visibility !== 'private') return true;
  return item.ownerId === ctx.user.id || (item.sharedWith || []).includes(ctx.user.id) || (item.collaboratorIds || []).includes(ctx.user.id);
}
export function findVisible(collection, itemId, ctx, label = 'Item') {
  const item = db[collection].find(x => x.id === itemId);
  if (!canSee(item, ctx)) fail(404, `${label} not found`);
  return item;
}
/** Only owners of an item or workspace admins can change sharing or delete private items. */
export function requireOwnerOrAdmin(item, ctx, action = 'change this') {
  if (item.ownerId !== ctx.user.id && !isAdmin(ctx)) fail(403, `Only the owner or a workspace admin can ${action}`);
}
export function validMemberIds(ids, workspaceId) {
  if (!Array.isArray(ids)) fail(400, 'Expected a list of members');
  const unique = [...new Set(ids.filter(x => typeof x === 'string'))];
  for (const userId of unique) if (!membership(userId, workspaceId)) fail(400, 'Everyone selected must be a workspace member');
  return unique.slice(0, 200);
}

// ---- Events, activity and notifications ---------------------------------------
const listeners = new Set();
export const onEvent = fn => { listeners.add(fn); return () => listeners.delete(fn); };
/** Broadcast a workspace event; the realtime layer filters by membership/visibility. */
export function emit(event) { for (const fn of listeners) { try { fn(event); } catch (error) { console.error(error); } } }

export function logActivity(ctx, verb, entityType, entity, extra = {}) {
  const record = {
    id: id(), workspaceId: ctx.workspace.id, actorId: ctx.user.id, verb, entityType,
    entityId: entity?.id || null, summary: extra.summary || entity?.name || entity?.title || '',
    projectId: extra.projectId ?? (entityType === 'project' ? entity?.id : entity?.projectId) ?? null,
    audit: Boolean(extra.audit), createdAt: now(),
  };
  db.activity.unshift(record);
  if (db.activity.length > 5000) db.activity.length = 5000;
  persist();
  if (!extra.private) emit({ type: 'activity', workspaceId: ctx.workspace.id, data: { ...record, actor: publicUser(ctx.user) } });
  return record;
}

/**
 * Notify specific users (or every other workspace member when `to` is omitted),
 * honouring each recipient's notification preferences.
 */
export function notify(ctx, { kind, title, body = '', link = '', to }) {
  const workspaceId = ctx.workspace.id;
  const recipients = (to || db.workspaceMembers.filter(m => m.workspaceId === workspaceId).map(m => m.userId))
    .filter((userId, index, all) => userId !== ctx.user.id && all.indexOf(userId) === index && membership(userId, workspaceId));
  for (const userId of recipients) {
    const user = userById(userId);
    if (!user || user.notificationPrefs?.[kind] === false) continue;
    const notification = { id: id(), workspaceId, userId, kind, title: String(title).slice(0, 200), body: String(body).slice(0, 500), link, read: false, actorId: ctx.user.id, createdAt: now() };
    db.notifications.unshift(notification);
    emit({ type: 'notification', userId, data: { ...notification, workspace: ctx.workspace.name } });
  }
  if (db.notifications.length > 20000) db.notifications.length = 20000;
  persist();
}

/** Find @mentions of workspace members ("@Ada", "@ada.lovelace", "@Ada Lovelace"). */
export function mentionedUsers(text, workspaceId) {
  const lower = ` ${String(text).toLowerCase()} `;
  return db.workspaceMembers.filter(m => m.workspaceId === workspaceId).map(m => userById(m.userId)).filter(Boolean).filter(user => {
    const full = user.name.toLowerCase();
    const first = full.split(/\s+/)[0];
    const handle = user.email.split('@')[0].toLowerCase();
    return [full, first, handle].some(token => token && new RegExp(`@${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(lower));
  }).map(user => user.id);
}
