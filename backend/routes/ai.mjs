import { db, persist } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';
import { fail, str, rateLimit, HttpError, securityHeaders } from '../lib/http.mjs';
import { now, id, canSee, requireEdit, userById, publicUser, logActivity } from '../lib/core.mjs';
import { aiStatus, resolveProvider, streamChat, completeChat, modePrompts, architectureSections } from '../lib/ai.mjs';
import { readCodeFile } from './code.mjs';

const MODES = Object.keys(modePrompts);
const CONTEXT_CHARS = Number(process.env.AI_CONTEXT_CHARS || 28_000);
const KEY_FILES = /(^|\/)(readme(\.\w+)?|package\.json|pom\.xml|build\.gradle(\.kts)?|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|composer\.json|docker-compose\.ya?ml|dockerfile|\.env\.example|schema\.(sql|prisma)|openapi\.(ya?ml|json))$/i;

const plain = html => String(html || '').replace(/<(br|\/p|\/h\d|\/li)>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const numbered = text => text.split(/\r?\n/).map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n');

/** Build the context block from data the caller is authorised to see. */
async function buildContext(ctx, spec = {}, mode = 'general') {
  const blocks = [];
  const sources = [];
  let budget = CONTEXT_CHARS;
  const add = (label, text, source) => {
    if (budget <= 200 || !text) return;
    const slice = text.length > budget ? `${text.slice(0, budget)}\n…[truncated]` : text;
    budget -= slice.length;
    blocks.push(`<context source="${label.replace(/"/g, "'")}">\n${slice}\n</context>`);
    sources.push(source);
  };
  const ws = ctx.workspace.id;

  if (spec.projectId) {
    const project = db.projects.find(p => p.id === spec.projectId && p.workspaceId === ws);
    if (project) {
      const tasks = db.tasks.filter(t => t.projectId === project.id);
      add(`project: ${project.name}`, [
        `Project: ${project.name}`, `Status: ${project.status}`, `Deadline: ${project.due || 'not set'}`, `Tags: ${(project.tags || []).join(', ') || 'none'}`,
        `Description: ${project.description || '(none)'}`, `Tasks (${tasks.length}):`,
        ...tasks.slice(0, 80).map(t => `- [${t.status}] ${t.title} (priority ${t.priority}${t.date && t.date !== 'No date' ? `, due ${t.date}` : ''}${t.assigneeId ? `, assigned to ${userById(t.assigneeId)?.name}` : ''})${t.description ? ` — ${t.description.slice(0, 160)}` : ''}`),
      ].join('\n'), { type: 'project', id: project.id, label: project.name });
    }
  }
  for (const docId of (spec.documentIds || []).slice(0, 6)) {
    const doc = db.documents.find(d => d.id === docId);
    if (canSee(doc, ctx)) add(`document: ${doc.title}`, doc.type === 'latex' ? doc.content : plain(doc.content), { type: 'document', id: doc.id, label: doc.title });
  }
  const codeProject = spec.codeProjectId && db.codeProjects.find(p => p.id === spec.codeProjectId);
  if (codeProject && canSee(codeProject, ctx)) {
    const files = db.codeFiles.filter(f => f.codeProjectId === codeProject.id);
    add(`code project tree: ${codeProject.name}`, `${codeProject.name}${codeProject.description ? ` — ${codeProject.description}` : ''}\n${files.map(f => `${f.path} (${f.sizeBytes} bytes)`).slice(0, 400).join('\n')}`, { type: 'code-project', id: codeProject.id, label: `${codeProject.name} (file tree)` });
    if (['docs', 'general', 'architecture', 'database'].includes(mode) && !(spec.codeFileIds || []).length) {
      for (const file of files.filter(f => KEY_FILES.test(f.path) && !f.binary).slice(0, 8)) {
        add(`file: ${file.path}`, (await readCodeFile(file)).toString('utf8'), { type: 'code-file', id: file.id, label: file.path });
      }
    }
  }
  for (const fileId of (spec.codeFileIds || []).slice(0, 12)) {
    const file = db.codeFiles.find(f => f.id === fileId && f.workspaceId === ws);
    if (!file || file.binary || !canSee(db.codeProjects.find(p => p.id === file.codeProjectId), ctx)) continue;
    const text = (await readCodeFile(file)).toString('utf8');
    add(`file: ${file.path}`, ['review', 'bug', 'explain'].includes(mode) ? numbered(text) : text, { type: 'code-file', id: file.id, label: file.path });
  }
  if (spec.workspace) {
    const projects = db.projects.filter(p => p.workspaceId === ws && !p.archived);
    add('workspace overview', `Workspace: ${ctx.workspace.name}\nProjects:\n${projects.map(p => `- ${p.name} (${p.status}; ${db.tasks.filter(t => t.projectId === p.id && t.status !== 'Done').length} open tasks)`).join('\n') || '(none)'}`, { type: 'workspace', id: ws, label: 'Workspace overview' });
  }
  return { text: blocks.join('\n\n'), sources };
}

function checkLimits(ctx) {
  rateLimit(`ai:${ctx.user.id}`, config.ai.requestsPerMinute, 60_000);
  const day = new Date().toISOString().slice(0, 10);
  let usage = db.aiUsage.find(u => u.userId === ctx.user.id && u.day === day);
  if (!usage) { db.aiUsage = db.aiUsage.filter(u => u.day === day); usage = { userId: ctx.user.id, day, count: 0 }; db.aiUsage.push(usage); }
  if (usage.count >= config.ai.requestsPerDay) fail(429, `Daily AI limit of ${config.ai.requestsPerDay} requests reached. It resets at midnight UTC.`);
  usage.count++;
  persist();
}

function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > 60) fail(400, 'Provide between 1 and 60 messages');
  return list.filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 16_000) })).slice(-30);
}

