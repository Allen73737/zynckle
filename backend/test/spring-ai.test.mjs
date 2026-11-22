import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

// End-to-end checks for the Spring Boot AI + RAG layer. Boots the packaged jar
// (build it first: mvnw -o -DskipTests package) in a throwaway directory, against a mock
// OpenAI-compatible provider that also serves deterministic embeddings.
const jar = resolve(import.meta.dirname, '..', 'target', 'zynckle-api-0.1.0.jar');
const skip = existsSync(jar) ? false : 'target/zynckle-api-0.1.0.jar not built';

const requests = { chat: [] };
const DIMS = 64;
const fakeEmbedding = text => {
  const v = new Array(DIMS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z]{3,}/g) || []) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIMS] += 1;
  }
  return v;
};
/** Mock re-ranker: puts the candidate mentioning refunds first, keeps two others. */
const rankRefundsFirst = text => {
  const lines = text.split('\n').filter(l => /^\[\d+\]/.test(l));
  const refund = lines.findIndex(l => /refund/i.test(l)) + 1;
  const rest = lines.map((_, i) => i + 1).filter(n => n !== refund).slice(0, 2);
  return JSON.stringify({ ranking: [refund, ...rest].filter(n => n > 0) });
};
const mock = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url.endsWith('/embeddings')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: fakeEmbedding(text) })) }));
    }
    requests.chat.push(body);
    const system = body.messages[0].content;
    const answer = system.includes('rewrite a user') ? '{"standalone":"How do refunds settle?","queries":["refund settlement window","ledger reversal"]}'
      : system.includes('You rank search results') ? rankRefundsFirst(body.messages[1].content)
      : 'Refunds settle within five business days [1].';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const piece of answer.match(/.{1,12}/g)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

const port = 20000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let server; let dir;

const users = {};
async function api(path, { method = 'GET', body, raw, headers: extra = {}, token = users.ada?.token } = {}) {
  const headers = { ...(body ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
  const response = await fetch(base + path, { method, body: raw ?? (body ? JSON.stringify(body) : undefined), headers });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, type, data: type.includes('json') ? await response.json() : await response.text() };
}
/** Build a ZIP in memory so the tests can craft hostile archives. */
function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name); const packed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const frames = text => text.split('\n\n').filter(Boolean).map(frame => ({ event: frame.match(/^event: (.+)$/m)?.[1], data: JSON.parse(frame.match(/^data: (.+)$/m)?.[1] || 'null') }));

