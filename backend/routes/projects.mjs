import { db, persist } from '../lib/store.mjs';
import { fail, str, oneOf, isoDate } from '../lib/http.mjs';
import { now, id, requireEdit, requireOwnerOrAdmin, isAdmin, logActivity, notify, emit, userById, publicUser, validMemberIds, mentionedUsers, membership } from '../lib/core.mjs';

export const TASK_STATUSES = ['Backlog', 'To do', 'In progress', 'In review', 'Done'];
const PROJECT_STATUSES = ['Planning', 'In progress', 'In review', 'Completed', 'On hold'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const COLORS = ['terra', 'olive', 'sage'];

function projectView(project) {
  const tasks = db.tasks.filter(t => t.projectId === project.id);
  const done = tasks.filter(t => t.status === 'Done').length;
  return {
    ...project,
    color: project.color || 'terra',
    due: project.due || 'Not set',
    members: Math.max(1, (project.memberIds || []).length),
    memberList: (project.memberIds || []).map(userById).filter(Boolean).map(publicUser),
    taskCount: tasks.length, doneCount: done, progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    owner: userById(project.ownerId)?.name || 'Former member',
  };
}

export function taskView(task) {
  const assignee = task.assigneeId ? userById(task.assigneeId) : null;
  return {
    ...task, done: task.status === 'Done',
    assignee: assignee ? publicUser(assignee) : null,
    commentCount: db.comments.filter(c => c.taskId === task.id).length,
  };
}

const findProject = (ctx, projectId) => {
  const project = db.projects.find(p => p.id === projectId && p.workspaceId === ctx.workspace.id);
  if (!project) fail(404, 'Project not found');
  return project;
};
const findTask = (ctx, taskId) => {
  const task = db.tasks.find(t => t.id === taskId && t.workspaceId === ctx.workspace.id);
  if (!task) fail(404, 'Task not found');
  return task;
};

function readTaskFields(body, task = {}) {
  const fields = {};
  if (body.title !== undefined) fields.title = str(body.title, { min: 1, max: 160, field: 'Task title' });
  if (body.description !== undefined) fields.description = str(body.description, { max: 5000, field: 'Description', trim: false });
  if (body.status !== undefined) fields.status = oneOf(body.status, TASK_STATUSES, 'Status');
  if (body.priority !== undefined) fields.priority = oneOf(body.priority, PRIORITIES, 'Priority');
  if (body.date !== undefined) fields.date = isoDate(body.date) ? body.date : 'No date';
  if (body.position !== undefined) fields.position = Number.isFinite(Number(body.position)) ? Number(body.position) : task.position || 0;
  return fields;
}

export default function register(router) {
  router.get('/api/projects', async ctx => {
    const includeArchived = ctx.query.get('archived') === 'include';
    return db.projects.filter(p => p.workspaceId === ctx.workspace.id && (includeArchived || !p.archived)).map(projectView);
  });

  router.post('/api/projects', async ctx => {
    requireEdit(ctx);
    const project = {
      id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id,
      name: str(ctx.body.name, { min: 1, max: 100, field: 'Project name' }),
      description: str(ctx.body.description, { max: 2000, field: 'Description' }),
      status: 'Planning', due: isoDate(ctx.body.due) ? ctx.body.due : null,
      tags: Array.isArray(ctx.body.tags) ? ctx.body.tags.map(t => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 8) : [],
      color: COLORS.includes(ctx.body.color) ? ctx.body.color : COLORS[db.projects.filter(p => p.workspaceId === ctx.workspace.id).length % COLORS.length],
      memberIds: [ctx.user.id], archived: false, createdAt: now(), updatedAt: now(),
    };
    db.projects.unshift(project);
    logActivity(ctx, 'created project', 'project', project);
    notify(ctx, { kind: 'project', title: 'New project created', body: project.name, link: `/projects/${project.id}` });
    emit({ type: 'project.changed', workspaceId: ctx.workspace.id, data: projectView(project) });
    return [201, projectView(project)];
  });

  router.get('/api/projects/:id', async ctx => projectView(findProject(ctx, ctx.params.id)));

  router.patch('/api/projects/:id', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    const changes = [];
    if (ctx.body.name !== undefined) { project.name = str(ctx.body.name, { min: 1, max: 100, field: 'Project name' }); changes.push('name'); }
    if (ctx.body.description !== undefined) project.description = str(ctx.body.description, { max: 2000, field: 'Description' });
    if (ctx.body.status !== undefined) { project.status = oneOf(ctx.body.status, PROJECT_STATUSES, 'Project status'); changes.push(`status to ${project.status}`); }
    if (ctx.body.due !== undefined) project.due = isoDate(ctx.body.due) ? ctx.body.due : null;
    if (ctx.body.color !== undefined) project.color = COLORS.includes(ctx.body.color) ? ctx.body.color : project.color;
    if (ctx.body.tags !== undefined) {
      if (!Array.isArray(ctx.body.tags)) fail(400, 'Tags must be a list');
      project.tags = [...new Set(ctx.body.tags.map(t => String(t).trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
    }
    if (ctx.body.memberIds !== undefined) {
      const before = new Set(project.memberIds || []);
      project.memberIds = validMemberIds(ctx.body.memberIds, ctx.workspace.id);
      const added = project.memberIds.filter(x => !before.has(x));
      if (added.length) notify(ctx, { kind: 'project', title: `You were added to ${project.name}`, body: `${ctx.user.name} added you to the project`, link: `/projects/${project.id}`, to: added });
      changes.push('members');
    }
    if (ctx.body.archived !== undefined) {
      requireOwnerOrAdmin(project, ctx, 'archive this project');
      project.archived = Boolean(ctx.body.archived);
      changes.push(project.archived ? 'archived' : 'restored');
    }
    project.updatedAt = now();
    for (const task of db.tasks) if (task.projectId === project.id) task.project = project.name;
    logActivity(ctx, changes.includes('archived') ? 'archived project' : changes.includes('restored') ? 'restored project' : 'updated project', 'project', project, { summary: project.name });
    emit({ type: 'project.changed', workspaceId: ctx.workspace.id, data: projectView(project) });
    return projectView(project);
  });

  router.delete('/api/projects/:id', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    requireOwnerOrAdmin(project, ctx, 'delete this project');
    const taskIds = new Set(db.tasks.filter(t => t.projectId === project.id).map(t => t.id));
    db.projects = db.projects.filter(p => p !== project);
    db.tasks = db.tasks.filter(t => t.projectId !== project.id);
    db.comments = db.comments.filter(c => !taskIds.has(c.taskId));
    for (const item of [...db.documents, ...db.previews, ...db.codeProjects]) if (item.projectId === project.id) item.projectId = null;
    logActivity(ctx, 'deleted project', 'project', project, { audit: true, projectId: null });
    emit({ type: 'project.deleted', workspaceId: ctx.workspace.id, data: { id: project.id } });
    return { deleted: true };
  });

  // ---- Tasks ----
  router.get('/api/tasks', async ctx => {
    const mine = ctx.query.get('assignee') === 'me';
    return db.tasks.filter(t => t.workspaceId === ctx.workspace.id && (!mine || t.assigneeId === ctx.user.id)).map(taskView);
  });

  router.get('/api/projects/:id/tasks', async ctx => {
    const project = findProject(ctx, ctx.params.id);
    return db.tasks.filter(t => t.projectId === project.id).sort((a, b) => (a.position || 0) - (b.position || 0)).map(taskView);
  });

  const createTask = (ctx, project, input) => {
    const fields = readTaskFields(input);
    if (!fields.title) fail(400, 'Task title is required');
    let assigneeId = null;
    if (input.assigneeId) { if (!membership(input.assigneeId, ctx.workspace.id)) fail(400, 'The assignee must be a workspace member'); assigneeId = input.assigneeId; }
    const status = fields.status || 'To do';
    const position = Math.max(0, ...db.tasks.filter(t => t.projectId === project.id && t.status === status).map(t => (t.position || 0) + 1));
    return {
      id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id, projectId: project.id, project: project.name,
      title: fields.title, description: fields.description || '', status, priority: fields.priority || 'Normal',
      date: fields.date || 'No date', assigneeId, position, done: status === 'Done', createdAt: now(), updatedAt: now(),
    };
  };

  router.post('/api/projects/:id/tasks', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    const task = createTask(ctx, project, ctx.body);
    db.tasks.unshift(task);
    logActivity(ctx, 'added task', 'task', task, { summary: task.title });
    if (task.assigneeId) notify(ctx, { kind: 'task', title: 'Task assigned to you', body: `${task.title} · ${project.name}`, link: `/projects/${project.id}?task=${task.id}`, to: [task.assigneeId] });
    emit({ type: 'task.changed', workspaceId: ctx.workspace.id, data: taskView(task) });
    return [201, taskView(task)];
  });

  router.post('/api/projects/:id/tasks/bulk', async ctx => {
    requireEdit(ctx);
    const project = findProject(ctx, ctx.params.id);
    if (!Array.isArray(ctx.body.tasks) || !ctx.body.tasks.length || ctx.body.tasks.length > 50) fail(400, 'Provide between 1 and 50 tasks');
    const created = ctx.body.tasks.map(input => createTask(ctx, project, input));
    db.tasks.unshift(...created);
    logActivity(ctx, `added ${created.length} tasks to`, 'project', project);
    notify(ctx, { kind: 'task', title: `${created.length} tasks added`, body: project.name, link: `/projects/${project.id}` });
    for (const task of created) emit({ type: 'task.changed', workspaceId: ctx.workspace.id, data: taskView(task) });
    return [201, created.map(taskView)];
  });

  router.patch('/api/tasks/:id', async ctx => {
    requireEdit(ctx);
    const task = findTask(ctx, ctx.params.id);
    const fields = readTaskFields(ctx.body, task);
    const statusChanged = fields.status && fields.status !== task.status;
    Object.assign(task, fields);
    if (ctx.body.assigneeId !== undefined) {
      const next = ctx.body.assigneeId || null;
      if (next && !membership(next, ctx.workspace.id)) fail(400, 'The assignee must be a workspace member');
      if (next && next !== task.assigneeId) notify(ctx, { kind: 'task', title: 'Task assigned to you', body: `${task.title} · ${task.project}`, link: `/projects/${task.projectId}?task=${task.id}`, to: [next] });
      task.assigneeId = next;
    }
    task.done = task.status === 'Done';
    task.updatedAt = now();
    if (statusChanged) {
      logActivity(ctx, `moved to ${task.status}`, 'task', task, { summary: task.title });
      const watchers = [task.ownerId, task.assigneeId].filter(Boolean);
      if (task.status === 'Done') notify(ctx, { kind: 'task', title: 'Task completed', body: `${task.title} · ${task.project}`, link: `/projects/${task.projectId}?task=${task.id}`, to: watchers });
    } else if (Object.keys(fields).length) logActivity(ctx, 'updated task', 'task', task, { summary: task.title });
    emit({ type: 'task.changed', workspaceId: ctx.workspace.id, data: taskView(task) });
    return taskView(task);
  });

  router.delete('/api/tasks/:id', async ctx => {
    requireEdit(ctx);
    const task = findTask(ctx, ctx.params.id);
    db.tasks = db.tasks.filter(t => t !== task);
    db.comments = db.comments.filter(c => c.taskId !== task.id);
    logActivity(ctx, 'deleted task', 'task', task, { summary: task.title });
    emit({ type: 'task.deleted', workspaceId: ctx.workspace.id, data: { id: task.id, projectId: task.projectId } });
    return { deleted: true };
  });

  // ---- Task comments with @mentions ----
  router.get('/api/tasks/:id/comments', async ctx => {
    const task = findTask(ctx, ctx.params.id);
    return db.comments.filter(c => c.taskId === task.id).map(c => ({ ...c, author: userById(c.userId)?.name || c.author || 'Former member', mine: c.userId === ctx.user.id }));
  });

  router.post('/api/tasks/:id/comments', async ctx => {
    requireEdit(ctx);
    const task = findTask(ctx, ctx.params.id);
    const body = str(ctx.body.body, { min: 1, max: 5000, field: 'Comment' });
    const comment = { id: id(), taskId: task.id, workspaceId: ctx.workspace.id, userId: ctx.user.id, author: ctx.user.name, body, createdAt: now() };
    db.comments.push(comment);
    const mentioned = mentionedUsers(body, ctx.workspace.id);
    const link = `/projects/${task.projectId}?task=${task.id}`;
    if (mentioned.length) notify(ctx, { kind: 'mention', title: `${ctx.user.name} mentioned you`, body: `${task.title}: ${body.slice(0, 140)}`, link, to: mentioned });
    const watchers = [task.ownerId, task.assigneeId, ...db.comments.filter(c => c.taskId === task.id).map(c => c.userId)].filter(x => x && !mentioned.includes(x));
    if (watchers.length) notify(ctx, { kind: 'comment', title: 'New comment on a task', body: `${ctx.user.name} on ${task.title}`, link, to: watchers });
    logActivity(ctx, 'commented on', 'task', task, { summary: task.title });
    emit({ type: 'comment.added', workspaceId: ctx.workspace.id, data: { taskId: task.id, comment: { ...comment, mine: false } } });
    return [201, { ...comment, mine: true }];
  });

  router.delete('/api/comments/:id', async ctx => {
    const comment = db.comments.find(c => c.id === ctx.params.id);
    const task = comment && db.tasks.find(t => t.id === comment.taskId && t.workspaceId === ctx.workspace.id);
    if (!task) fail(404, 'Comment not found');
    if (comment.userId !== ctx.user.id && !isAdmin(ctx)) fail(403, 'Only the author or an admin can delete this comment');
    db.comments = db.comments.filter(c => c !== comment);
    persist();
    return { deleted: true };
  });
}

/** Notify assignees (or task creators) once about tasks due today or tomorrow. */
export function runDeadlineReminders() {
  const local = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = local(new Date());
  const tomorrow = local(new Date(Date.now() + 86_400_000));
  let changed = false;
  for (const task of db.tasks) {
    if (task.status === 'Done' || ![today, tomorrow].includes(task.date) || task.remindedFor === task.date) continue;
    const userId = task.assigneeId || task.ownerId;
    const user = userById(userId);
    task.remindedFor = task.date;
    changed = true;
    if (!user || !membership(userId, task.workspaceId) || user.notificationPrefs?.deadline === false) continue;
    const notification = { id: id(), workspaceId: task.workspaceId, userId, kind: 'deadline', title: task.date === today ? 'Task due today' : 'Task due tomorrow', body: `${task.title} · ${task.project}`, link: `/projects/${task.projectId}?task=${task.id}`, read: false, createdAt: now() };
    db.notifications.unshift(notification);
    emit({ type: 'notification', userId, data: notification });
  }
  if (changed) persist();
}
