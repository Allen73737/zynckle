import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The pure helpers are imported in-process; point config at a throwaway location first.
const scratch = await mkdtemp(join(tmpdir(), 'zynckle-rag-unit-'));
Object.assign(process.env, { ZYNCKLE_ENV_FILE: join(scratch, 'none.env'), ZYNCKLE_DATA_FILE: join(scratch, 'workspace.json') });
const { tokenize, chunkCode, chunkProse, htmlToText, snippet } = await import('../lib/rag.mjs');

// A stand-in OpenAI-compatible provider: streams a cited answer and serves deterministic
// bag-of-words embeddings, recording every request so the tests can inspect the prompt.
const requests = { chat: [], embeddings: [] };
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
const mock = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url.endsWith('/embeddings')) {
      requests.embeddings.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: fakeEmbedding(text) })) }));
    }
    requests.chat.push(body);
    const planning = body.messages[0].content.includes('rewrite a user');
    const answer = planning ? '{"standalone":"How are invoice rounding errors handled?","queries":["invoice rounding","roundCents helper"]}' : 'Invoices round half-up to the cent [1].';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const piece of answer.match(/.{1,12}/g)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

const port = 19000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let server; let dir; let mockUrl;

async function api(path, { token, method = 'GET', body, headers = {}, raw } = {}) {
  const response = await fetch(base + path, {
    method, body: raw ?? (body ? JSON.stringify(body) : undefined),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  return { status: response.status, data };
}

/** Parse an SSE body into [{ event, data }]. */
const frames = text => text.split('\n\n').filter(Boolean).map(frame => ({ event: frame.match(/^event: (.+)$/m)?.[1], data: JSON.parse(frame.match(/^data: (.+)$/m)?.[1] || 'null') }));

before(async () => {
  await new Promise(ok => mock.listen(0, '127.0.0.1', ok));
  mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;
  dir = await mkdtemp(join(tmpdir(), 'zynckle-rag-'));
  server = spawn(process.execPath, [resolve(import.meta.dirname, '..', 'server.mjs')], {
    env: {
      ...process.env, PORT: String(port), ZYNCKLE_DATA_FILE: join(dir, 'workspace.json'), ZYNCKLE_ENV_FILE: join(dir, 'none.env'),
      GROQ_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', R2_ENDPOINT: '', AUTH_RATE_PER_MINUTE: '500', AI_PROVIDER: '',
      CUSTOM_AI_URL: mockUrl, CUSTOM_AI_MODEL: 'mock-model', CUSTOM_AI_API_KEY: '',
      EMBEDDING_URL: `${mockUrl}/embeddings`, EMBEDDING_MODEL: 'mock-embed', RAG_EMBEDDINGS: '', RAG_MIN_SIMILARITY: '0.5',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fail) => {
    server.stdout.on('data', d => { if (String(d).includes('listening')) ok(); });
    server.on('exit', code => fail(new Error(`server exited ${code}`)));
  });
});
after(async () => { server.kill(); mock.close(); await rm(dir, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true }); });

const users = {};
const register = async (key, name) => {
  const r = await api('/api/auth/register', { method: 'POST', body: { name, email: `${key}@example.com`, password: 'correct-horse-1' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return (users[key] = { token: r.data.token, id: r.data.user.id });
};

test('tokenizer splits identifiers and stems consistently', () => {
  assert.ok(tokenize('readCodeFile').includes('readcodefile'));
  assert.ok(['read', 'code', 'file'].every(t => tokenize('readCodeFile').includes(t)));
  assert.deepEqual(tokenize('running'), tokenize('run'));
  assert.deepEqual(tokenize('invoices'), tokenize('invoice'));
  assert.deepEqual(tokenize('the and of'), []);
});

test('chunkers keep structure and line numbers', () => {
  const code = Array.from({ length: 150 }, (_, i) => (i % 50 === 0 ? `function step${i}() {` : '  work();')).join('\n');
  const chunks = chunkCode(code);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.at(-1).endLine, 150);
  assert.ok(chunks.every(c => c.endLine - c.startLine < 60));
  const prose = chunkProse(htmlToText('<h1>Guide</h1><p>Intro.</p><h2>Install</h2><p>Run npm install.</p>'));
  assert.equal(prose.at(-1).section, 'Guide › Install');
  assert.match(snippet('alpha '.repeat(80) + 'the invoice rounding rule ' + 'omega '.repeat(80), 'invoice rounding'), /invoice rounding/);
});

test('workspace knowledge indexes content and ranks the relevant passage first', async () => {
  const ada = await register('ada', 'Ada Lovelace');
  const project = await api('/api/projects', { token: ada.token, method: 'POST', body: { name: 'Billing revamp', description: 'Move invoicing to the new ledger service.' } });
  await api(`/api/projects/${project.data.id}/tasks`, { token: ada.token, method: 'POST', body: { title: 'Fix invoice rounding drift', description: 'Totals are off by one cent for some currencies.' } });
  await api('/api/documents', { token: ada.token, method: 'POST', body: { title: 'Payments runbook', content: '<h1>Payments</h1><h2>Webhook retries</h2><p>Stripe webhooks retry with exponential backoff for three days.</p>', type: 'rich-text' } });
  const code = await api('/api/code-projects', { token: ada.token, method: 'POST', body: { name: 'ledger' } });
  const source = 'export function roundCents(amount) {\n  // Invoices round half-up to the nearest cent.\n  return Math.round(amount * 100) / 100;\n}\n';
  await api(`/api/code-projects/${code.data.id}/files`, { token: ada.token, method: 'POST', raw: source, headers: { 'x-file-path': 'src/money.js', 'content-type': 'application/octet-stream' } });

  const status = await api('/api/ai/knowledge/reindex', { token: ada.token, method: 'POST', body: { wait: true } });
  assert.equal(status.status, 200);
  assert.equal(status.data.retrieval, 'hybrid');
  assert.ok(status.data.chunks >= 4);
  assert.equal(status.data.byType['code-file'], 1);
  assert.equal(status.data.embeddings.pending, 0, JSON.stringify(status.data.embeddings));

  const webhook = await api('/api/ai/knowledge/search?q=webhook%20retry%20backoff', { token: ada.token });
  assert.equal(webhook.data.mode, 'hybrid');
  assert.equal(webhook.data.results[0].title, 'Payments runbook');
  assert.match(webhook.data.results[0].section, /Webhook retries/);
  const identifier = await api('/api/ai/knowledge/search?q=roundCents', { token: ada.token });
  assert.equal(identifier.data.results[0].type, 'code-file');
  assert.equal(identifier.data.results[0].location, 'lines 1–5');
  const filtered = await api('/api/ai/knowledge/search?q=invoice&types=task', { token: ada.token });
  assert.ok(filtered.data.results.length && filtered.data.results.every(r => r.type === 'task'));

  // Edits are picked up on the next query without an explicit reindex.
  await api('/api/documents', { token: ada.token, method: 'POST', body: { title: 'Onboarding', content: '<p>Every new hire pairs with a quokka mentor.</p>', type: 'rich-text' } });
  const fresh = await api('/api/ai/knowledge/search?q=quokka', { token: ada.token });
  assert.equal(fresh.data.results[0]?.title, 'Onboarding');
});

test('retrieval respects private documents and workspace boundaries', async () => {
  const cy = await register('cy', 'Cy Member');
  const invite = await api('/api/team/invitations', { token: users.ada.token, method: 'POST', body: { email: 'cy@example.com', role: 'MEMBER' } });
  await api('/api/team/invitations/accept', { token: cy.token, method: 'POST', body: { token: invite.data.inviteUrl.split('=')[1] } });
  const secret = await api('/api/documents', { token: users.ada.token, method: 'POST', body: { title: 'Salary bands', content: '<p>Zebracorn salary bands for staff engineers.</p>', type: 'rich-text' } });
  await api(`/api/documents/${secret.data.id}`, { token: users.ada.token, method: 'PATCH', body: { visibility: 'private' } });
  assert.equal((await api('/api/ai/knowledge/search?q=zebracorn', { token: users.ada.token })).data.results[0]?.title, 'Salary bands');
  assert.equal((await api('/api/ai/knowledge/search?q=zebracorn', { token: cy.token })).data.results.length, 0);
  const eve = await register('eve', 'Eve Outsider');
  assert.equal((await api('/api/ai/knowledge/search?q=invoice', { token: eve.token })).data.results.length, 0);

  // The private passage must not reach the model when Cy asks.
  requests.chat.length = 0;
  await api('/api/ai/stream', { token: cy.token, method: 'POST', body: { messages: [{ role: 'user', content: 'What are the zebracorn salary bands?' }] } });
  assert.ok(!JSON.stringify(requests.chat).includes('Zebracorn salary'));
});

test('chat streams retrieved, numbered sources and cites them', async () => {
  requests.chat.length = 0;
  const response = await api('/api/ai/stream', { token: users.ada.token, method: 'POST', body: { persist: true, message: 'How do we round invoice totals?' } });
  const events = frames(response.data);
  const meta = events.find(e => e.event === 'meta').data;
  assert.equal(meta.retrieval.rag, 'auto');
  assert.ok(meta.retrieval.passages >= 1);
  assert.ok(meta.sources.every((s, i) => s.n === i + 1));
  assert.ok(meta.sources.some(s => s.retrieved && s.type === 'code-file' && s.link.startsWith('/code/')));
  const text = events.filter(e => e.event === 'delta').map(e => e.data.text).join('');
  assert.equal(text, 'Invoices round half-up to the cent [1].');
  const prompt = requests.chat[0].messages.map(m => m.content).join('\n');
  assert.match(prompt, /<context source="\[1\]/);
  assert.match(prompt, /Cite the passages/);
  assert.match(prompt, /roundCents/);
  // The answer and its sources are saved with the conversation.
  const conversation = await api(`/api/ai/conversations/${meta.conversationId}`, { token: users.ada.token });
  assert.ok(conversation.data.messages.at(-1).sources.some(s => s.retrieved));
});

test('deep mode plans extra queries; off mode skips retrieval', async () => {
  requests.chat.length = 0;
  const deep = frames((await api('/api/ai/stream', { token: users.ada.token, method: 'POST', body: { rag: 'deep', messages: [{ role: 'user', content: 'and the cents thing?' }] } })).data);
  const meta = deep.find(e => e.event === 'meta').data;
  assert.equal(requests.chat.length, 2, 'one planning call plus the answer');
  assert.ok(meta.retrieval.queries.includes('roundCents helper'));
  assert.ok(meta.sources.some(s => s.type === 'code-file'));

  requests.chat.length = 0;
  const off = frames((await api('/api/ai/stream', { token: users.ada.token, method: 'POST', body: { rag: 'off', messages: [{ role: 'user', content: 'How do we round invoice totals?' }] } })).data);
  assert.equal(off.find(e => e.event === 'meta').data.retrieval, null);
  assert.ok(!requests.chat[0].messages.some(m => m.content.includes('<context source=')));
});
