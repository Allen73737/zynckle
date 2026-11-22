import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { db, sha256 } from './store.mjs';
import { config } from './config.mjs';
import { canSee, userById } from './core.mjs';
import { getObject } from './storage.mjs';

/**
 * Workspace retrieval engine (RAG).
 *
 * Every workspace gets an in-memory index of chunked passages drawn from projects, tasks
 * and their comments, documents, LaTeX papers, code files, text files in Drive and
 * architecture designs. The index syncs lazily: each query fingerprints the sources and
 * re-chunks only what changed, so no route has to remember to "update the index".
 *
 * Ranking is hybrid: BM25 over a code-aware tokenizer always runs; when an embedding
 * provider is configured, dense cosine similarity runs too and both lists are merged with
 * reciprocal rank fusion. Permissions are re-checked against the live store on every
 * query, so private content never reaches someone who cannot open it.
 */

const CHUNK_CHARS = Math.max(300, Number(process.env.RAG_CHUNK_CHARS || 1100));
const CHUNK_OVERLAP = 160;
const CODE_LINES = 60;
const CODE_OVERLAP = 8;
const MAX_SOURCE_BYTES = 400_000;
const MAX_CHUNKS_PER_WORKSPACE = Number(process.env.RAG_MAX_CHUNKS || 25_000);
const PER_SOURCE_CAP = 3;
const RRF_K = 60;
const SKIP_PATH = /(^|\/)(node_modules|dist|build|out|target|vendor|\.git|\.next|coverage|__pycache__)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|composer\.lock|poetry\.lock)$|\.min\.(js|css)$|\.map$/i;
const PROSE_EXT = /\.(md|markdown|mdx|txt|rst|adoc|org)$/i;

// ---- Text processing --------------------------------------------------------------

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have how i if in into is it its '
  + 'me my no not of on or our should so than that the their them then there these they this those to was we were what when '
  + 'where which who why will with would you your about also any just more most some such very use using used').split(' '));

/** Light suffix stripping; applied identically to queries and passages, so it only has to be consistent. */
const stem = word => {
  if (word.length <= 4 || /\d/.test(word)) return word;
  return word
    .replace(/ies$/, 'y')
    .replace(/(?<=\w{3})(?:ings?|edly|ed|ly|ment|ness)$/, '')
    .replace(/(?<=\w{3})es$/, 'e')
    .replace(/(?<=[^s])s$/, '')
    .replace(/([b-df-hj-km-np-rtv-z])\1$/, '$1');
};

/** Split identifiers (camelCase, snake_case, kebab) as well as keeping them whole. */
export function tokenize(text) {
  const out = [];
  for (const raw of String(text).match(/[\p{L}\p{N}_]+/gu) || []) {
    if (raw.length > 60) continue;
    const lower = raw.toLowerCase();
    const parts = raw.split(/_+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean);
    if (parts.length > 1) out.push(lower.replace(/_/g, ''));
    for (const part of parts) {
      const word = part.toLowerCase();
      if ((word.length < 2 && !/\d/.test(word)) || STOP.has(word)) continue;
      out.push(stem(word));
    }
  }
  return out;
}

const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Rich-text HTML to Markdown-ish prose that keeps headings and list structure. */
export function htmlToText(html) {
  return decode(String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]*>/g, '')}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/tr|\/blockquote|\/pre)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const latexToText = source => String(source || '')
  .replace(/(?<!\\)%.*$/gm, '')
  .replace(/\\(?:sub){0,2}section\*?\{([^}]*)\}/g, (match, title) => `\n\n${match.includes('subsub') ? '###' : match.includes('sub') ? '##' : '#'} ${title}\n\n`)
  .replace(/\\(?:chapter|title)\*?\{([^}]*)\}/g, '\n\n# $1\n\n')
  .replace(/\n{3,}/g, '\n\n').trim();

