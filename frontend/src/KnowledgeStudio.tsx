import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Cpu, Library, LoaderCircle, RefreshCw, Search, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert, Zap } from 'lucide-react';
import AINav from './AINav';
import { SOURCE_ICONS, SOURCE_LABELS } from './sourceMeta';
import { api, errorMessage, timeAgo } from './lib/api';

type Status = {
  ready: boolean; syncedAt: string | null; chunks: number; sources: number; terms: number; byType: Record<string, number>; retrieval: 'hybrid' | 'lexical';
  embeddings: { enabled: boolean; provider: string | null; model: string | null; embedded: number; pending: number; running: boolean; lastError: string | null };
};
type Result = { id: string; type: string; sourceId: string; title: string; section: string | null; location: string | null; link: string; updatedAt: string | null; snippet: string; score: number; signals: { lexical: number | null; semantic: number | null } };
type Quality = { answers: number; helpful: number; unhelpful: number; flagged: { id: string; conversationId: string; question: string | null; answer: string; note: string | null; sourceCount: number; createdAt: string }[] };
type Response = { query: string; mode: 'hybrid' | 'lexical'; tookMs: number; results: Result[] };

const TYPES = ['document', 'task', 'project', 'latex', 'preview', 'code-file', 'file', 'architecture'];

