import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import WebSocket from 'ws';

const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let server; let dir;

async function api(path, { token, method = 'GET', body, headers = {}, raw } = {}) {
  const response = await fetch(base + path, {
    method, body: raw ?? (body ? JSON.stringify(body) : undefined),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}

/** Build a ZIP in memory; lets the tests craft hostile archives. */
function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data, method = 8 } of entries) {
    const nameBytes = Buffer.from(name); const body = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zynckle-test-'));
  server = spawn(process.execPath, [resolve(import.meta.dirname, '..', 'server.mjs')], {
    env: { ...process.env, PORT: String(port), ZYNCKLE_DATA_FILE: join(dir, 'workspace.json'), ZYNCKLE_ENV_FILE: join(dir, 'none.env'), GROQ_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', R2_ENDPOINT: '', AUTH_RATE_PER_MINUTE: '500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fail) => {
    server.stdout.on('data', d => { if (String(d).includes('listening')) ok(); });
    server.on('exit', code => fail(new Error(`server exited ${code}`)));
  });
});
after(async () => { server.kill(); await rm(dir, { recursive: true, force: true }); });

const users = {};
const register = async (key, name) => {
  const r = await api('/api/auth/register', { method: 'POST', body: { name, email: `${key}@example.com`, password: 'correct-horse-1' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  users[key] = { token: r.data.token, id: r.data.user.id, workspace: r.data.workspace };
  return users[key];
};

test('registration validates input and issues a session', async () => {
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { name: 'X', email: 'bad', password: 'short' } })).status, 400);
  const ada = await register('ada', 'Ada Lovelace');
  assert.ok(ada.token);
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { name: 'Ada', email: 'ada@example.com', password: 'correct-horse-1' } })).status, 409);
  const me = await api('/api/auth/me', { token: ada.token });
  assert.equal(me.data.role, 'OWNER');
  assert.equal(me.data.emailVerified, false);
  assert.equal((await api('/api/auth/me')).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'ada@example.com', password: 'wrong-password-1' } })).status, 401);
});