before(async () => {
  if (skip) return;
  await new Promise(ok => mock.listen(0, '127.0.0.1', ok));
  const mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;
  dir = await mkdtemp(join(tmpdir(), 'zynckle-spring-'));
  const env = { ...process.env, PORT: String(port), CUSTOM_AI_URL: mockUrl, CUSTOM_AI_MODEL: 'mock-model', EMBEDDING_URL: `${mockUrl}/embeddings`, EMBEDDING_MODEL: 'mock-embed', RAG_MIN_SIMILARITY: '0.5' };
  for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_PROVIDER', 'DATABASE_URL', 'RAG_EMBEDDINGS']) delete env[key];
  // cwd is the temp dir: the H2 database, vector cache and .env lookup all stay isolated.
  // Lean JVM flags: this suite often runs on memory-constrained laptops.
  server = spawn('java', ['-Xmx384m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-jar', jar], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Always drain both pipes: a full stderr buffer would block the JVM mid-startup.
  let logTail = '';
  const keep = d => { logTail = (logTail + d).slice(-4000); };
  server.stderr.on('data', keep);
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`Spring Boot did not start within 300s\n${logTail}`)), 300_000);
    server.stdout.on('data', d => { keep(d); if (/Started ZynckleApplication/.test(logTail)) { clearTimeout(timer); ok(); } });
    server.on('exit', code => fail(new Error(`java exited ${code}\n${logTail}`)));
  });
}, { timeout: 320_000 });
after(async () => { server?.kill(); mock.close(); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

const register = async (key, name) => {
  const r = await api('/api/auth/register', { method: 'POST', token: null, body: { name, email: `${key}@example.com`, password: 'correct-horse-1' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return (users[key] = { token: r.data.token, id: r.data.user.id, adopted: r.data.adoptedExistingWorkspace });
};

test('accounts: sign-in is required, passwords are checked, first account adopts existing data', { skip }, async () => {
  assert.equal((await api('/api/projects', { token: null })).status, 401);
  assert.equal((await api('/api/projects', { token: 'forged-token' })).status, 401);
  assert.equal((await api('/api/auth/register', { method: 'POST', token: null, body: { name: 'X', email: 'bad', password: 'short' } })).status, 400);
  const ada = await register('ada', 'Ada Lovelace');
  assert.equal(ada.adopted, true);
  const projects = await api('/api/projects');
  assert.ok(projects.data.some(p => p.name === 'Zynckle Core Studio'), 'seeded data stays with the first account');
  const core = projects.data.find(p => p.name === 'Zynckle Core Studio');
  assert.equal(core.progress, 50, 'progress is computed from tasks (1 of 2 done)');
  assert.equal((await api('/api/auth/register', { method: 'POST', token: null, body: { name: 'Ada', email: 'ada@example.com', password: 'correct-horse-1' } })).status, 409);
  assert.equal((await api('/api/auth/login', { method: 'POST', token: null, body: { email: 'ada@example.com', password: 'wrong-password-1' } })).status, 401);
  const login = await api('/api/auth/login', { method: 'POST', token: null, body: { email: 'ada@example.com', password: 'correct-horse-1' } });
  assert.equal(login.status, 200);
  const me = await api('/api/auth/me', { token: login.data.token });
  assert.equal(me.data.email, 'ada@example.com');
  assert.equal(me.data.role, 'OWNER');
  const sessions = await api('/api/auth/sessions');
  assert.equal(sessions.data.length, 2);
  await api('/api/auth/logout', { method: 'POST', token: login.data.token });
  assert.equal((await api('/api/auth/me', { token: login.data.token })).status, 401);
});

test('workspaces isolate data; invites and roles are enforced', { skip }, async () => {
  const eve = await register('eve', 'Eve Outsider');
  assert.equal(eve.adopted, false);
  assert.equal((await api('/api/projects', { token: eve.token })).data.length, 0);
  const secret = await api('/api/documents', { method: 'POST', body: { title: 'Zebracorn roadmap', content: '<p>zebracorn launch plan</p>', type: 'rich-text' } });
  assert.equal((await api(`/api/documents/${secret.data.id}`, { token: eve.token })).status, 404);
  assert.equal((await api('/api/ai/knowledge/search?q=zebracorn', { token: eve.token })).data.results.length, 0);
  assert.equal((await api('/api/ai/knowledge/search?q=zebracorn')).data.results[0]?.title, 'Zebracorn roadmap');

  const bob = await register('bob', 'Bob Viewer');
  const invite = await api('/api/team/invitations', { method: 'POST', body: { email: 'bob@example.com', role: 'VIEWER' } });
  assert.equal(invite.status, 201);
  const token = invite.data.inviteUrl.split('=')[1];
  assert.equal((await api('/api/team/invitations/accept', { method: 'POST', token: eve.token, body: { token } })).status, 403);
  assert.equal((await api('/api/team/invitations/accept', { method: 'POST', token: bob.token, body: { token } })).status, 200);
  const team = await api('/api/team');
  assert.equal(team.data.members.length, 2);
  assert.ok((await api('/api/projects', { token: bob.token })).data.some(p => p.name === 'Zynckle Core Studio'));
  assert.equal((await api('/api/projects', { method: 'POST', token: bob.token, body: { name: 'Nope' } })).status, 403);
  assert.equal((await api('/api/team/invitations', { method: 'POST', token: bob.token, body: { email: 'z@example.com' } })).status, 403);
  const project = (await api('/api/projects')).data[0];
  const task = await api(`/api/projects/${project.id}/tasks`, { method: 'POST', body: { title: 'Review copy', assigneeId: bob.id, status: 'In progress' } });
  assert.equal(task.status, 201);
  assert.equal(task.data.assignee.name, 'Bob Viewer');
  assert.ok((await api('/api/notifications', { token: bob.token })).data.some(n => n.title === 'Task assigned to you'));
  assert.equal((await api(`/api/tasks/${task.data.id}`, { method: 'PATCH', body: { status: 'Nope' } })).status, 400);
  assert.equal((await api(`/api/tasks/${task.data.id}`, { method: 'PATCH', token: eve.token, body: { status: 'Done' } })).status, 404);
});

test('drive and code projects: uploads, privacy, safe ZIP import, versions, search, sandboxed sites', { skip }, async () => {
  const upload = (name, data, token) => api('/api/files/upload', { method: 'POST', raw: Buffer.from(data), token, headers: { 'x-file-name': encodeURIComponent(name) } });
  const note = await upload('release-notes.md', '# Release\nThe aurora flag ships on Friday.');
  assert.equal(note.status, 201, JSON.stringify(note.data));
  assert.equal((await upload('evil.exe', 'MZ')).status, 415);
  const fetched = await api(`/api/files/${note.data.id}`);
  assert.match(fetched.data.content, /aurora flag/);
  const image = await upload('logo.png', 'PNG fake');
  const signed = await api(`/api/files/${image.data.id}`);
  assert.match(signed.data.url, /\/content\?exp=/);
  const viaLink = await fetch(base + signed.data.url);
  assert.equal(viaLink.status, 200, 'signed links work without a bearer token');
  assert.match(viaLink.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(base + signed.data.url.replace(/sig=[^&]+/, 'sig=forged'))).status, 403);
  await api(`/api/files/${note.data.id}`, { method: 'PATCH', body: { visibility: 'private' } });
  assert.ok(!(await api('/api/files', { token: users.bob.token })).data.some(f => f.id === note.data.id), 'private files are hidden from other members');
  assert.ok((await api('/api/storage/usage')).data.usedBytes > 0);

  const project = await api('/api/code-projects', { method: 'POST', body: { name: 'ledger-service' } });
  assert.equal(project.status, 201);
  const archive = zip([
    { name: 'repo/index.html', data: Buffer.from('<h1>Ledger</h1>') },
    { name: 'repo/src/settle.js', data: Buffer.from('export function settleBatch(entries) {\n  return entries.filter(e => e.cleared);\n}\n') },
    { name: 'repo/../../escape.txt', data: Buffer.from('nope') },
  ]);
  const imported = await api(`/api/code-projects/${project.data.id}/zip`, { method: 'POST', raw: archive });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.added, 2);
  assert.equal(imported.data.skipped.length, 1, 'path traversal entries are skipped');
  const files = await api(`/api/code-projects/${project.data.id}/files`);
  assert.deepEqual(files.data.map(f => f.path).sort(), ['index.html', 'src/settle.js']);
  const js = files.data.find(f => f.path === 'src/settle.js');
  await api(`/api/code-projects/${project.data.id}/files`, { method: 'POST', raw: Buffer.from('export const v2 = true;\n'), headers: { 'x-file-path': 'src/settle.js' } });
  assert.equal((await api(`/api/code-files/${js.id}/versions`)).data.length, 2);
  assert.match((await api(`/api/code-files/${js.id}?version=0`)).data.content, /settleBatch/);
  const hits = await api(`/api/code-projects/${project.data.id}/search?q=v2`);
  assert.equal(hits.data.results[0].path, 'src/settle.js');
  const site = await api(`/api/code-projects/${project.data.id}/site`);
  const page = await fetch(base + site.data.url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.match(await page.text(), /Ledger/);
  assert.equal((await api(`/api/code-projects/${project.data.id}`, { token: users.eve.token })).status, 404);
  const found = await api('/api/ai/knowledge/search?q=v2&types=code-file');
  assert.equal(found.data.results[0]?.title, 'src/settle.js', 'code is part of workspace knowledge');
});

test('status reports the configured provider honestly', { skip }, async () => {
  const status = await api('/api/ai/status');
  assert.equal(status.data.available, true);
  assert.equal(status.data.defaultProvider, 'custom');
  assert.equal(status.data.providers.find(p => p.id === 'groq').configured, false);
});

test('knowledge index covers seeded and new content with hybrid ranking', { skip }, async () => {
  await api('/api/documents', { method: 'POST', body: { title: 'Refund policy', content: '<h1>Payments</h1><h2>Refunds</h2><p>Refunds settle within five business days through a ledger reversal.</p>', type: 'rich-text' } });
  const status = await api('/api/ai/knowledge/reindex', { method: 'POST', body: { wait: true } });
  assert.equal(status.data.engine, 'spring-boot');
  assert.equal(status.data.retrieval, 'hybrid');
  assert.ok(status.data.byType.project >= 2 && status.data.byType.task >= 3, JSON.stringify(status.data.byType));
  assert.equal(status.data.embeddings.pending, 0, JSON.stringify(status.data.embeddings));
  const hits = await api('/api/ai/knowledge/search?q=refund%20settlement');
  assert.equal(hits.data.mode, 'hybrid');
  assert.equal(hits.data.results[0].title, 'Refund policy');
  assert.match(hits.data.results[0].section, /Refunds/);
  const tasks = await api('/api/ai/knowledge/search?q=persistence&types=task');
  assert.ok(tasks.data.results.length && tasks.data.results.every(r => r.type === 'task'));
  assert.equal((await api('/api/ai/knowledge/search?q=zzqxv')).data.results.length, 0);
});

test('streamed answers carry numbered, retrieved sources and persist', { skip }, async () => {
  requests.chat.length = 0;
  const response = await api('/api/ai/stream', { method: 'POST', body: { persist: true, message: 'How long do refunds take to settle?' } });
  assert.match(response.type, /text\/event-stream/);
  const events = frames(response.data);
  const meta = events.find(e => e.event === 'meta').data;
  assert.equal(meta.retrieval.rag, 'auto');
  assert.ok(meta.sources.some(s => s.retrieved && s.label === 'Refund policy' && s.link.startsWith('/documents?doc=')));
  assert.ok(meta.sources.every((s, i) => s.n === i + 1));
  assert.equal(events.filter(e => e.event === 'delta').map(e => e.data.text).join(''), 'Refunds settle within five business days [1].');
  const prompt = requests.chat[0].messages.map(m => m.content).join('\n');
  assert.match(prompt, /<context source="\[1\]/);
  assert.match(prompt, /Cite the passages/);
  const saved = await api(`/api/ai/conversations/${meta.conversationId}`);
  assert.equal(saved.data.messages.length, 2);
  assert.ok(saved.data.messages[1].sources.some(s => s.retrieved));
  assert.ok((await api('/api/ai/conversations')).data.some(c => c.id === meta.conversationId));
  const pinned = await api(`/api/ai/conversations/${meta.conversationId}`, { method: 'PATCH', body: { pinned: true } });
  assert.equal(pinned.data.pinned, true);
});

test('actions index, feedback, quality review, insights and the daily brief', { skip }, async () => {
  // Editors get the action rules plus a workspace id index; viewers never do.
  requests.chat.length = 0;
  const editor = frames((await api('/api/ai/stream', { method: 'POST', body: { persist: true, message: 'Plan the launch tasks for me' } })).data);
  const system = requests.chat[0].messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  assert.match(system, /zynckle-actions/);
  assert.match(system, /Workspace index \(ids for actions\)/);
  assert.match(system, /Zynckle Core Studio/);
  requests.chat.length = 0;
  await api('/api/ai/stream', { method: 'POST', token: users.bob.token, body: { messages: [{ role: 'user', content: 'Plan the launch tasks' }] } });
  assert.ok(!requests.chat[0].messages.some(m => m.content.includes('zynckle-actions')));

  // Feedback is stored on the answer and only its owner can rate it.
  const conversationId = editor.find(e => e.event === 'meta').data.conversationId;
  const messageId = editor.find(e => e.event === 'done').data.messageId;
  assert.equal((await api(`/api/ai/messages/${messageId}/feedback`, { method: 'PATCH', token: users.bob.token, body: { rating: -1 } })).status, 404);
  assert.equal((await api(`/api/ai/messages/${messageId}/feedback`, { method: 'PATCH', body: { rating: -1, note: 'Missed the deadline' } })).data.feedback, -1);
  assert.equal((await api(`/api/ai/conversations/${conversationId}`)).data.messages[1].feedback, -1);
  const quality = await api('/api/ai/quality');
  assert.equal(quality.data.unhelpful, 1);
  assert.equal(quality.data.flagged[0].question, 'Plan the launch tasks for me');
  assert.equal((await api('/api/ai/quality', { token: users.bob.token })).status, 403);

  // Insights are computed from real dates; the brief receives them as context.
  const project = (await api('/api/projects')).data.find(p => p.name === 'Zynckle Core Studio');
  await api(`/api/projects/${project.id}/tasks`, { method: 'POST', body: { title: 'Renew TLS certificate', date: '2020-01-01', priority: 'Urgent' } });
  const health = await api('/api/insights');
  assert.ok(health.data.overdue.some(t => t.title === 'Renew TLS certificate' && t.daysLate > 0));
  assert.notEqual(health.data.projects.find(p => p.id === project.id).health, 'on-track');
  requests.chat.length = 0;
  await api('/api/ai/stream', { method: 'POST', body: { mode: 'brief', rag: 'off', messages: [{ role: 'user', content: 'Write my daily brief' }] } });
  const brief = requests.chat[0].messages.map(m => m.content).join('\n');
  assert.match(brief, /daily brief/);
  assert.match(brief, /Renew TLS certificate/);
});

test('deep mode plans queries; off mode sends no passages; errors are honest', { skip }, async () => {
  for (const [title, text] of [['Ledger runbook', 'A ledger reversal posts a compensating entry.'], ['Settlement FAQ', 'The settlement window closes at 18:00 UTC.'], ['Finance glossary', 'Settlement: final transfer of funds; reversal: undo of a ledger entry.']]) {
    await api('/api/documents', { method: 'POST', body: { title, content: `<p>${text}</p>`, type: 'rich-text' } });
  }
  requests.chat.length = 0;
  const deep = frames((await api('/api/ai/stream', { method: 'POST', body: { rag: 'deep', messages: [{ role: 'user', content: 'and how long for those?' }] } })).data);
  assert.equal(requests.chat.length, 3, 'planning, re-ranking, then the answer');
  const deepMeta = deep.find(e => e.event === 'meta').data;
  assert.ok(deepMeta.retrieval.queries.includes('ledger reversal'));
  assert.equal(deepMeta.retrieval.reranked, true);
  assert.equal(deepMeta.sources.filter(s => s.retrieved)[0].label, 'Refund policy', 'the re-ranker order wins');
  assert.ok(deepMeta.sources.filter(s => s.retrieved).length <= 3, 'candidates the re-ranker dropped are not sent');

  requests.chat.length = 0;
  const off = frames((await api('/api/ai/stream', { method: 'POST', body: { rag: 'off', messages: [{ role: 'user', content: 'Refunds?' }] } })).data);
  assert.equal(off.find(e => e.event === 'meta').data.retrieval, null);
  assert.ok(!requests.chat[0].messages.some(m => m.content.includes('<context source=')));

  const bad = await api('/api/ai/stream', { method: 'POST', body: { messages: [] } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /between 1 and 60/);
  assert.equal((await api('/api/ai/conversations/nope')).status, 404);
});
