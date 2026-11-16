import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, NavLink } from 'react-router-dom';
import { ArrowUp, Bug, Check, ChevronDown, Code2, Copy, Database, FileCode2, FileText, FolderKanban, LoaderCircle, MessagesSquare, Pin, PinOff, Plus, RotateCcw, Save, Search, ShieldCheck, Sparkles, Square, Trash2, X, BookOpen, SlidersHorizontal } from 'lucide-react';
import Markdown, { markdownToHtml } from './Markdown';
import AINav from './AINav';
import { api, errorMessage, streamAI, timeAgo, type StreamMeta } from './lib/api';

type Mode = 'general' | 'explain' | 'review' | 'bug' | 'database' | 'docs';
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt?: string; model?: string; provider?: string; sources?: StreamMeta['sources'] };
type Conversation = { id: string; title: string; mode: Mode; updatedAt: string; messageCount: number; pinned: boolean };
type Provider = { id: string; label: string; configured: boolean; defaultModel: string; models: string[] };
type Status = { available: boolean; provider: string; defaultProvider: string | null; message: string; providers: Provider[]; limits: { perMinute: number; perDay: number } };
type Context = { projectId?: string; documentIds?: string[]; codeProjectId?: string; codeFileIds?: string[]; workspace?: boolean };
type Option = { id: string; name: string };

export const AI_MODES: { id: Mode; label: string; hint: string; icon: typeof Sparkles; prompts: string[] }[] = [
  { id: 'general', label: 'Assistant', hint: 'Plan, explain, summarise, draft', icon: Sparkles, prompts: ['Summarise where this project stands and what to do next', 'Draft a kickoff brief for the selected project', 'Turn these notes into a clear plan with milestones'] },
  { id: 'explain', label: 'Explain code', hint: 'What does this code do?', icon: Code2, prompts: ['What does this code do?', 'Explain the main function step by step', 'How do these files fit together?'] },
  { id: 'review', label: 'Review code', hint: 'Bugs, security, performance', icon: ShieldCheck, prompts: ['Review this code for bugs and security issues', 'Find performance problems in these files', 'What would you refactor first, and why?'] },
  { id: 'bug', label: 'Debug', hint: 'Paste an error, find the cause', icon: Bug, prompts: ['Explain this error and how to fix it:\n\n', 'Why might this fail intermittently?', 'Walk me through debugging this stack trace:\n\n'] },
  { id: 'database', label: 'Database', hint: 'Schema, SQL, ER diagram', icon: Database, prompts: ['Design a database schema for the selected project', 'Suggest indexes and constraints for this schema', 'Draw an ER diagram for these entities'] },
  { id: 'docs', label: 'Write docs', hint: 'Evidence-based documentation', icon: BookOpen, prompts: ['Write a README based on the selected code project', 'Document the API in these files', 'Write an installation guide from this repository'] },
];