test('password reset and email verification flow', async () => {
  const forgot = await api('/api/auth/forgot', { method: 'POST', body: { email: 'ada@example.com' } });
  assert.equal(forgot.status, 200);
  assert.match(forgot.data.resetUrl, /reset-password\?token=/);
  const token = new URL(forgot.data.resetUrl).searchParams.get('token');
  assert.equal((await api('/api/auth/reset', { method: 'POST', body: { token, password: 'tiny' } })).status, 400);
  const reset = await api('/api/auth/reset', { method: 'POST', body: { token: 'nope', password: 'brand-new-pass-2' } });
  assert.equal(reset.status, 400);
  const ok = await api('/api/auth/forgot', { method: 'POST', body: { email: 'ada@example.com' } });
  const done = await api('/api/auth/reset', { method: 'POST', body: { token: new URL(ok.data.resetUrl).searchParams.get('token'), password: 'brand-new-pass-2' } });
  assert.equal(done.status, 200);
  users.ada.token = done.data.token;
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'ada@example.com', password: 'brand-new-pass-2' } })).status, 200);
  const unknown = await api('/api/auth/forgot', { method: 'POST', body: { email: 'nobody@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.resetUrl, undefined);
});

test('team invitations enforce roles on the backend', async () => {
  await register('bob', 'Bob Viewer');
  await register('cy', 'Cy Member');
  const { token } = users.ada;
  const invite = await api('/api/team/invitations', { token, method: 'POST', body: { email: 'bob@example.com', role: 'VIEWER' } });
  assert.equal(invite.status, 201);
  const wrong = await api('/api/team/invitations/accept', { token: users.cy.token, method: 'POST', body: { token: invite.data.inviteUrl.split('=')[1] } });
  assert.equal(wrong.status, 403);
  const accept = await api('/api/team/invitations/accept', { token: users.bob.token, method: 'POST', body: { token: invite.data.inviteUrl.split('=')[1] } });
  assert.equal(accept.status, 200);
  const invite2 = await api('/api/team/invitations', { token, method: 'POST', body: { email: 'cy@example.com', role: 'MEMBER' } });
  await api('/api/team/invitations/accept', { token: users.cy.token, method: 'POST', body: { token: invite2.data.inviteUrl.split('=')[1] } });
  const team = await api('/api/team', { token });
  assert.equal(team.data.members.length, 3);
  // Viewer cannot write; member cannot manage team.
  assert.equal((await api('/api/projects', { token: users.bob.token, method: 'POST', body: { name: 'Nope' } })).status, 403);
  assert.equal((await api('/api/team/invitations', { token: users.cy.token, method: 'POST', body: { email: 'z@example.com' } })).status, 403);
  assert.equal((await api(`/api/team/members/${users.ada.id}`, { token: users.cy.token, method: 'PATCH', body: { role: 'VIEWER' } })).status, 403);
});

test('projects, tasks, comments, mentions and notifications', async () => {
  const { token } = users.ada;
  const project = await api('/api/projects', { token, method: 'POST', body: { name: 'Northstar', description: 'Redesign', tags: ['design'] } });
  assert.equal(project.status, 201);
  users.ada.projectId = project.data.id;
  const task = await api(`/api/projects/${project.data.id}/tasks`, { token, method: 'POST', body: { title: 'Ship navigation', priority: 'High', date: '2030-01-02', assigneeId: users.cy.id } });
  assert.equal(task.status, 201);
  assert.equal(task.data.assignee.name, 'Cy Member');
  assert.equal((await api(`/api/tasks/${task.data.id}`, { token, method: 'PATCH', body: { status: 'Nope' } })).status, 400);
  const moved = await api(`/api/tasks/${task.data.id}`, { token: users.cy.token, method: 'PATCH', body: { status: 'In review' } });
  assert.equal(moved.data.status, 'In review');
  const comment = await api(`/api/tasks/${task.data.id}/comments`, { token, method: 'POST', body: { body: 'Looks great @Cy, can you check?' } });
  assert.equal(comment.status, 201);
  const notes = await api('/api/notifications', { token: users.cy.token });
  assert.ok(notes.data.some(n => n.kind === 'mention'));
  assert.ok(notes.data.some(n => n.title === 'Task assigned to you'));
  const listed = await api('/api/projects', { token: users.bob.token });
  assert.equal(listed.data[0].taskCount, 1);
  const activity = await api(`/api/activity?projectId=${project.data.id}`, { token });
  assert.ok(activity.data.length >= 2);
  // Another workspace cannot see this project.
  const outsider = await register('eve', 'Eve Outsider');
  assert.equal((await api(`/api/projects/${project.data.id}`, { token: outsider.token })).status, 404);
  assert.equal((await api(`/api/tasks/${task.data.id}`, { token: outsider.token, method: 'PATCH', body: { title: 'x' } })).status, 404);
  // Members cannot delete a project they do not own.
  assert.equal((await api(`/api/projects/${project.data.id}`, { token: users.cy.token, method: 'DELETE' })).status, 403);
});

test('documents keep versions and respect private visibility', async () => {
  const { token } = users.ada;
  const doc = await api('/api/documents', { token, method: 'POST', body: { title: 'Brief', content: '<p>One</p>', type: 'rich-text' } });
  assert.equal(doc.status, 200);
  await api('/api/documents', { token, method: 'POST', body: { id: doc.data.id, title: 'Brief', content: '<p>Two</p>', type: 'rich-text' } });
  const versions = await api(`/api/documents/${doc.data.id}/versions`, { token });
  assert.equal(versions.data.length, 2);
  await api(`/api/documents/${doc.data.id}`, { token, method: 'PATCH', body: { visibility: 'private' } });
  assert.equal((await api(`/api/documents/${doc.data.id}`, { token: users.cy.token })).status, 404);
  assert.equal((await api('/api/documents', { token: users.cy.token })).data.length, 0);
  await api(`/api/documents/${doc.data.id}`, { token, method: 'PATCH', body: { collaboratorIds: [users.cy.id] } });
  assert.equal((await api(`/api/documents/${doc.data.id}`, { token: users.cy.token })).status, 200);
  const comment = await api(`/api/documents/${doc.data.id}/comments`, { token: users.cy.token, method: 'POST', body: { body: 'Nice', quote: 'Two' } });
  assert.equal(comment.status, 201);
  users.ada.docId = doc.data.id;
});

test('drive uploads stream, sign URLs and block executables', async () => {
  const { token } = users.ada;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await api('/api/files/upload', { token, method: 'POST', raw: png, headers: { 'x-file-name': encodeURIComponent('logo.png'), 'content-type': 'application/octet-stream' } });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.mimeType, 'image/png');
  const meta = await api(`/api/files/${up.data.id}`, { token });
  assert.match(meta.data.url, /\/content\?exp=\d+&sig=/);
  const content = await api(meta.data.url);
  assert.equal(content.status, 200);
  assert.match(content.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await api(meta.data.url.replace(/sig=[^&]+/, 'sig=forged'))).status, 403);
  assert.equal((await api('/api/files/upload', { token, method: 'POST', raw: Buffer.from('MZ'), headers: { 'x-file-name': 'setup.exe' } })).status, 415);
  assert.equal((await api('/api/files/upload', { token, method: 'POST', raw: Buffer.from('x'), headers: { 'x-file-name': encodeURIComponent('../../evil.txt') } })).status, 400);
  const usage = await api('/api/storage/usage', { token });
  assert.ok(usage.data.usedBytes >= png.length);
  assert.equal((await api('/api/files/upload', { token: users.bob.token, method: 'POST', raw: png, headers: { 'x-file-name': 'a.png' } })).status, 403);
});