/** Wrap query words in <mark>; built from text nodes, so nothing in a snippet is ever parsed as HTML. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || [])].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(w => `${w.slice(0, Math.max(3, w.length - 2))}[\\p{L}\\p{N}_]*`).join('|')})`, 'giu');
  return <>{text.split(pattern).map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>)}</>;
}

export default function KnowledgeStudio({ notify }: { notify: (message: string) => void }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState(params.get('q') || '');
  const [types, setTypes] = useState<string[]>([]);
  const [response, setResponse] = useState<Response | null>(null);
  const [searching, setSearching] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState<Quality | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  const loadStatus = useCallback(() => api<Status>('/api/ai/knowledge').then(data => setStatus(data?.byType ? data : null)).catch(() => setStatus(null)), []);
  useEffect(() => { loadStatus(); input.current?.focus(); }, [loadStatus]);
  // Admin-only: the server answers 403 for everyone else, and the panel simply stays hidden.
  useEffect(() => { api<Quality>('/api/ai/quality').then(d => setQuality(typeof d?.answers === 'number' ? d : null)).catch(() => setQuality(null)); }, []);
  // Embedding runs in the background after indexing; poll until it settles.
  useEffect(() => {
    if (!status?.embeddings.enabled || (!status.embeddings.running && !status.embeddings.pending) || status.embeddings.lastError) return;
    const timer = setTimeout(loadStatus, 2500);
    return () => clearTimeout(timer);
  }, [status, loadStatus]);

  const run = useCallback(async (q: string, filter: string[]) => {
    const term = q.trim();
    setParams(current => { const next = new URLSearchParams(current); if (term) next.set('q', term); else next.delete('q'); return next; }, { replace: true });
    if (term.length < 2) { setResponse(null); return; }
    const ticket = ++latest.current;
    setSearching(true); setError('');
    try {
      const data = await api<Response>(`/api/ai/knowledge/search?q=${encodeURIComponent(term)}&limit=20${filter.length ? `&types=${filter.join(',')}` : ''}`);
      if (ticket === latest.current) setResponse(Array.isArray(data?.results) ? data : { query: term, mode: 'lexical', tookMs: 0, results: [] });
    } catch (e) { if (ticket === latest.current) setError(errorMessage(e, 'Search failed')); }
    finally { if (ticket === latest.current) setSearching(false); }
  }, [setParams]);

  // Search as you type, debounced.
  useEffect(() => { const timer = setTimeout(() => run(query, types), 220); return () => clearTimeout(timer); }, [query, types, run]);

  const reindex = async () => {
    setReindexing(true);
    try { setStatus(await api<Status>('/api/ai/knowledge/reindex', { method: 'POST', body: {} })); notify('Workspace knowledge rebuilt'); if (query.trim().length >= 2) run(query, types); }
    catch (e) { notify(errorMessage(e, 'Reindex failed')); }
    finally { setReindexing(false); }
  };

  const ask = (prompt: string) => navigate(`/ai?prompt=${encodeURIComponent(prompt)}`);
  const toggleType = (type: string) => setTypes(list => list.includes(type) ? list.filter(t => t !== type) : [...list, type]);
  const embed = status?.embeddings;
  const embedPct = embed?.enabled && status?.chunks ? Math.round((embed.embedded / status.chunks) * 100) : 0;

  return <>
    <section className="welcome-row subpage-welcome zy-compact-head"><div><div className="eyebrow">ZYNCKLE AI · WORKSPACE KNOWLEDGE</div><h1>Everything you know, <em>searchable.</em></h1><p className="welcome-sub">One index over projects, tasks, documents, code and Drive. The assistant retrieves from it and cites what it used.</p></div></section>
    <AINav/>
    <div className="zy-kb">
      <section className="zy-kb-main">
        <form className="zy-kb-search" onSubmit={e => { e.preventDefault(); run(query, types); }}>
          <Search size={18}/>
          <input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by meaning or by exact identifier, e.g. “how are refunds handled” or roundCents" aria-label="Search workspace knowledge" maxLength={500}/>
          {searching && <LoaderCircle className="spin" size={16}/>}
          {query.trim().length > 3 && <button type="button" className="button-primary" onClick={() => ask(query.trim())}><Sparkles size={14}/> Ask AI</button>}
        </form>
        <div className="zy-kb-filters" role="group" aria-label="Filter by source type">
          {TYPES.map(type => { const Icon = SOURCE_ICONS[type]; const count = status?.byType[type] || 0; return <button key={type} className={types.includes(type) ? 'active' : ''} aria-pressed={types.includes(type)} onClick={() => toggleType(type)} disabled={!count && !types.includes(type)}><Icon size={13}/>{SOURCE_LABELS[type]}<small>{count}</small></button>; })}
        </div>
        {response && <div className="zy-kb-meta">{response.results.length} result{response.results.length === 1 ? '' : 's'} · {response.mode === 'hybrid' ? 'hybrid (keyword + semantic)' : 'keyword (BM25)'} · {response.tookMs} ms</div>}
        {error && <div className="zy-inline-error" role="alert"><TriangleAlert size={15}/>{error}</div>}
        <ol className="zy-kb-results">
          {response?.results.map(result => { const Icon = SOURCE_ICONS[result.type] || Library; return <li key={result.id}>
            <button className="zy-kb-hit" onClick={() => navigate(result.link)}>
              <header><Icon size={14}/><strong>{result.title}</strong>{(result.section || result.location) && <span>{result.location || result.section}</span>}<ArrowUpRight size={14}/></header>
              <p><Highlight text={result.snippet} query={response.query}/></p>
              <footer>
                <span className="zy-kb-score" title={`Fused relevance ${Math.round(result.score * 100)}%`}><i style={{ width: `${Math.max(6, result.score * 100)}%` }}/></span>
                <small>{SOURCE_LABELS[result.type] || result.type}</small>
                {result.signals.lexical !== null && <small title="BM25 keyword score">keyword {result.signals.lexical}</small>}
                {result.signals.semantic !== null && <small title="Cosine similarity">semantic {result.signals.semantic}</small>}
                {result.updatedAt && <small>updated {timeAgo(result.updatedAt)}</small>}
              </footer>
            </button>
            <button className="text-button" onClick={() => ask(`Using "${result.title}"${result.location ? ` (${result.location})` : ''}, ${query.trim()}`)}><Sparkles size={13}/> Ask about this</button>
          </li>; })}
        </ol>
        {response && !response.results.length && !searching && <div className="zy-ai-empty"><span className="zy-ai-glyph"><Search size={20}/></span><h2>Nothing matched</h2><p>Try different words, remove filters, or rebuild the index if you just imported content.</p></div>}
        {!response && !searching && <div className="zy-ai-empty">
          <span className="zy-ai-glyph"><Library size={22}/></span>
          <h2>Search across your whole workspace</h2>
          <p>Keyword ranking catches exact names like <code>useAuth</code> or <code>INV-204</code>. {status?.retrieval === 'hybrid' ? 'Semantic ranking catches meaning when the words differ.' : 'Add an embedding provider to also match by meaning.'}</p>
        </div>}
      </section>

      <aside className="zy-kb-side" aria-label="Index status">
        <header><div><div className="eyebrow">INDEX</div><strong>{status?.ready ? 'Up to date' : status ? 'Building…' : 'Unavailable'}</strong></div>
          <button className="button-secondary" onClick={reindex} disabled={reindexing || !status}>{reindexing ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>} Rebuild</button></header>
        {status ? <>
          <dl className="zy-kb-stats">
            <div><dt>Sources</dt><dd>{status.sources.toLocaleString()}</dd></div>
            <div><dt>Passages</dt><dd>{status.chunks.toLocaleString()}</dd></div>
            <div><dt>Terms</dt><dd>{status.terms.toLocaleString()}</dd></div>
          </dl>
          <div className="zy-kb-engine">
            <div><Zap size={14}/><span><strong>Keyword</strong><small>BM25 · code-aware tokenizer</small></span><em className="on">On</em></div>
            <div><Cpu size={14}/><span><strong>Semantic</strong><small>{embed?.enabled ? `${embed.provider} · ${embed.model}` : 'Set GEMINI_API_KEY or EMBEDDING_URL'}</small></span><em className={embed?.enabled ? 'on' : ''}>{embed?.enabled ? 'On' : 'Off'}</em></div>
            {embed?.enabled && <div className="zy-kb-progress"><span><i style={{ width: `${embedPct}%` }}/></span><small>{embed.embedded.toLocaleString()} of {status.chunks.toLocaleString()} passages embedded{embed.running ? ' · working' : ''}</small></div>}
            {embed?.lastError && <p className="zy-inline-error"><TriangleAlert size={13}/>{embed.lastError}</p>}
          </div>
          {status.syncedAt && <p className="zy-muted-note">Synced {timeAgo(status.syncedAt)}. Changes are picked up automatically on the next search or question.</p>}
        </> : <p className="zy-muted-note">The knowledge index runs in the Spring Boot API. Start it with <code>mvnw spring-boot:run</code> in <code>backend/</code>.</p>}
        <p className="zy-muted-note">Results respect permissions: private documents, files and code projects only appear for the people who can open them.</p>
        {quality && <div className="zy-kb-quality">
          <div className="eyebrow">ANSWER QUALITY</div>
          <div className="zy-kb-quality-row"><span><ThumbsUp size={13}/><b>{quality.helpful}</b> helpful</span><span><ThumbsDown size={13}/><b>{quality.unhelpful}</b> not helpful</span><small>{quality.answers} answers</small></div>
          {quality.flagged.length ? <ul>{quality.flagged.slice(0, 5).map(f => <li key={f.id}><button onClick={() => navigate(`/ai?c=${f.conversationId}`)} title={f.answer}><strong>{f.question || 'Untitled question'}</strong><small>{f.note ? `“${f.note}” · ` : ''}{f.sourceCount} source{f.sourceCount === 1 ? '' : 's'} · {timeAgo(f.createdAt)}</small></button></li>)}</ul>
            : <p className="zy-muted-note">No answers flagged as unhelpful. People rate answers with the thumbs under each reply.</p>}
          {quality.flagged.length > 0 && <p className="zy-muted-note">Flagged answers with few sources usually mean missing content: add a document, then rebuild.</p>}
        </div>}
        <NavLink className="text-button" to="/ai"><Sparkles size={13}/> Open the assistant</NavLink>
      </aside>
    </div>
  </>;
}