/** Prose chunks follow heading and paragraph boundaries, with a small word-aligned overlap. */
export function chunkProse(text) {
  const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const chunks = [];
  const headings = [];
  let current = '';
  let section = '';
  const tail = value => { if (value.length <= CHUNK_OVERLAP) return value; const cut = value.slice(-CHUNK_OVERLAP); return cut.slice(cut.indexOf(' ') + 1); };
  const flush = () => { if (current.trim()) chunks.push({ text: current.trim(), section }); current = ''; };
  for (const block of blocks) {
    const heading = block.match(/^(#{1,6})\s+(.+)$/);
    if (heading && !block.includes('\n')) {
      flush();
      headings.length = heading[1].length - 1;
      headings[heading[1].length - 1] = heading[2].trim();
      section = headings.filter(Boolean).join(' › ');
      current = `${block}\n\n`;
      continue;
    }
    if (current.length + block.length > CHUNK_CHARS && current.trim()) {
      const carry = tail(current);
      flush();
      current = carry ? `… ${carry}\n\n` : '';
    }
    if (block.length > CHUNK_CHARS) {
      // One huge paragraph: split on sentences, then hard-wrap.
      for (const sentence of block.match(/[^.!?\n]+[.!?]*\s*/g) || [block]) {
        if (current.length + sentence.length > CHUNK_CHARS) { const carry = tail(current); flush(); current = carry ? `… ${carry} ` : ''; }
        current += sentence.length > CHUNK_CHARS * 1.5 ? `${sentence.slice(0, CHUNK_CHARS)} ` : sentence;
      }
      current += '\n\n';
    } else current += `${block}\n\n`;
  }
  flush();
  return chunks;
}

const DECLARATION = /^\s*(export\s+)?(default\s+)?(async\s+)?(public|private|protected|static|final|abstract|def|fn|func|function|class|interface|type|enum|struct|impl|module|trait|const\s+\w+\s*=\s*(async\s*)?\(|@\w+)/;

/** Code chunks are line windows that prefer to break just before a declaration. */
export function chunkCode(text) {
  const lines = String(text).split(/\r?\n/);
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(lines.length, start + CODE_LINES);
    if (end < lines.length) {
      for (let i = end; i > start + CODE_LINES / 2; i--) {
        if (DECLARATION.test(lines[i]) && !lines[i].startsWith(' '.repeat(8))) { end = i; break; }
      }
    }
    const body = lines.slice(start, end).join('\n');
    if (body.trim()) {
      const declaration = lines.slice(start, end).find(line => DECLARATION.test(line) && line.trim().length < 160);
      chunks.push({ text: body, section: declaration ? declaration.trim().replace(/\s*\{\s*$/, '') : '', startLine: start + 1, endLine: end });
    }
    if (end >= lines.length) break;
    start = Math.max(end - CODE_OVERLAP, start + 1);
  }
  return chunks;
}

// ---- Sources ----------------------------------------------------------------------

const looksBinary = bytes => bytes.subarray(0, 8000).includes(0);

// Hashing every document on every query is wasteful; reuse the hash while `updated` and length are unchanged.
const docHashes = new Map();
function documentFingerprint(d) {
  const probe = `${d.updated}|${d.title}|${(d.content || '').length}`;
  const cached = docHashes.get(d.id);
  if (cached?.probe === probe) return cached.fp;
  const fp = sha256(`${d.title}\u0000${d.content || ''}`);
  docHashes.set(d.id, { probe, fp });
  return fp;
}

/**
 * Enumerate everything indexable in a workspace. Each source has a cheap fingerprint
 * and a loader that is only called when the fingerprint changed.
 */
function sourcesFor(workspaceId) {
  const list = [];
  const projectName = projectId => db.projects.find(p => p.id === projectId)?.name || 'General';
  for (const p of db.projects) {
    if (p.workspaceId !== workspaceId) continue;
    const text = [`Project: ${p.name}`, `Status: ${p.status || 'unknown'}${p.archived ? ' (archived)' : ''}`, `Deadline: ${p.due || 'not set'}`,
      `Tags: ${(p.tags || []).join(', ') || 'none'}`, '', p.description || ''].join('\n');
    list.push({ key: `project:${p.id}`, type: 'project', id: p.id, title: p.name, guard: null, link: `/projects/${p.id}`, updatedAt: p.updatedAt || p.createdAt, fp: sha256(text), load: async () => ({ kind: 'prose', text }) });
  }
  for (const t of db.tasks) {
    if (t.workspaceId !== workspaceId) continue;
    const comments = db.comments.filter(c => c.taskId === t.id).slice(-20);
    const text = [`Task: ${t.title}`, `Project: ${t.project || projectName(t.projectId)}`, `Status: ${t.status}`, `Priority: ${t.priority || 'Normal'}`,
      `Due: ${t.date && t.date !== 'No date' ? t.date : 'not set'}`, `Assignee: ${t.assigneeId ? userById(t.assigneeId)?.name || 'former member' : 'unassigned'}`, '',
      t.description || '', ...(comments.length ? ['', 'Comments:', ...comments.map(c => `- ${c.author || userById(c.userId)?.name || 'Someone'}: ${c.body}`)] : [])].join('\n');
    list.push({ key: `task:${t.id}`, type: 'task', id: t.id, title: t.title, guard: null, link: `/projects/${t.projectId}?task=${t.id}`, updatedAt: t.updatedAt || t.createdAt, fp: sha256(text), load: async () => ({ kind: 'prose', text }) });
  }
  for (const d of db.documents) {
    if (d.workspaceId !== workspaceId) continue;
    const latex = d.type === 'latex';
    list.push({
      key: `document:${d.id}`, type: latex ? 'latex' : 'document', id: d.id, title: d.title || 'Untitled', guard: { collection: 'documents', id: d.id },
      link: latex ? `/latex?doc=${d.id}` : `/documents?doc=${d.id}`, updatedAt: d.updated, fp: documentFingerprint(d),
      load: async () => ({ kind: 'prose', text: latex ? latexToText(d.content) : htmlToText(d.content) }),
    });
  }
  for (const f of db.codeFiles) {
    if (f.workspaceId !== workspaceId || f.binary || f.sizeBytes > MAX_SOURCE_BYTES || SKIP_PATH.test(f.path)) continue;
    list.push({
      key: `code-file:${f.id}`, type: 'code-file', id: f.id, title: f.path, guard: { collection: 'codeProjects', id: f.codeProjectId },
      link: `/code/${f.codeProjectId}?file=${f.id}`, updatedAt: f.updatedAt, fp: `${f.storageKey}:${f.sizeBytes}`,
      load: async () => {
        const bytes = await getObject(f.storageKey, f.storage);
        if (looksBinary(bytes)) return null;
        return { kind: PROSE_EXT.test(f.path) ? 'prose' : 'code', text: bytes.toString('utf8') };
      },
    });
  }
  for (const f of db.files) {
    const mime = f.mimeType || '';
    if (f.workspaceId !== workspaceId || !(mime.startsWith('text/') || mime === 'application/json') || f.sizeBytes > MAX_SOURCE_BYTES) continue;
    list.push({
      key: `file:${f.id}`, type: 'file', id: f.id, title: f.name, guard: { collection: 'files', id: f.id },
      link: `/drive?file=${f.id}`, updatedAt: f.updatedAt || f.createdAt, fp: `${f.storageKey || 'inline'}:${f.sizeBytes}:${f.updatedAt || ''}`,
      load: async () => {
        const bytes = f.storageKey ? await getObject(f.storageKey, f.storage) : Buffer.from(String(f.content || ''));
        if (looksBinary(bytes)) return null;
        const text = bytes.toString('utf8');
        return { kind: PROSE_EXT.test(f.name) || mime === 'text/plain' || mime === 'text/markdown' ? 'prose' : mime === 'text/html' ? 'prose-html' : 'code', text };
      },
    });
  }
  for (const a of db.architectures) {
    if (a.workspaceId !== workspaceId) continue;
    const text = [`# ${a.title}`, '', a.description || '', ...Object.entries(a.sections || {}).map(([name, section]) => `\n\n## ${name}\n\n${section.content || ''}`)].join('\n');
    list.push({ key: `architecture:${a.id}`, type: 'architecture', id: a.id, title: a.title, guard: { collection: 'architectures', id: a.id }, link: '/ai/architecture', updatedAt: a.updatedAt, fp: sha256(text), load: async () => ({ kind: 'prose', text }) });
  }
  return list;
}

// ---- Index ------------------------------------------------------------------------

const indexes = new Map();
const syncing = new Map();

function emptyIndex() {
  return { chunks: new Map(), sources: new Map(), postings: new Map(), totalLength: 0, syncedAt: null, seq: 0 };
}

function addChunk(index, chunk) {
  const counts = new Map();
  for (const term of chunk.terms) counts.set(term, (counts.get(term) || 0) + 1);
  for (const [term, tf] of counts) {
    let posting = index.postings.get(term);
    if (!posting) index.postings.set(term, posting = new Map());
    posting.set(chunk.id, tf);
  }
  chunk.length = chunk.terms.length;
  delete chunk.terms;
  index.totalLength += chunk.length;
  index.chunks.set(chunk.id, chunk);
}

function removeSource(index, key) {
  const source = index.sources.get(key);
  if (!source) return;
  for (const chunkId of source.chunkIds) {
    const chunk = index.chunks.get(chunkId);
    if (!chunk) continue;
    index.totalLength -= chunk.length;
    index.chunks.delete(chunkId);
  }
  const removed = new Set(source.chunkIds);
  for (const [term, posting] of index.postings) {
    for (const chunkId of removed) posting.delete(chunkId);
    if (!posting.size) index.postings.delete(term);
  }
  index.sources.delete(key);
}

async function buildChunks(source, index) {
  let loaded;
  try { loaded = await source.load(); } catch { return []; }
  if (!loaded?.text?.trim()) return [];
  const pieces = loaded.kind === 'code' ? chunkCode(loaded.text) : chunkProse(loaded.kind === 'prose-html' ? htmlToText(loaded.text) : loaded.text);
  return pieces.map((piece, seq) => {
    const location = piece.startLine ? `lines ${piece.startLine}–${piece.endLine}` : piece.section || '';
    // Titles and section names are indexed twice: matches there are strong evidence.
    const header = `${source.title} ${source.title} ${piece.section || ''} ${piece.section || ''}`;
    return {
      id: `${source.key}#${index.seq++}`, sourceKey: source.key, type: source.type, sourceId: source.id, title: source.title, guard: source.guard,
      link: source.link, updatedAt: source.updatedAt, seq, section: piece.section || '', location, startLine: piece.startLine, endLine: piece.endLine,
      text: piece.text, hash: sha256(`${source.title}\n${piece.text}`), terms: tokenize(`${header}\n${piece.text}`),
    };
  });
}

/** Bring a workspace index up to date with the store; concurrent callers share one sync. */
export async function syncIndex(workspaceId, { force = false } = {}) {
  if (force) indexes.delete(workspaceId);
  if (syncing.has(workspaceId)) return syncing.get(workspaceId);
  const run = (async () => {
    const index = indexes.get(workspaceId) || emptyIndex();
    indexes.set(workspaceId, index);
    const sources = sourcesFor(workspaceId);
    const live = new Set(sources.map(s => s.key));
    let changed = 0;
    for (const key of [...index.sources.keys()]) if (!live.has(key)) { removeSource(index, key); changed++; }
    for (const source of sources) {
      if (index.sources.get(source.key)?.fp === source.fp) continue;
      if (index.chunks.size >= MAX_CHUNKS_PER_WORKSPACE && !index.sources.has(source.key)) continue;
      removeSource(index, source.key);
      const chunks = await buildChunks(source, index);
      for (const chunk of chunks) addChunk(index, chunk);
      index.sources.set(source.key, { fp: source.fp, chunkIds: chunks.map(c => c.id), type: source.type });
      changed++;
    }
    index.syncedAt = new Date().toISOString();
    if (changed) queueEmbeddings(index);
    return index;
  })().finally(() => syncing.delete(workspaceId));
  syncing.set(workspaceId, run);
  return run;
}

// ---- Embeddings (optional) -------------------------------------------------------

/**
 * Any OpenAI-compatible /embeddings endpoint works. Gemini's compatible endpoint is used
 * automatically when GEMINI_API_KEY is set; RAG_EMBEDDINGS=off forces lexical-only.
 */
function embeddingConfig() {
  const env = process.env;
  if ((env.RAG_EMBEDDINGS || '').toLowerCase() === 'off') return null;
  if (env.EMBEDDING_URL && env.EMBEDDING_MODEL) {
    return { label: 'Custom embeddings', url: env.EMBEDDING_URL, key: env.EMBEDDING_API_KEY || '', model: env.EMBEDDING_MODEL, dims: Number(env.EMBEDDING_DIMENSIONS) || 0 };
  }
  if (config.ai.gemini.key) {
    return { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/embeddings', key: config.ai.gemini.key, model: env.EMBEDDING_MODEL || 'gemini-embedding-001', dims: Number(env.EMBEDDING_DIMENSIONS) || 768 };
  }
  return null;
}

const vectorFile = join(config.dataDir, 'rag-vectors.json');
const vectors = new Map(); // chunk hash -> { v: Float32Array, seen: number }
let vectorModel = null;
let vectorsLoaded = null;
let vectorSaveTimer = null;
let embedQueue = Promise.resolve();
const embedState = { lastError: '', lastRunAt: null, running: false };

function normalise(values, dims) {
  const v = Float32Array.from(dims && values.length > dims ? values.slice(0, dims) : values);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

async function loadVectors() {
  vectorsLoaded ??= (async () => {
    const embed = embeddingConfig();
    if (!embed) return;
    try {
      const saved = JSON.parse(await readFile(vectorFile, 'utf8'));
      if (saved.model !== embed.model) return;
      for (const [hash, item] of Object.entries(saved.vectors || {})) {
        const buffer = Buffer.from(item.v, 'base64');
        vectors.set(hash, { v: new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4), seen: item.seen || Date.now() });
      }
    } catch { /* no cache yet */ }
    vectorModel = embed.model;
  })();
  return vectorsLoaded;
}

function saveVectorsSoon() {
  clearTimeout(vectorSaveTimer);
  vectorSaveTimer = setTimeout(async () => {
    const cutoff = Date.now() - 45 * 86_400_000;
    const out = {};
    for (const [hash, item] of vectors) {
      if (item.seen < cutoff) { vectors.delete(hash); continue; }
      out[hash] = { v: Buffer.from(item.v.buffer, item.v.byteOffset, item.v.byteLength).toString('base64'), seen: item.seen };
    }
    const tmp = `${vectorFile}.${Date.now()}.tmp`;
    try { await writeFile(tmp, JSON.stringify({ model: vectorModel, vectors: out })); await rename(tmp, vectorFile); }
    catch (error) { console.error('Could not save the RAG vector cache', error.message); }
  }, 1500);
  vectorSaveTimer.unref?.();
}

async function embed(texts, { signal } = {}) {
  const embedConfig = embeddingConfig();
  if (!embedConfig) return null;
  const response = await fetch(embedConfig.url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(embedConfig.key ? { Authorization: `Bearer ${embedConfig.key}` } : {}) },
    body: JSON.stringify({ model: embedConfig.model, input: texts }),
  });
  if (!response.ok) {
    let detail = '';
    try { const payload = await response.json(); detail = payload.error?.message || payload[0]?.error?.message || ''; } catch { /* ignore */ }
    throw new Error(`${embedConfig.label} embeddings failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const payload = await response.json();
  const data = [...(payload.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== texts.length) throw new Error('The embedding provider returned an unexpected number of vectors');
  return data.map(item => normalise(item.embedding, embedConfig.dims));
}

function queueEmbeddings(index) {
  if (!embeddingConfig()) return;
  embedQueue = embedQueue.then(async () => {
    await loadVectors();
    const pending = [];
    const seen = new Set();
    for (const chunk of index.chunks.values()) {
      const cached = vectors.get(chunk.hash);
      if (cached) { cached.seen = Date.now(); continue; }
      if (seen.has(chunk.hash)) continue;
      seen.add(chunk.hash);
      pending.push(chunk);
    }
    if (!pending.length) return;
    embedState.running = true;
    try {
      for (let i = 0; i < pending.length; i += 32) {
        const batch = pending.slice(i, i + 32);
        const result = await embed(batch.map(c => `${c.title}${c.section ? ` — ${c.section}` : ''}\n${c.text}`.slice(0, 6000)), { signal: AbortSignal.timeout(30_000) });
        batch.forEach((chunk, j) => vectors.set(chunk.hash, { v: result[j], seen: Date.now() }));
        saveVectorsSoon();
      }
      embedState.lastError = '';
    } catch (error) {
      embedState.lastError = error.message;
    } finally {
      embedState.running = false;
      embedState.lastRunAt = new Date().toISOString();
    }
  });
}

const queryVectors = new Map();
async function embedQuery(text) {
  if (!embeddingConfig()) return null;
  await loadVectors();
  if (queryVectors.has(text)) return queryVectors.get(text);
  try {
    const [vector] = await embed([text.slice(0, 2000)], { signal: AbortSignal.timeout(5000) });
    queryVectors.set(text, vector);
    if (queryVectors.size > 300) queryVectors.delete(queryVectors.keys().next().value);
    return vector;
  } catch (error) {
    embedState.lastError = error.message;
    return null;
  }
}

/** Wait for queued embedding work (used by tests and the reindex endpoint). */
export const embeddingsSettled = () => embedQueue;

// ---- Retrieval -------------------------------------------------------------------

function visibility(ctx) {
  const cache = new Map();
  return chunk => {
    if (!chunk.guard) return true;
    const key = `${chunk.guard.collection}:${chunk.guard.id}`;
    if (!cache.has(key)) cache.set(key, canSee(db[chunk.guard.collection].find(item => item.id === chunk.guard.id), ctx));
    return cache.get(key);
  };
}

function bm25(index, terms, allowed) {
  const N = index.chunks.size || 1;
  const avg = index.totalLength / N || 1;
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map();
  const weights = new Map();
  for (const term of terms) weights.set(term, (weights.get(term) || 0) + 1);
  for (const [term, weight] of weights) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const idf = Math.log(1 + (N - posting.size + 0.5) / (posting.size + 0.5));
    for (const [chunkId, tf] of posting) {
      const chunk = index.chunks.get(chunkId);
      if (!chunk || !allowed(chunk)) continue;
      const score = weight * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunk.length / avg));
      scores.set(chunkId, (scores.get(chunkId) || 0) + score);
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 60);
}

/**
 * Nearest neighbours always exist, so a dense hit must earn its place: it needs an absolute
 * similarity floor (model-dependent, RAG_MIN_SIMILARITY) and must stand out from the rest
 * of the corpus. Hits that also matched lexically skip both checks.
 */
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY || 0.3);
function dense(index, vector, allowed, lexicalIds) {
  if (!vector) return [];
  const scored = [];
  let sum = 0; let squares = 0;
  for (const chunk of index.chunks.values()) {
    const item = vectors.get(chunk.hash);
    if (!item || item.v.length !== vector.length || !allowed(chunk)) continue;
    let dot = 0;
    for (let i = 0; i < vector.length; i++) dot += vector[i] * item.v[i];
    scored.push([chunk.id, dot]);
    sum += dot; squares += dot * dot;
  }
  const n = scored.length || 1;
  const mean = sum / n;
  const spread = Math.sqrt(Math.max(0, squares / n - mean * mean));
  const floor = Math.max(MIN_SIMILARITY, n >= 8 ? mean + spread : -1);
  return scored.filter(([chunkId, score]) => lexicalIds.has(chunkId) || score >= floor).sort((a, b) => b[1] - a[1]).slice(0, 60);
}

/** Pick the ~260-character window with the densest query-term coverage. */
export function snippet(text, query, size = 260) {
  const words = [...new Set(tokenize(query))].filter(w => w.length > 2);
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= size || !words.length) return clean.slice(0, size) + (clean.length > size ? '…' : '');
  const lower = clean.toLowerCase();
  let best = 0; let bestScore = -1;
  for (let start = 0; start < lower.length - size / 2; start += 40) {
    const window = lower.slice(start, start + size);
    const score = words.reduce((sum, w) => sum + (window.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = start; }
  }
  const from = best === 0 ? 0 : clean.lastIndexOf(' ', best) + 1;
  return `${from > 0 ? '…' : ''}${clean.slice(from, from + size).trim()}${from + size < clean.length ? '…' : ''}`;
}

/**
 * Hybrid search. `queries` may contain several phrasings (deep mode); each runs lexically
 * and densely, and every ranked list is merged with reciprocal rank fusion.
 */
export async function search(ctx, queries, { limit = 8, types = null, exclude = [] } = {}) {
  const started = Date.now();
  const index = await syncIndex(ctx.workspace.id);
  const allowedBase = visibility(ctx);
  const excluded = new Set(exclude);
  const typeSet = types?.length ? new Set(types) : null;
  const allowed = chunk => (!typeSet || typeSet.has(chunk.type)) && !excluded.has(chunk.sourceKey) && allowedBase(chunk);
  const list = [...new Set((Array.isArray(queries) ? queries : [queries]).map(q => String(q || '').trim()).filter(Boolean))].slice(0, 6);
  const fused = new Map();
  const signals = new Map();
  let denseUsed = false;
  for (const query of list) {
    const lexical = bm25(index, tokenize(query), allowed);
    const vector = await embedQuery(query);
    const semantic = dense(index, vector, allowed, new Set(lexical.map(([chunkId]) => chunkId)));
    if (semantic.length) denseUsed = true;
    for (const [ranked, kind] of [[lexical, 'lexical'], [semantic, 'semantic']]) {
      ranked.forEach(([chunkId, score], rank) => {
        fused.set(chunkId, (fused.get(chunkId) || 0) + 1 / (RRF_K + rank + 1));
        const signal = signals.get(chunkId) || {};
        signal[kind] = Math.max(signal[kind] || 0, score);
        signals.set(chunkId, signal);
      });
    }
  }
  const ranked = [...fused].sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] || 1;
  const perSource = new Map();
  const seenHashes = new Set();
  const hits = [];
  for (const [chunkId, score] of ranked) {
    const chunk = index.chunks.get(chunkId);
    if (!chunk || seenHashes.has(chunk.hash)) continue;
    const count = perSource.get(chunk.sourceKey) || 0;
    if (count >= PER_SOURCE_CAP) continue;
    perSource.set(chunk.sourceKey, count + 1);
    seenHashes.add(chunk.hash);
    hits.push({ chunk, score: score / top, signals: signals.get(chunkId) });
    if (hits.length >= limit) break;
  }
  return {
    hits, queries: list, tookMs: Date.now() - started, mode: denseUsed ? 'hybrid' : 'lexical',
    indexed: { chunks: index.chunks.size, sources: index.sources.size },
  };
}

/** Merge adjacent hits from the same source into passages ready for a prompt. */
export function toPassages(hits) {
  const bySource = new Map();
  for (const hit of hits) {
    if (!bySource.has(hit.chunk.sourceKey)) bySource.set(hit.chunk.sourceKey, []);
    bySource.get(hit.chunk.sourceKey).push(hit);
  }
  const passages = [];
  for (const group of bySource.values()) {
    group.sort((a, b) => a.chunk.seq - b.chunk.seq);
    let current = null;
    for (const hit of group) {
      const { chunk } = hit;
      if (current && chunk.seq === current.lastSeq + 1) {
        current.text += chunk.startLine ? `\n${chunk.text.split('\n').slice(Math.max(0, (current.endLine || 0) - chunk.startLine + 1)).join('\n')}` : `\n\n${chunk.text}`;
        current.endLine = chunk.endLine;
        current.lastSeq = chunk.seq;
        current.score = Math.max(current.score, hit.score);
        continue;
      }
      if (current) passages.push(current);
      current = { ...chunk, lastSeq: chunk.seq, score: hit.score, signals: hit.signals };
    }
    if (current) passages.push(current);
  }
  for (const p of passages) if (p.startLine) p.location = `lines ${p.startLine}–${p.endLine}`;
  return passages.sort((a, b) => b.score - a.score);
}

export function ragStatus(workspaceId) {
  const index = indexes.get(workspaceId);
  const embedConfig = embeddingConfig();
  const byType = {};
  let embedded = 0;
  if (index) {
    for (const source of index.sources.values()) byType[source.type] = (byType[source.type] || 0) + 1;
    for (const chunk of index.chunks.values()) if (vectors.has(chunk.hash)) embedded++;
  }
  return {
    ready: Boolean(index?.syncedAt), syncedAt: index?.syncedAt || null,
    chunks: index?.chunks.size || 0, sources: index?.sources.size || 0, terms: index?.postings.size || 0, byType,
    retrieval: embedConfig ? 'hybrid' : 'lexical',
    embeddings: embedConfig
      ? { enabled: true, provider: embedConfig.label, model: embedConfig.model, embedded, pending: Math.max(0, (index?.chunks.size || 0) - embedded), running: embedState.running, lastError: embedState.lastError || null, lastRunAt: embedState.lastRunAt }
      : { enabled: false, provider: null, model: null, embedded: 0, pending: 0, running: false, lastError: null, lastRunAt: null },
  };
}