/** Assemble provider messages for a request; returns everything the stream needs. */
async function prepare(ctx) {
  const body = ctx.body;
  const mode = MODES.includes(body.mode) ? body.mode : 'general';
  const provider = resolveProvider(body.provider || ctx.user.preferences?.aiProvider, body.model || ctx.user.preferences?.aiModel);
  const context = await buildContext(ctx, body.context || {}, mode);
  let history;
  let conversation = null;
  let section = null;
  if (mode === 'architecture') {
    section = Object.hasOwn(architectureSections, body.section) ? body.section : fail(400, 'Unknown architecture section');
    const description = str(body.description, { min: 20, max: 8000, field: 'Project description' });
    const overview = typeof body.overview === 'string' && section !== 'overview' ? body.overview.slice(0, 6000) : '';
    history = [{ role: 'user', content: `Project description from the user:\n"""\n${description}\n"""\n${overview ? `\nAgreed system overview (keep consistent with it):\n"""\n${overview}\n"""\n` : ''}${body.guidance ? `\nExtra guidance for this section: ${String(body.guidance).slice(0, 1000)}\n` : ''}\nWrite this section now: ${architectureSections[section]}` }];
  } else if (body.conversationId) {
    conversation = db.aiConversations.find(c => c.id === body.conversationId && c.userId === ctx.user.id && c.workspaceId === ctx.workspace.id);
    if (!conversation) fail(404, 'Conversation not found');
    const message = str(body.message, { min: 1, max: 16_000, field: 'Message', trim: false });
    if (body.regenerate) { while (conversation.messages.at(-1)?.role === 'assistant') conversation.messages.pop(); }
    else conversation.messages.push({ id: id(), role: 'user', content: message, createdAt: now() });
    if (body.context) conversation.context = body.context;
    history = conversation.messages.slice(-30).map(({ role, content }) => ({ role, content }));
  } else if (body.persist) {
    const message = str(body.message, { min: 1, max: 16_000, field: 'Message', trim: false });
    conversation = { id: id(), workspaceId: ctx.workspace.id, userId: ctx.user.id, title: message.replace(/\s+/g, ' ').slice(0, 70), mode, context: body.context || {}, messages: [{ id: id(), role: 'user', content: message, createdAt: now() }], createdAt: now(), updatedAt: now() };
    db.aiConversations.unshift(conversation);
    history = conversation.messages.map(({ role, content }) => ({ role, content }));
  } else {
    history = cleanMessages(body.messages);
  }
  const system = `${modePrompts[mode]}\n\nToday is ${new Date().toISOString().slice(0, 10)}. The user is ${ctx.user.name} in workspace "${ctx.workspace.name}".`;
  const messages = [{ role: 'system', content: system }];
  if (context.text) messages.push({ role: 'system', content: `Reference material for this request:\n${context.text}` });
  messages.push(...history);
  const temperature = mode === 'planner' || section === 'components' ? 0.2 : mode === 'review' || mode === 'docs' ? 0.25 : 0.4;
  return { mode, provider, messages, temperature, conversation, sources: context.sources, section };
}

