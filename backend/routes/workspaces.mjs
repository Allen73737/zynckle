import { randomBytes } from 'node:crypto';
import { db, persist, sha256 } from '../lib/store.mjs';
import { fail, str, isEmail, oneOf } from '../lib/http.mjs';
import { now, id, createWorkspace, membership, publicUser, requireAdmin, isAdmin, logActivity, notify, userById, canSee, emit } from '../lib/core.mjs';
import { removeObject } from '../lib/storage.mjs';
import { resetCollaborativeState } from '../lib/realtime.mjs';
import { config } from '../lib/config.mjs';

/** Remove a workspace and everything it owns, including stored binaries. */
export async function deleteWorkspaceData(workspaceId) {
  for (const file of db.files.filter(f => f.workspaceId === workspaceId && f.storageKey)) await removeObject(file.storageKey, file.storage);
  for (const file of db.codeFiles.filter(f => f.workspaceId === workspaceId)) {
    for (const version of [file, ...(file.versions || [])]) if (version.storageKey) await removeObject(version.storageKey, version.storage);
  }
  for (const doc of db.documents.filter(d => d.workspaceId === workspaceId)) await resetCollaborativeState(doc.id);
  const taskIds = new Set(db.tasks.filter(t => t.workspaceId === workspaceId).map(t => t.id));
  const docIds = new Set(db.documents.filter(d => d.workspaceId === workspaceId).map(d => d.id));
  for (const name of ['projects', 'tasks', 'documents', 'documentVersions', 'docFolders', 'folders', 'files', 'codeProjects', 'codeFiles', 'previews', 'invites', 'activity', 'notifications', 'architectures', 'workspaceMembers']) {
    db[name] = db[name].filter(item => item.workspaceId !== workspaceId);
  }
  db.comments = db.comments.filter(c => !taskIds.has(c.taskId));
  db.docComments = db.docComments.filter(c => !docIds.has(c.documentId));
  db.aiConversations = db.aiConversations.filter(c => c.workspaceId !== workspaceId);
  db.workspaces = db.workspaces.filter(w => w.id !== workspaceId);
  for (const user of db.users) if (user.workspaceId === workspaceId) {
    const next = db.workspaceMembers.find(m => m.userId === user.id);
    user.workspaceId = next?.workspaceId || null;
  }
  persist();
}

const workspaceSummary = (workspace, userId, currentId) => {
  const member = membership(userId, workspace.id);
  return { id: workspace.id, name: workspace.name, role: member?.role, ownerId: workspace.ownerId, current: workspace.id === currentId, members: db.workspaceMembers.filter(m => m.workspaceId === workspace.id).length };
};