export default function AIStudio({ projects, notify, onDocumentSaved }: { projects: { id: string | number; name: string }[]; notify: (message: string) => void; onDocumentSaved?: (doc: { id: string; title: string; content: string; updated: string }) => void }) {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listQuery, setListQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(params.get('c'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) || 'general');
  const [context, setContext] = useState<Context>(() => ({
    projectId: params.get('project') || undefined, codeProjectId: params.get('codeProject') || undefined,
    codeFileIds: params.get('codeFile') ? [params.get('codeFile')!] : undefined, documentIds: params.get('doc') ? [params.get('doc')!] : undefined,
  }));
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [input, setInput] = useState(params.get('prompt') || '');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth > 1100);
  const [docs, setDocs] = useState<Option[]>([]);
  const [codeProjects, setCodeProjects] = useState<Option[]>([]);
  const [codeFiles, setCodeFiles] = useState<{ id: string; path: string }[]>([]);
  const [fileFilter, setFileFilter] = useState('');
  const abort = useRef<AbortController | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<Status>('/api/ai/status').then(data => { setStatus(data); setProviderId(current => current || data.defaultProvider || ''); }).catch(() => setStatus(null));
    api<Conversation[]>('/api/ai/conversations').then(setConversations).catch(() => {});
    api<{ id: string; title: string; type: string }[]>('/api/documents').then(list => setDocs(list.filter(d => d.type !== 'latex').map(d => ({ id: d.id, name: d.title })))).catch(() => {});
    api<{ id: string; name: string }[]>('/api/code-projects').then(list => setCodeProjects(list.map(p => ({ id: p.id, name: p.name })))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!context.codeProjectId) { setCodeFiles([]); return; }
    api<{ id: string; path: string; binary: boolean }[]>(`/api/code-projects/${context.codeProjectId}/files`).then(list => setCodeFiles(list.filter(f => !f.binary))).catch(() => setCodeFiles([]));
  }, [context.codeProjectId]);

  const openConversation = useCallback(async (conversationId: string | null) => {
    abort.current?.abort();
    setActiveId(conversationId); setError('');
    setParams(current => { const next = new URLSearchParams(current); if (conversationId) next.set('c', conversationId); else next.delete('c'); ['prompt', 'codeFile', 'codeProject', 'project', 'doc', 'mode'].forEach(k => next.delete(k)); return next; }, { replace: true });
    if (!conversationId) { setMessages([]); return; }
    setLoadingThread(true);
    try {
      const data = await api<{ messages: Message[]; mode: Mode; context: Context }>(`/api/ai/conversations/${conversationId}`);
      setMessages(data.messages); setMode(data.mode || 'general'); if (data.context) setContext(data.context);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoadingThread(false); }
  }, [setParams]);

  useEffect(() => { if (activeId && !messages.length) openConversation(activeId); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { threadEnd.current?.scrollIntoView({ block: 'end', behavior: streaming ? 'auto' : 'smooth' }); }, [messages, streaming]);

  const provider = status?.providers.find(p => p.id === providerId);
  const contextCount = (context.projectId ? 1 : 0) + (context.documentIds?.length || 0) + (context.codeProjectId ? 1 : 0) + (context.codeFileIds?.length || 0) + (context.workspace ? 1 : 0);

  const run = async (text: string, regenerate = false) => {
    if (!text.trim() || streaming) return;
    setError(''); setStreaming(true);
    const controller = new AbortController();
    abort.current = controller;
    const assistantId = `pending-${Date.now()}`;
    setMessages(current => {
      const base = regenerate ? current.slice(0, current.map(m => m.role).lastIndexOf('user') + 1) : [...current, { id: `u-${Date.now()}`, role: 'user' as const, content: text }];
      return [...base, { id: assistantId, role: 'assistant' as const, content: '' }];
    });
    let conversationId = activeId;
    try {
      await streamAI({ conversationId: activeId || undefined, persist: !activeId, message: text, regenerate, mode, context, provider: providerId || undefined, model: model || undefined }, {
        signal: controller.signal,
        onMeta: meta => {
          if (meta.conversationId && !conversationId) {
            conversationId = meta.conversationId; setActiveId(meta.conversationId);
            setParams(() => { const next = new URLSearchParams(); next.set('c', meta.conversationId!); return next; }, { replace: true });
          }
          setMessages(current => current.map(m => m.id === assistantId ? { ...m, model: meta.model, provider: meta.provider, sources: meta.sources } : m));
        },
        onDelta: delta => setMessages(current => current.map(m => m.id === assistantId ? { ...m, content: m.content + delta } : m)),
      });
      api<Conversation[]>('/api/ai/conversations').then(setConversations).catch(() => {});
    } catch (e) {
      if ((e as Error).name === 'AbortError') setMessages(current => current.map(m => m.id === assistantId ? { ...m, content: `${m.content}\n\n_Stopped._` } : m));
      else { setError(errorMessage(e, 'The AI request failed')); setMessages(current => current.filter(m => !(m.id === assistantId && !m.content))); }
    } finally { setStreaming(false); abort.current = null; }
  };

  const submit = (event?: React.FormEvent) => { event?.preventDefault(); const text = input; setInput(''); run(text); };
  const lastUser = [...messages].reverse().find(m => m.role === 'user');

  const saveToDocs = async (message: Message) => {
    try {
      const title = `${conversations.find(c => c.id === activeId)?.title || 'AI response'}`.slice(0, 150);
      const doc = await api<{ id: string; title: string; content: string; updated: string }>('/api/documents', { body: { title, content: markdownToHtml(message.content), type: 'rich-text', projectId: context.projectId } });
      onDocumentSaved?.(doc); notify('Saved to Documents');
    } catch (e) { notify(errorMessage(e, 'Could not save the document')); }
  };

  const removeConversation = async (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}”?`)) return;
    try { await api(`/api/ai/conversations/${conversation.id}`, { method: 'DELETE' }); setConversations(list => list.filter(c => c.id !== conversation.id)); if (activeId === conversation.id) openConversation(null); }
    catch (e) { notify(errorMessage(e)); }
  };
  const togglePin = async (conversation: Conversation) => {
    try { const updated = await api<Conversation>(`/api/ai/conversations/${conversation.id}`, { method: 'PATCH', body: { pinned: !conversation.pinned } }); setConversations(list => list.map(c => c.id === updated.id ? updated : c).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))); }
    catch (e) { notify(errorMessage(e)); }
  };

  const visibleConversations = useMemo(() => conversations.filter(c => c.title.toLowerCase().includes(listQuery.trim().toLowerCase())), [conversations, listQuery]);
  const modeInfo = AI_MODES.find(m => m.id === mode)!;
  const toggleId = (key: 'documentIds' | 'codeFileIds', value: string) => setContext(current => { const list = current[key] || []; return { ...current, [key]: list.includes(value) ? list.filter(x => x !== value) : [...list, value].slice(0, 12) }; });

  return <>
    <section className="welcome-row subpage-welcome zy-compact-head"><div><div className="eyebrow">ZYNCKLE AI · WORKSPACE-AWARE</div><h1>Think it through, <em>together.</em></h1><p className="welcome-sub">Ask about your projects, documents and code. Context is only shared when you select it.</p></div></section>
    <AINav/>
    {status && !status.available && <div className="zy-banner"><span className="zy-dot"/><div><strong>No AI provider is configured</strong><small>Add GROQ_API_KEY (or GEMINI_API_KEY / OPENROUTER_API_KEY) to the backend .env and restart the API. Conversations below remain readable.</small></div><NavLink className="text-button" to="/settings#ai">Provider settings</NavLink></div>}
    <div className={`zy-ai ${contextOpen ? 'with-context' : ''}`}>
      <aside className="zy-ai-history">
        <button className="button-primary zy-block" onClick={() => { openConversation(null); setTimeout(() => composer.current?.focus(), 50); }}><Plus size={16}/> New conversation</button>
        <label className="zy-search-field"><Search size={15}/><input value={listQuery} onChange={e => setListQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations"/></label>
        <div className="eyebrow">HISTORY · {conversations.length}</div>
        <div className="zy-ai-list">
          {visibleConversations.map(c => <div key={c.id} className={`zy-ai-item ${c.id === activeId ? 'selected' : ''}`}>
            <button onClick={() => openConversation(c.id)}><strong>{c.pinned && <Pin size={12}/>} {c.title}</strong><small>{AI_MODES.find(m => m.id === c.mode)?.label || 'Assistant'} · {timeAgo(c.updatedAt)}</small></button>
            <span className="zy-row-actions"><button className="icon-button" aria-label={c.pinned ? 'Unpin' : 'Pin'} title={c.pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(c)}>{c.pinned ? <PinOff size={14}/> : <Pin size={14}/>}</button><button className="icon-button danger" aria-label="Delete conversation" title="Delete" onClick={() => removeConversation(c)}><Trash2 size={14}/></button></span>
          </div>)}
          {!visibleConversations.length && <p className="zy-muted-note">{listQuery ? 'No conversations match.' : 'Your conversations are saved here, privately.'}</p>}
        </div>
      </aside>

      <section className="zy-ai-thread" aria-live="polite">
        <header className="zy-ai-toolbar">
          <div className="zy-mode-chips" role="radiogroup" aria-label="Assistant mode">
            {AI_MODES.map(m => <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)} title={m.hint}><m.icon size={15}/>{m.label}</button>)}
          </div>
          <button className={`zy-context-toggle ${contextCount ? 'has' : ''}`} onClick={() => setContextOpen(o => !o)} aria-expanded={contextOpen}><SlidersHorizontal size={14}/> Context{contextCount ? ` · ${contextCount}` : ''}</button>
        </header>
        <div className="zy-ai-messages">
          {loadingThread && <div className="zy-skeleton-stack"><i/><i/><i/></div>}
          {!loadingThread && !messages.length && <div className="zy-ai-empty">
            <span className="zy-ai-glyph"><modeInfo.icon size={22}/></span>
            <h2>{modeInfo.label === 'Assistant' ? 'What are you working through?' : modeInfo.hint}</h2>
            <p>{mode === 'explain' || mode === 'review' ? 'Pick a code project and files in Context, then ask.' : mode === 'docs' ? 'Select a code project or documents as evidence. Unsupported claims are marked as assumptions.' : 'Add a project, documents or code as context for grounded answers.'}</p>
            <div className="zy-prompt-grid">{modeInfo.prompts.map(prompt => <button key={prompt} onClick={() => { setInput(prompt); composer.current?.focus(); }}>{prompt.trim()}<ArrowUp size={14}/></button>)}</div>
          </div>}
          {messages.map((message, index) => <article key={message.id} className={`zy-msg zy-msg-${message.role}`}>
            {message.role === 'user' ? <div className="zy-msg-user-body">{message.content}</div> : <>
              <div className="zy-msg-meta"><span className="zy-ai-glyph small"><Sparkles size={12}/></span>ZYNCKLE{message.model && <small>{message.provider} · {message.model}</small>}</div>
              {message.content ? <Markdown source={message.content} streaming={streaming && index === messages.length - 1}/> : <div className="zy-typing"><i/><i/><i/></div>}
              {!!message.sources?.length && <div className="zy-sources"><span>Grounded in</span>{message.sources.map(s => <em key={`${s.type}-${s.id}`}>{s.type.includes('code') ? <FileCode2 size={12}/> : s.type === 'project' ? <FolderKanban size={12}/> : <FileText size={12}/>}{s.label}</em>)}</div>}
              {message.content && !(streaming && index === messages.length - 1) && <div className="zy-msg-actions">
                <button onClick={() => { navigator.clipboard.writeText(message.content); notify('Response copied'); }}><Copy size={13}/> Copy</button>
                {index === messages.length - 1 && lastUser && <button onClick={() => run(lastUser.content, true)} disabled={streaming || !status?.available}><RotateCcw size={13}/> Regenerate</button>}
                <button onClick={() => saveToDocs(message)}><Save size={13}/> Save to Documents</button>
              </div>}
            </>}
          </article>)}
          {error && <div className="zy-inline-error" role="alert"><X size={15}/>{error}</div>}
          <div ref={threadEnd}/>
        </div>
        <form className="zy-composer" onSubmit={submit}>
          <textarea ref={composer} value={input} onChange={e => setInput(e.target.value)} rows={Math.min(8, Math.max(2, input.split('\n').length))} placeholder={status?.available ? `Message Zynckle · ${modeInfo.hint}` : 'Configure an AI provider to start'} aria-label="Message" maxLength={16000}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}/>
          <div className="zy-composer-bar">
            <div className="zy-model-pick">
              <select value={providerId} onChange={e => { setProviderId(e.target.value); setModel(''); }} aria-label="AI provider" disabled={!status?.available}>{status?.providers.filter(p => p.configured).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}{!status?.available && <option>No provider</option>}</select>
              {provider && <select value={model || provider.defaultModel} onChange={e => setModel(e.target.value)} aria-label="Model">{provider.models.map(m => <option key={m}>{m}</option>)}</select>}
              <ChevronDown size={13} aria-hidden/>
            </div>
            <span className="zy-hint">Enter to send · Shift+Enter for a new line</span>
            {streaming ? <button type="button" className="button-secondary" onClick={() => abort.current?.abort()}><Square size={13}/> Stop</button>
              : <button className="button-primary" disabled={!input.trim() || !status?.available}>{streaming ? <LoaderCircle className="spin" size={15}/> : <ArrowUp size={15}/>} Send</button>}
          </div>
        </form>
      </section>

      {contextOpen && <aside className="zy-ai-context" aria-label="Context for the assistant">
        <header><div><div className="eyebrow">CONTEXT</div><strong>What Zynckle can read</strong></div><button className="icon-button" aria-label="Close context" onClick={() => setContextOpen(false)}><X size={16}/></button></header>
        <p className="zy-muted-note">Only items you select are sent to the AI provider, after the server checks your access.</p>
        <label className="zy-field">Project<select value={context.projectId || ''} onChange={e => setContext(c => ({ ...c, projectId: e.target.value || undefined }))}><option value="">None</option>{projects.filter(p => typeof p.id === 'string').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="zy-check"><input type="checkbox" checked={Boolean(context.workspace)} onChange={e => setContext(c => ({ ...c, workspace: e.target.checked }))}/> Include a workspace overview</label>
        <div className="zy-field">Documents<div className="zy-pick-list">{docs.length ? docs.map(d => <label key={d.id} className="zy-check"><input type="checkbox" checked={context.documentIds?.includes(d.id) || false} onChange={() => toggleId('documentIds', d.id)}/>{d.name}</label>) : <span className="zy-muted-note">No documents yet</span>}</div></div>
        <label className="zy-field">Code project<select value={context.codeProjectId || ''} onChange={e => setContext(c => ({ ...c, codeProjectId: e.target.value || undefined, codeFileIds: [] }))}><option value="">None</option>{codeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {context.codeProjectId && <div className="zy-field">Files {context.codeFileIds?.length ? `· ${context.codeFileIds.length} selected` : '· key files used automatically'}
          <label className="zy-search-field"><Search size={14}/><input value={fileFilter} onChange={e => setFileFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files"/></label>
          <div className="zy-pick-list tall">{codeFiles.filter(f => f.path.toLowerCase().includes(fileFilter.toLowerCase())).slice(0, 300).map(f => <label key={f.id} className="zy-check mono"><input type="checkbox" checked={context.codeFileIds?.includes(f.id) || false} onChange={() => toggleId('codeFileIds', f.id)}/>{f.path}</label>)}</div>
        </div>}
        {contextCount > 0 && <button className="text-button" onClick={() => setContext({})}><X size={13}/> Clear context</button>}
        {status && <p className="zy-muted-note">Limits: {status.limits.perMinute} requests per minute, {status.limits.perDay} per day.</p>}
        <p className="zy-muted-note"><Check size={13}/> Provider keys stay on the server. <MessagesSquare size={13}/> Conversations are private to you.</p>
      </aside>}
    </div>
  </>;
}