const conversationSummary = c => ({ id: c.id, title: c.title, mode: c.mode, updatedAt: c.updatedAt, createdAt: c.createdAt, messageCount: c.messages.length, pinned: Boolean(c.pinned) });

export default function register(router) {
  router.get('/api/ai/status', async () => aiStatus(), { auth: false });

  // Non-streaming endpoint kept for simple callers.
  router.post('/api/ai/chat', async ctx => {
    checkLimits(ctx);
    const prepared = await prepare(ctx);
    const message = await completeChat({ providerId: prepared.provider.providerId, model: prepared.provider.model, messages: prepared.messages, temperature: prepared.temperature });
    return { message, model: prepared.provider.model, provider: prepared.provider.label, sources: prepared.sources };
  });

  /** Server-sent events: meta → many delta frames → done (or error). */
  router.post('/api/ai/stream', async ctx => {
    checkLimits(ctx);
    const prepared = await prepare(ctx);
    const { res, req } = ctx;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    res.writeHead(200, { ...securityHeaders(req), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const sendEvent = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    sendEvent('meta', { conversationId: prepared.conversation?.id || null, provider: prepared.provider.label, providerId: prepared.provider.providerId, model: prepared.provider.model, sources: prepared.sources, mode: prepared.mode, section: prepared.section });
    let text = '';
    try {
      for await (const delta of streamChat({ providerId: prepared.provider.providerId, model: prepared.provider.model, messages: prepared.messages, temperature: prepared.temperature, signal: controller.signal })) {
        text += delta;
        sendEvent('delta', { text: delta });
      }
      let messageId = null;
      if (prepared.conversation && text) {
        messageId = id();
        prepared.conversation.messages.push({ id: messageId, role: 'assistant', content: text, createdAt: now(), provider: prepared.provider.label, model: prepared.provider.model, sources: prepared.sources });
        prepared.conversation.updatedAt = now();
        persist();
      }
      if (ctx.body.architectureId && prepared.section && text) {
        const design = db.architectures.find(a => a.id === ctx.body.architectureId && canSee(a, ctx));
        if (design && ctx.role !== 'VIEWER') { design.sections[prepared.section] = { content: text, updatedAt: now(), model: prepared.provider.model }; design.updatedAt = now(); persist(); }
      }
      sendEvent('done', { messageId, length: text.length });
    } catch (error) {
      if (prepared.conversation && !text && !ctx.body.regenerate && prepared.conversation.messages.length === 1) {
        db.aiConversations = db.aiConversations.filter(c => c !== prepared.conversation);
        persist();
      }
      sendEvent('error', { error: error instanceof HttpError ? error.message : 'The AI response was interrupted', status: error.status || 502 });
    }
    res.end();
  });

  // ---- Conversations (private to each user) ----
  router.get('/api/ai/conversations', async ctx => db.aiConversations.filter(c => c.userId === ctx.user.id && c.workspaceId === ctx.workspace.id)
    .sort((a, b) => Number(b.pinned || 0) - Number(a.pinned || 0) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 200).map(conversationSummary));

  const findConversation = ctx => {
    const conversation = db.aiConversations.find(c => c.id === ctx.params.id && c.userId === ctx.user.id);
    if (!conversation) fail(404, 'Conversation not found');
    return conversation;
  };
  router.get('/api/ai/conversations/:id', async ctx => findConversation(ctx));
  router.patch('/api/ai/conversations/:id', async ctx => {
    const conversation = findConversation(ctx);
    if (ctx.body.title !== undefined) conversation.title = str(ctx.body.title, { min: 1, max: 120, field: 'Title' });
    if (ctx.body.pinned !== undefined) conversation.pinned = Boolean(ctx.body.pinned);
    persist();
    return conversationSummary(conversation);
  });
  router.delete('/api/ai/conversations/:id', async ctx => {
    const conversation = findConversation(ctx);
    db.aiConversations = db.aiConversations.filter(c => c !== conversation);
    persist();
    return { deleted: true };
  });

  // ---- Architecture designs (shared in the workspace) ----
  const designView = a => ({ ...a, owner: publicUser(userById(a.ownerId)), project: db.projects.find(p => p.id === a.projectId)?.name || null });
  router.get('/api/ai/architectures', async ctx => db.architectures.filter(a => canSee(a, ctx)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(a => ({ id: a.id, title: a.title, project: db.projects.find(p => p.id === a.projectId)?.name || null, updatedAt: a.updatedAt, sectionCount: Object.keys(a.sections || {}).length, owner: userById(a.ownerId)?.name })));
  router.post('/api/ai/architectures', async ctx => {
    requireEdit(ctx);
    const design = {
      id: id(), workspaceId: ctx.workspace.id, ownerId: ctx.user.id, visibility: 'workspace',
      title: str(ctx.body.title, { min: 1, max: 120, field: 'Title' }), description: str(ctx.body.description, { max: 8000, field: 'Description' }),
      projectId: ctx.body.projectId && db.projects.some(p => p.id === ctx.body.projectId && p.workspaceId === ctx.workspace.id) ? ctx.body.projectId : null,
      codeProjectId: ctx.body.codeProjectId || null, sections: {}, createdAt: now(), updatedAt: now(),
    };
    db.architectures.unshift(design);
    logActivity(ctx, 'started architecture design', 'architecture', design, { summary: design.title });
    return [201, designView(design)];
  });
  const findDesign = ctx => {
    const design = db.architectures.find(a => a.id === ctx.params.id);
    if (!canSee(design, ctx)) fail(404, 'Architecture design not found');
    return design;
  };
  router.get('/api/ai/architectures/:id', async ctx => designView(findDesign(ctx)));
  router.patch('/api/ai/architectures/:id', async ctx => {
    requireEdit(ctx);
    const design = findDesign(ctx);
    if (ctx.body.title !== undefined) design.title = str(ctx.body.title, { min: 1, max: 120, field: 'Title' });
    if (ctx.body.description !== undefined) design.description = str(ctx.body.description, { max: 8000, field: 'Description' });
    if (ctx.body.projectId !== undefined) design.projectId = ctx.body.projectId && db.projects.some(p => p.id === ctx.body.projectId && p.workspaceId === ctx.workspace.id) ? ctx.body.projectId : null;
    if (ctx.body.sections && typeof ctx.body.sections === 'object') {
      for (const [key, value] of Object.entries(ctx.body.sections)) {
        if (!Object.hasOwn(architectureSections, key)) continue;
        if (value === null) delete design.sections[key];
        else design.sections[key] = { ...(design.sections[key] || {}), content: str(value, { max: 60_000, field: 'Section', trim: false }), updatedAt: now(), edited: true };
      }
    }
    design.updatedAt = now();
    persist();
    return designView(design);
  });
  router.delete('/api/ai/architectures/:id', async ctx => {
    requireEdit(ctx);
    const design = findDesign(ctx);
    if (design.ownerId !== ctx.user.id && !['OWNER', 'ADMIN'].includes(ctx.role)) fail(403, 'Only the author or an admin can delete this design');
    db.architectures = db.architectures.filter(a => a !== design);
    persist();
    return { deleted: true };
  });
}