export default function register(router) {
  router.get('/api/workspaces', async ctx => db.workspaceMembers.filter(m => m.userId === ctx.user.id)
    .map(m => db.workspaces.find(w => w.id === m.workspaceId)).filter(Boolean)
    .map(w => workspaceSummary(w, ctx.user.id, ctx.workspace.id)));

  router.post('/api/workspaces', async ctx => {
    const name = str(ctx.body.name, { min: 1, max: 80, field: 'Workspace name' });
    if (db.workspaceMembers.filter(m => m.userId === ctx.user.id && m.role === 'OWNER').length >= 20) fail(400, 'You can own up to 20 workspaces');
    const workspace = createWorkspace(ctx.user, name);
    return [201, { ...workspace, role: 'OWNER', current: true }];
  });

  router.post('/api/workspaces/:id/activate', async ctx => {
    const member = membership(ctx.user.id, ctx.params.id);
    const workspace = db.workspaces.find(w => w.id === ctx.params.id);
    if (!member || !workspace) fail(403, 'You are not a member of this workspace');
    ctx.user.workspaceId = workspace.id;
    persist();
    return { ...workspace, role: member.role, current: true };
  });

  router.delete('/api/workspaces/:id', async ctx => {
    const workspace = db.workspaces.find(w => w.id === ctx.params.id);
    if (!workspace || !membership(ctx.user.id, workspace.id)) fail(404, 'Workspace not found');
    if (workspace.ownerId !== ctx.user.id) fail(403, 'Only the workspace owner can delete it');
    if (db.workspaceMembers.some(m => m.workspaceId === workspace.id && m.userId !== ctx.user.id)) fail(409, 'Remove workspace members or transfer ownership before deleting this workspace');
    if (!db.workspaceMembers.some(m => m.userId === ctx.user.id && m.workspaceId !== workspace.id)) fail(409, 'Create another workspace before deleting your only workspace');
    await deleteWorkspaceData(workspace.id);
    return { deleted: true };
  });

  router.get('/api/workspace', async ctx => ({ ...ctx.workspace, role: ctx.role }));

  router.patch('/api/workspace', async ctx => {
    requireAdmin(ctx);
    if (ctx.body.name !== undefined) ctx.workspace.name = str(ctx.body.name, { min: 1, max: 80, field: 'Workspace name' });
    if (ctx.body.description !== undefined) ctx.workspace.description = str(ctx.body.description, { max: 400, field: 'Description' });
    ctx.workspace.updatedAt = now();
    logActivity(ctx, 'updated workspace settings', 'workspace', ctx.workspace, { audit: true });
    return { ...ctx.workspace, role: ctx.role };
  });

  router.post('/api/workspace/transfer', async ctx => {
    if (ctx.workspace.ownerId !== ctx.user.id) fail(403, 'Only the owner can transfer ownership');
    const target = membership(String(ctx.body.userId || ''), ctx.workspace.id);
    if (!target || target.userId === ctx.user.id) fail(400, 'Choose another workspace member');
    target.role = 'OWNER';
    ctx.member.role = 'ADMIN';
    ctx.workspace.ownerId = target.userId;
    logActivity(ctx, 'transferred ownership to', 'workspace', ctx.workspace, { audit: true, summary: userById(target.userId)?.name });
    notify(ctx, { kind: 'team', title: 'You are now the workspace owner', body: ctx.workspace.name, to: [target.userId] });
    return { transferred: true };
  });

  router.post('/api/workspace/leave', async ctx => {
    if (ctx.workspace.ownerId === ctx.user.id) fail(409, 'Transfer ownership before leaving this workspace');
    db.workspaceMembers = db.workspaceMembers.filter(m => !(m.workspaceId === ctx.workspace.id && m.userId === ctx.user.id));
    logActivity(ctx, 'left the workspace', 'workspace', ctx.workspace);
    const next = db.workspaceMembers.find(m => m.userId === ctx.user.id);
    ctx.user.workspaceId = next?.workspaceId || null;
    persist();
    return { left: true };
  });

  // ---- Team & invitations ----
  router.get('/api/team', async ctx => {
    const members = db.workspaceMembers.filter(m => m.workspaceId === ctx.workspace.id).map(m => {
      const user = userById(m.userId);
      return user ? { ...publicUser(user), title: user.title || '', role: m.role, joinedAt: m.joinedAt } : null;
    }).filter(Boolean);
    const invites = isAdmin(ctx) ? db.invites.filter(i => i.workspaceId === ctx.workspace.id && Date.parse(i.expiresAt || 0) > Date.now())
      .map(i => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt, inviteUrl: i.inviteUrl, invitedBy: userById(i.createdBy)?.name })) : [];
    return { members, invites, role: ctx.role, ownerId: ctx.workspace.ownerId, currentUserId: ctx.user.id };
  });

  router.patch('/api/team/members/:id', async ctx => {
    requireAdmin(ctx);
    const target = membership(ctx.params.id, ctx.workspace.id);
    if (!target) fail(404, 'Workspace member not found');
    if (target.role === 'OWNER') fail(403, 'Use ownership transfer to change the owner');
    if (ctx.role === 'ADMIN' && target.role === 'ADMIN') fail(403, 'Only the workspace owner can manage another admin');
    const role = oneOf(ctx.body.role, ['ADMIN', 'MEMBER', 'VIEWER'], 'Role');
    if (ctx.role === 'ADMIN' && role === 'ADMIN') fail(403, 'Only the workspace owner can grant admin role');
    const before = target.role;
    target.role = role;
    logActivity(ctx, `changed role from ${before} to ${role} for`, 'member', { id: target.userId, name: userById(target.userId)?.name }, { audit: true });
    notify(ctx, { kind: 'team', title: 'Your workspace role changed', body: `${ctx.workspace.name}: ${role.toLowerCase()}`, to: [target.userId] });
    return { id: target.userId, role };
  });

  router.delete('/api/team/members/:id', async ctx => {
    requireAdmin(ctx);
    const target = membership(ctx.params.id, ctx.workspace.id);
    if (!target) fail(404, 'Workspace member not found');
    if (target.userId === ctx.user.id) fail(403, 'Use “Leave workspace” to remove yourself');
    if (target.role === 'OWNER') fail(403, 'The workspace owner cannot be removed');
    if (ctx.role === 'ADMIN' && target.role === 'ADMIN') fail(403, 'Only the workspace owner can remove an admin');
    db.workspaceMembers = db.workspaceMembers.filter(m => m !== target);
    for (const task of db.tasks) if (task.workspaceId === ctx.workspace.id && task.assigneeId === target.userId) task.assigneeId = null;
    for (const project of db.projects) if (project.workspaceId === ctx.workspace.id) project.memberIds = (project.memberIds || []).filter(x => x !== target.userId);
    const user = userById(target.userId);
    if (user?.workspaceId === ctx.workspace.id) user.workspaceId = db.workspaceMembers.find(m => m.userId === user.id)?.workspaceId || null;
    logActivity(ctx, 'removed', 'member', { id: target.userId, name: user?.name }, { audit: true });
    return { removed: true };
  });

  router.post('/api/team/invitations', async ctx => {
    requireAdmin(ctx);
    const email = str(ctx.body.email, { max: 320, field: 'Email' }).toLowerCase();
    if (!isEmail(email)) fail(400, 'Enter a valid email address');
    const role = ['ADMIN', 'MEMBER', 'VIEWER'].includes(ctx.body.role) ? ctx.body.role : 'MEMBER';
    if (role === 'ADMIN' && ctx.role !== 'OWNER') fail(403, 'Only the owner can invite admins');
    const existingUser = db.users.find(u => u.email === email);
    if (existingUser && membership(existingUser.id, ctx.workspace.id)) fail(409, 'That person is already a member');
    db.invites = db.invites.filter(i => !(i.workspaceId === ctx.workspace.id && i.email === email));
    const token = randomBytes(24).toString('hex');
    const invite = { id: id(), tokenHash: sha256(token), workspaceId: ctx.workspace.id, email, role, createdBy: ctx.user.id, createdAt: now(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), inviteUrl: `/team?invite=${token}` };
    db.invites.push(invite);
    if (existingUser && existingUser.notificationPrefs?.invite !== false) {
      // The invitee is not a member yet, so this bypasses the member-only notify() helper.
      const notification = { id: id(), workspaceId: ctx.workspace.id, userId: existingUser.id, kind: 'invite', title: `Invitation to join ${ctx.workspace.name}`, body: `${ctx.user.name} invited you as ${role.toLowerCase()}.`, link: invite.inviteUrl, read: false, actorId: ctx.user.id, createdAt: now() };
      db.notifications.unshift(notification);
      emit({ type: 'notification', userId: existingUser.id, data: notification });
    }
    logActivity(ctx, 'invited', 'invite', { id: invite.id, name: email }, { audit: true });
    console.log(`[zynckle] Invite for ${email}: ${config.publicUrl}${invite.inviteUrl}`);
    return [201, { id: invite.id, email, role, inviteUrl: invite.inviteUrl, createdAt: invite.createdAt, expiresAt: invite.expiresAt, emailDelivery: false }];
  });

  router.post('/api/team/invitations/accept', async ctx => {
    const hash = sha256(String(ctx.body.token || ''));
    const invite = db.invites.find(i => i.tokenHash === hash || i.token === ctx.body.token);
    if (!invite) fail(404, 'This invite is invalid or was revoked');
    if (Date.parse(invite.expiresAt || invite.createdAt) + (invite.expiresAt ? 0 : 7 * 86_400_000) < Date.now()) { db.invites = db.invites.filter(i => i !== invite); persist(); fail(410, 'This invite has expired'); }
    if (invite.email !== ctx.user.email) fail(403, `This invite was sent to ${invite.email}. Sign in with that address to accept it.`);
    const workspace = db.workspaces.find(w => w.id === invite.workspaceId);
    if (!workspace) fail(404, 'The workspace no longer exists');
    const existing = membership(ctx.user.id, workspace.id);
    if (existing) { if (existing.role !== 'OWNER') existing.role = invite.role; }
    else db.workspaceMembers.push({ workspaceId: workspace.id, userId: ctx.user.id, role: invite.role, joinedAt: now() });
    db.invites = db.invites.filter(i => i !== invite);
    ctx.user.workspaceId = workspace.id;
    const joinedCtx = { ...ctx, workspace };
    logActivity(joinedCtx, 'joined the workspace', 'member', { id: ctx.user.id, name: ctx.user.name });
    notify(joinedCtx, { kind: 'team', title: 'New teammate joined', body: `${ctx.user.name} joined ${workspace.name}`, link: '/team' });
    return { workspace: { id: workspace.id, name: workspace.name }, role: invite.role };
  });

  router.delete('/api/team/invitations/:id', async ctx => {
    requireAdmin(ctx);
    db.invites = db.invites.filter(i => !(i.id === ctx.params.id && i.workspaceId === ctx.workspace.id));
    persist();
    return { deleted: true };
  });

  // ---- Activity & audit ----
  router.get('/api/activity', async ctx => {
    const projectId = ctx.query.get('projectId');
    const limit = Math.min(100, Number(ctx.query.get('limit')) || 30);
    const before = ctx.query.get('before');
    const items = db.activity.filter(a => a.workspaceId === ctx.workspace.id && (!projectId || a.projectId === projectId) && (!before || a.createdAt < before) && (!a.audit || isAdmin(ctx) || a.actorId === ctx.user.id));
    return items.slice(0, limit).map(a => ({ ...a, actor: publicUser(userById(a.actorId)) }));
  });

  router.get('/api/audit', async ctx => {
    requireAdmin(ctx);
    return db.activity.filter(a => a.workspaceId === ctx.workspace.id && a.audit).slice(0, 200).map(a => ({ ...a, actor: publicUser(userById(a.actorId)) }));
  });

  // ---- Global search (scoped to what the caller may see) ----
  router.get('/api/search', async ctx => {
    const q = String(ctx.query.get('q') || '').trim().toLowerCase();
    if (q.length < 2) return { query: q, results: [] };
    const ws = ctx.workspace.id;
    const has = (...values) => values.some(value => String(value || '').toLowerCase().includes(q));
    const text = html => String(html || '').replace(/<[^>]*>/g, ' ');
    const results = [
      ...db.projects.filter(p => p.workspaceId === ws && has(p.name, p.description, (p.tags || []).join(' '))).slice(0, 6).map(p => ({ type: 'project', id: p.id, title: p.name, subtitle: p.status, link: `/projects/${p.id}` })),
      ...db.tasks.filter(t => t.workspaceId === ws && has(t.title, t.description)).slice(0, 8).map(t => ({ type: 'task', id: t.id, title: t.title, subtitle: `${t.project} · ${t.status}`, link: `/projects/${t.projectId}?task=${t.id}` })),
      ...db.documents.filter(d => canSee(d, ctx) && has(d.title, text(d.content))).slice(0, 6).map(d => ({ type: d.type === 'latex' ? 'latex' : 'document', id: d.id, title: d.title, subtitle: d.type === 'latex' ? 'LaTeX document' : 'Document', link: d.type === 'latex' ? `/latex?doc=${d.id}` : `/documents?doc=${d.id}` })),
      ...db.files.filter(f => canSee(f, ctx) && has(f.name)).slice(0, 6).map(f => ({ type: 'file', id: f.id, title: f.name, subtitle: 'Drive', link: `/drive?file=${f.id}` })),
      ...db.codeProjects.filter(p => canSee(p, ctx) && has(p.name, p.description)).slice(0, 4).map(p => ({ type: 'code', id: p.id, title: p.name, subtitle: 'Code project', link: `/code/${p.id}` })),
      ...db.codeFiles.filter(f => f.workspaceId === ws && has(f.path) && canSee(db.codeProjects.find(p => p.id === f.codeProjectId), ctx)).slice(0, 6).map(f => ({ type: 'code-file', id: f.id, title: f.path.split('/').pop(), subtitle: f.path, link: `/code/${f.codeProjectId}?file=${f.id}` })),
      ...db.previews.filter(p => canSee(p, ctx) && has(p.title, p.url, p.description)).slice(0, 4).map(p => ({ type: 'preview', id: p.id, title: p.title, subtitle: p.url, link: `/previews?preview=${p.id}` })),
      ...db.workspaceMembers.filter(m => m.workspaceId === ws).map(m => userById(m.userId)).filter(u => u && has(u.name, u.email)).slice(0, 4).map(u => ({ type: 'person', id: u.id, title: u.name, subtitle: u.email, link: '/team' })),
    ];
    return { query: q, results };
  });
}