test('code projects import ZIPs safely and serve static sites sandboxed', async () => {
  const { token } = users.ada;
  const project = await api('/api/code-projects', { token, method: 'POST', body: { name: 'Site' } });
  assert.equal(project.status, 201);
  const archive = zip([
    { name: 'site/index.html', data: Buffer.from('<h1>Hello</h1><script src="app.js"></script>') },
    { name: 'site/app.js', data: Buffer.from('console.log("hi")\nconst token = 1;\n') },
    { name: 'site/../../escape.txt', data: Buffer.from('nope') },
    { name: '/etc/passwd', data: Buffer.from('nope'), method: 0 },
  ]);
  const imported = await api(`/api/code-projects/${project.data.id}/zip`, { token, method: 'POST', raw: archive });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.added, 2);
  assert.equal(imported.data.skipped.length, 2);
  const files = await api(`/api/code-projects/${project.data.id}/files`, { token });
  assert.deepEqual(files.data.map(f => f.path).sort(), ['app.js', 'index.html']);
  const search = await api(`/api/code-projects/${project.data.id}/search?q=token`, { token });
  assert.equal(search.data.results[0].matches[0].line, 2);
  const site = await api(`/api/code-projects/${project.data.id}/site`, { token });
  const page = await api(site.data.url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /^sandbox/);
  assert.equal((await api(site.data.url.replace(/\.[^./]+\//, '.forged/'))).status, 403);
  const bomb = Buffer.alloc(3_000_000);
  const rejected = await api(`/api/code-projects/${project.data.id}/zip`, { token, method: 'POST', raw: zip([{ name: 'bomb.txt', data: bomb }]) });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.skipped[0].reason, 'too large');
  const download = await api(`/api/code-projects/${project.data.id}/download`, { token });
  assert.equal(download.status, 200);
  assert.equal(download.data.readUInt32LE(0), 0x04034b50);
  users.ada.codeProjectId = project.data.id;
});

test('previews CRUD and SSRF-safe framing check', async () => {
  const { token } = users.ada;
  const created = await api('/api/previews', { token, method: 'POST', body: { url: 'https://example.com', description: 'Marketing site' } });
  assert.equal(created.status, 201);
  assert.equal((await api('/api/previews', { token, method: 'POST', body: { url: 'javascript:alert(1)' } })).status, 400);
  const patched = await api(`/api/previews/${created.data.id}`, { token, method: 'PATCH', body: { title: 'Marketing' } });
  assert.equal(patched.data.title, 'Marketing');
  const local = await api('/api/previews/check', { token, method: 'POST', body: { url: 'http://127.0.0.1:22' } });
  assert.equal(local.data.reachable, null);
  assert.equal((await api(`/api/previews/${created.data.id}`, { token, method: 'DELETE' })).status, 200);
});

test('AI endpoints report unavailable honestly without credentials', async () => {
  const status = await api('/api/ai/status');
  assert.equal(status.data.available, false);
  const chat = await api('/api/ai/chat', { token: users.ada.token, method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(chat.status, 503);
  const design = await api('/api/ai/architectures', { token: users.ada.token, method: 'POST', body: { title: 'Plan', description: 'A marketplace for local bakers' } });
  assert.equal(design.status, 201);
  const saved = await api(`/api/ai/architectures/${design.data.id}`, { token: users.ada.token, method: 'PATCH', body: { sections: { overview: 'Edited overview' } } });
  assert.equal(saved.data.sections.overview.content, 'Edited overview');
});

test('search is scoped to visible content', async () => {
  const results = await api('/api/search?q=north', { token: users.ada.token });
  assert.ok(results.data.results.some(r => r.type === 'project'));
  const outsider = await api('/api/search?q=north', { token: users.eve.token });
  assert.equal(outsider.data.results.length, 0);
});

test('realtime events and collaboration sockets require authorisation', async () => {
  const wsBase = base.replace('http', 'ws');
  await assert.rejects(new Promise((ok, fail) => { const s = new WebSocket(`${wsBase}/ws?token=bad`); s.on('open', ok); s.on('error', fail); }));
  const events = [];
  const socket = new WebSocket(`${wsBase}/ws?token=${users.cy.token}`);
  await new Promise(ok => socket.on('open', ok));
  socket.on('message', raw => events.push(JSON.parse(String(raw))));
  await api(`/api/projects/${users.ada.projectId}/tasks`, { token: users.ada.token, method: 'POST', body: { title: 'Realtime task' } });
  await new Promise(ok => setTimeout(ok, 200));
  assert.ok(events.some(e => e.type === 'task.changed' && e.data.title === 'Realtime task'));
  assert.ok(events.some(e => e.type === 'presence'));
  socket.close();
  // Outsiders cannot join a document room.
  await assert.rejects(new Promise((ok, fail) => { const s = new WebSocket(`${wsBase}/collab/${users.ada.docId}?token=${users.eve.token}`); s.on('open', ok); s.on('error', fail); }));
  const collab = new WebSocket(`${wsBase}/collab/${users.ada.docId}?token=${users.cy.token}`);
  const first = await new Promise((ok, fail) => { collab.on('message', ok); collab.on('error', fail); });
  assert.equal(new Uint8Array(first)[0], 0); // sync step 1 from the server
  collab.close();
});

test('account deletion requires ownership transfer first', async () => {
  const blocked = await api('/api/auth/account', { token: users.ada.token, method: 'DELETE', body: { password: 'brand-new-pass-2' } });
  assert.equal(blocked.status, 409);
  const left = await api('/api/workspace/leave', { token: users.bob.token, method: 'POST' });
  assert.equal(left.status, 200);
  const gone = await api('/api/auth/account', { token: users.eve.token, method: 'DELETE', body: { password: 'correct-horse-1' } });
  assert.equal(gone.status, 200);
  assert.equal((await api('/api/auth/me', { token: users.eve.token })).status, 401);
});
