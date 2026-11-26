import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { BookOpen, Sparkles, Maximize2, Minimize2, Check, ChevronDown, ChevronRight, Folder, FolderPlus, History, Lock, MessageSquare, MoreHorizontal, Plus, Save, Share2, Trash2, X, Pencil, CheckCheck, RotateCcw } from 'lucide-react';
import ShareDialog from './components/ShareDialog';
import { api, errorMessage, timeAgo, getToken } from './lib/api';
import { useRealtimeEvent } from './lib/realtime';
import type { Peer } from './RichTextEditor';
import { colorFor } from './RichTextEditor';
import './document-history.css';

const RichTextEditor = lazy(() => import('./RichTextEditor'));

type Doc = { id: string; title: string; body: string; updated: string };
type ApiDoc = { id: string; title: string; content: string; type: string; updated: string; folderId: string | null; projectId: string | null; visibility: 'workspace' | 'private'; ownerId: string; owner: string; collaboratorIds: string[]; commentCount: number; updatedBy?: string };
type DocVersion = { id: string; title: string; content: string; number: number; createdAt: string; author: string };
type DocFolder = { id: string; name: string };
type Comment = { id: string; body: string; quote: string; resolved: boolean; createdAt: string; author: { id: string; name: string; avatar: string }; mine: boolean };

export default function DocumentsStudio({ onSave, notify, search, account, canEdit, isAdmin, projects }: {
  docs: Doc[]; onSave: (docs: Doc[]) => void; notify: (message: string) => void; token: string; search: string;
  account: { id?: string; name: string }; canEdit: boolean; isAdmin: boolean; projects: { id: string | number; name: string }[];
}) {
  const [params, setParams] = useSearchParams();
  const [docs, setDocs] = useState<ApiDoc[] | null>(null);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(params.get('doc'));
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [editorSeed, setEditorSeed] = useState(0);
  const [localOnly, setLocalOnly] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [selection, setSelection] = useState('');
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [focus, setFocus] = useState(false);
  // Focus mode: hide the workspace chrome and give the page a reading measure.
  useEffect(() => {
    document.documentElement.classList.toggle('zy-focus', focus);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && focus) setFocus(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.documentElement.classList.remove('zy-focus'); };
  }, [focus]);
  const saveTimer = useRef(0);
  const latest = useRef({ title: '', body: '' });

  const sync = useCallback((list: ApiDoc[]) => onSave(list.map(d => ({ id: d.id, title: d.title, body: d.content, updated: d.updated }))), [onSave]);
  const load = useCallback(async () => {
    const [list, folderList] = await Promise.all([api<ApiDoc[]>('/api/documents'), api<DocFolder[]>('/api/doc-folders')]);
    const rich = list.filter(d => d.type !== 'latex');
    setDocs(rich); setFolders(folderList);
    return rich;
  }, [sync]);

  useEffect(() => { load().then(list => { if (!active && list[0]) open(list[0]); else if (active) { const d = list.find(x => x.id === active); if (d) open(d); else setActive(null); } }).catch(e => { notify(errorMessage(e, 'Documents could not be loaded')); setDocs([]); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = docs?.find(d => d.id === active) || null;
  useEffect(() => { if (docs) sync(docs); }, [docs, sync]);

  const open = (doc: ApiDoc) => {
    if (saveState === 'unsaved') flushSave();
    setActive(doc.id); setTitle(doc.title); setBody(doc.content); latest.current = { title: doc.title, body: doc.content };
    setSaveState('saved'); setLocalOnly(false); setPeers([]); setCommentsOpen(false); setMenu(false);
    setParams(p => { const n = new URLSearchParams(p); n.set('doc', doc.id); return n; }, { replace: true });
  };

  const persist = useCallback(async (snapshot: boolean) => {
    if (!active || !canEdit) return;
    window.clearTimeout(saveTimer.current);
    setSaveState('saving');
    try {
      const saved = await api<ApiDoc>('/api/documents', { body: { id: active, title: latest.current.title.trim() || 'Untitled document', content: latest.current.body, type: 'rich-text', snapshot } });
      setDocs(list => (list || []).map(d => d.id === saved.id ? { ...d, ...saved } : d));
      setSaveState('saved');
      if (snapshot) notify('Revision saved');
    } catch (e) { setSaveState('error'); notify(errorMessage(e, 'Document could not be saved')); }
  }, [active, canEdit, notify, sync]);
  const flushSave = () => { window.clearTimeout(saveTimer.current); persist(false); };

  const scheduleSave = () => { setSaveState('unsaved'); window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => persist(false), 1800); };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const create = async (folderId: string | null = null) => {
    try {
      const doc = await api<ApiDoc>('/api/documents', { body: { title: 'Untitled document', content: '', type: 'rich-text', folderId } });
      setDocs(list => [doc, ...(list || [])]);
      open(doc);
    } catch (e) { notify(errorMessage(e)); }
  };

  const patch = async (values: Record<string, unknown>, message: string) => {
    if (!active) return;
    try { const updated = await api<ApiDoc>(`/api/documents/${active}`, { method: 'PATCH', body: values }); setDocs(list => (list || []).map(d => d.id === updated.id ? { ...d, ...updated } : d)); notify(message); }
    catch (e) { notify(errorMessage(e)); }
  };

  const remove = async () => {
    if (!active || !window.confirm('Delete this document, its comments and its revision history?')) return;
    try {
      await api(`/api/documents/${active}`, { method: 'DELETE' });
      const rest = (docs || []).filter(d => d.id !== active);
      setDocs(rest); setActive(null); setTitle(''); setBody('');
      if (rest[0]) open(rest[0]);
      notify('Document deleted');
    } catch (e) { notify(errorMessage(e)); }
  };

  const createFolder = async () => {
    const name = window.prompt('Folder name')?.trim();
    if (!name) return;
    try { const folder = await api<DocFolder>('/api/doc-folders', { body: { name } }); setFolders(f => [...f, folder]); }
    catch (e) { notify(errorMessage(e)); }
  };
  const renameFolder = async (folder: DocFolder) => {
    const name = window.prompt('Rename folder', folder.name)?.trim();
    if (!name || name === folder.name) return;
    try { const updated = await api<DocFolder>(`/api/doc-folders/${folder.id}`, { method: 'PATCH', body: { name } }); setFolders(f => f.map(x => x.id === folder.id ? updated : x)); }
    catch (e) { notify(errorMessage(e)); }
  };
  const deleteFolder = async (folder: DocFolder) => {
    if (!window.confirm(`Delete folder “${folder.name}”? Its documents move to “Unfiled”.`)) return;
    try { await api(`/api/doc-folders/${folder.id}`, { method: 'DELETE' }); setFolders(f => f.filter(x => x.id !== folder.id)); setDocs(list => (list || []).map(d => d.folderId === folder.id ? { ...d, folderId: null } : d)); }
    catch (e) { notify(errorMessage(e)); }
  };

  const openHistory = async () => {
    if (!active) return;
    setHistoryOpen(true); setHistoryBusy(true); setHistoryError('');
    try { setVersions(await api<DocVersion[]>(`/api/documents/${active}/versions`)); }
    catch (error) { setHistoryError(errorMessage(error, 'History could not be loaded')); }
    finally { setHistoryBusy(false); }
  };
  const restore = (version: DocVersion) => {
    setTitle(version.title); setBody(version.content); latest.current = { title: version.title, body: version.content };
    // Restoring replaces the shared document: use a local editor seeded from the snapshot, then save.
    setLocalOnly(true); setEditorSeed(seed => seed + 1); setHistoryOpen(false);
    persist(true);
    notify(`Restored version ${version.number} as a new revision`);
  };

  const loadComments = useCallback(async () => { if (active) setComments(await api<Comment[]>(`/api/documents/${active}/comments`).catch(() => [])); }, [active]);
  useEffect(() => { if (commentsOpen) loadComments(); }, [commentsOpen, loadComments]);
  const addComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || !commentBody.trim()) return;
    try { const c = await api<Comment>(`/api/documents/${active}/comments`, { body: { body: commentBody, quote: selection } }); setComments(list => [...list.filter(x => x.id !== c.id), c]); setCommentBody(''); setSelection(''); }
    catch (e) { notify(errorMessage(e)); }
  };
  const resolve = async (comment: Comment) => {
    try { const c = await api<Comment>(`/api/doc-comments/${comment.id}`, { method: 'PATCH', body: { resolved: !comment.resolved } }); setComments(list => list.map(x => x.id === c.id ? c : x)); }
    catch (e) { notify(errorMessage(e)); }
  };
  const deleteComment = async (comment: Comment) => {
    try { await api(`/api/doc-comments/${comment.id}`, { method: 'DELETE' }); setComments(list => list.filter(x => x.id !== comment.id)); }
    catch (e) { notify(errorMessage(e)); }
  };

  useRealtimeEvent('document.changed', (data: { id: string; created?: boolean }) => { if (data.created || !docs?.some(d => d.id === data.id)) load().catch(() => {}); else setDocs(list => (list || []).map(d => d.id === data.id ? { ...d, ...data } : d)); });
  useRealtimeEvent('document.deleted', (data: { id: string }) => { setDocs(list => (list || []).filter(d => d.id !== data.id)); if (data.id === active) { notify('This document was deleted by a teammate'); setActive(null); } });
  useRealtimeEvent('doc-comment.changed', (data: { documentId: string }) => { if (data.documentId === active && commentsOpen) loadComments(); });

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => (docs || []).filter(d => `${d.title} ${d.content.replace(/<[^>]*>/g, ' ')}`.toLowerCase().includes(query)), [docs, query]);
  const groups = useMemo(() => [{ id: '', name: 'Unfiled' }, ...folders].map(folder => ({ folder, items: visible.filter(d => (d.folderId || '') === folder.id) })), [folders, visible]);
  const collab = useMemo(() => active && !localOnly ? { docId: active, token: getToken(), user: { name: account.name, color: colorFor(account.id || account.name) }, readOnly: !canEdit } : undefined, [active, localOnly, account.name, account.id, canEdit]);
  const canShare = Boolean(current && (current.ownerId === account.id || isAdmin));

  return <>
    <section className="welcome-row subpage-welcome"><div><div className="eyebrow">ZYNCKLE DOCS · LIVE COLLABORATION</div><h1>Ideas, <em>in writing.</em></h1><p className="welcome-sub">Write together in real time. Changes save automatically; save a revision whenever you reach a milestone.</p></div>{canEdit && <button className="button-primary" onClick={() => create()}><Plus size={16}/> New document</button>}</section>
    <div className={`docs-layout zy-docs ${commentsOpen ? 'with-comments' : ''}`}>
      <aside className="docs-list">
        <div className="zy-docs-list-head"><div className="eyebrow">DOCUMENTS · {docs?.length ?? '—'}</div>{canEdit && <button className="tiny-icon" onClick={createFolder} aria-label="New folder" title="New folder"><FolderPlus size={14}/></button>}</div>
        {docs === null && <div className="zy-skeleton-rows small"><i/><i/><i/></div>}
        {groups.map(({ folder, items }) => (folder.id || items.length || !folders.length ? <div key={folder.id || 'unfiled'} className="zy-doc-group">
          {(folders.length > 0) && <div className="zy-doc-folder"><button onClick={() => setCollapsed(c => { const n = new Set(c); if (n.has(folder.id)) n.delete(folder.id); else n.add(folder.id); return n; })} aria-expanded={!collapsed.has(folder.id)}>{collapsed.has(folder.id) ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}<Folder size={13}/>{folder.name}<small>{items.length}</small></button>
            {folder.id && canEdit && <span className="zy-row-actions"><button className="tiny-icon" title="New document here" aria-label="New document in folder" onClick={() => create(folder.id)}><Plus size={12}/></button><button className="tiny-icon" title="Rename" aria-label="Rename folder" onClick={() => renameFolder(folder)}><Pencil size={11}/></button><button className="tiny-icon danger" title="Delete folder" aria-label="Delete folder" onClick={() => deleteFolder(folder)}><Trash2 size={11}/></button></span>}</div>}
          {!collapsed.has(folder.id) && items.map(doc => <button key={doc.id} className={`doc-link ${active === doc.id ? 'selected' : ''}`} onClick={() => open(doc)}>{doc.visibility === 'private' ? <Lock size={14}/> : <BookOpen size={15}/>}<span>{doc.title}<small>{timeAgo(doc.updated)}{doc.commentCount ? ` · ${doc.commentCount} comment${doc.commentCount === 1 ? '' : 's'}` : ''}</small></span></button>)}
        </div> : null))}
        {docs && !visible.length && <p className="welcome-sub">{search ? 'No documents match your search.' : 'Your first draft starts here.'}</p>}
      </aside>
      <section className="doc-editor">{current ? <>
        <input className="doc-title" value={title} onChange={event => { setTitle(event.target.value); latest.current.title = event.target.value; scheduleSave(); }} placeholder="Document title" readOnly={!canEdit} aria-label="Document title"/>
        <div className="doc-toolbar">
          <span className="zy-doc-status">
            <i className={`zy-save-dot ${saveState}`}/>{saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved changes' : saveState === 'error' ? 'Save failed — retry' : `Saved ${timeAgo(current.updated)}`}
            {collab ? <em className="zy-live">{peers.length ? 'Live' : 'Live · only you'}</em> : <em className="zy-live off">Local editing</em>}
            {current.visibility === 'private' && <em><Lock size={10}/> Private</em>}
            {peers.length > 0 && <span className="zy-peers">{peers.slice(0, 5).map((p, i) => <i key={i} style={{ background: p.color }} title={`${p.name} is editing`}>{p.name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase()}</i>)}</span>}
          </span>
          <button className="text-button" onClick={() => setFocus(f => !f)} title="Focus mode (Esc to exit)">{focus ? <><Minimize2 size={14}/> Exit focus</> : <><Maximize2 size={14}/> Focus</>}</button>
          <button className="text-button" onClick={() => setCommentsOpen(o => !o)}><MessageSquare size={14}/> Comments{current.commentCount ? ` · ${current.commentCount}` : ''}</button>
          <button className="text-button" onClick={openHistory}><History size={14}/> History</button>
          <NavLink className="text-button" to={`/ai?doc=${current.id}&prompt=${encodeURIComponent(`Summarise “${current.title}”, then list open questions and suggested next steps.`)}`} title="Ask Zynckle AI about this document"><Sparkles size={14}/> Ask AI</NavLink>
          {canEdit && <button className="text-button" onClick={() => persist(true)}><Save size={14}/> Save revision</button>}
          <div className="zy-menu-wrap"><button className="icon-button" aria-label="More document actions" onClick={() => setMenu(m => !m)}><MoreHorizontal size={16}/></button>
            {menu && <div className="zy-dropdown right" onMouseLeave={() => setMenu(false)}>
              {canShare && <button onClick={() => { setSharing(true); setMenu(false); }}><Share2 size={13}/> Share & access</button>}
              {canEdit && <label>Folder<select value={current.folderId || ''} onChange={e => patch({ folderId: e.target.value || null }, 'Moved')}><option value="">Unfiled</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
              {canEdit && <label>Project<select value={current.projectId || ''} onChange={e => patch({ projectId: e.target.value || null }, 'Project linked')}><option value="">None</option>{projects.filter(p => typeof p.id === 'string').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
              {localOnly && <button onClick={() => { setLocalOnly(false); setEditorSeed(s => s + 1); setMenu(false); }}><RotateCcw size={13}/> Reconnect live editing</button>}
              {canEdit && <button className="danger" onClick={remove}><Trash2 size={13}/> Delete document</button>}
              <small>Owner: {current.owner}</small>
            </div>}
          </div>
        </div>
        <Suspense fallback={<div className="rich-text-loading" aria-label="Loading editor"/>}>
          <RichTextEditor key={`${active}-${editorSeed}-${localOnly ? 'local' : 'live'}`} value={body} collab={collab} editable={canEdit}
            onChange={html => { latest.current.body = html; setBody(html); scheduleSave(); }}
            onPeers={setPeers} onSelectionText={setSelection}
            onFallback={() => { setLocalOnly(true); notify('Live collaboration is unavailable — editing locally; changes still save'); }}/>
        </Suspense>
      </> : <div className="doc-empty"><BookOpen/><h2>A space for the thinking.</h2><p>Create a document to capture the ideas behind your work.</p>{canEdit && <button className="button-secondary" onClick={() => create()}><Plus size={14}/> Start a document</button>}</div>}</section>
      {commentsOpen && current && <aside className="zy-comments" aria-label="Document comments">
        <header><div><div className="eyebrow">DISCUSSION</div><strong>Comments</strong></div><button className="icon-button" onClick={() => setCommentsOpen(false)} aria-label="Close comments"><X size={15}/></button></header>
        <label className="zy-check inline"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}/> Show resolved</label>
        <div className="zy-comment-list">
          {comments.filter(c => showResolved || !c.resolved).map(c => <article key={c.id} className={c.resolved ? 'resolved' : ''}>
            <div className="zy-comment-head"><span className="avatar avatar-self">{c.author.avatar}</span><strong>{c.author.name}</strong><time>{timeAgo(c.createdAt)}</time></div>
            {c.quote && <blockquote>“{c.quote}”</blockquote>}
            <p>{c.body}</p>
            <div className="zy-comment-actions">{canEdit && <button onClick={() => resolve(c)}>{c.resolved ? <><RotateCcw size={11}/> Reopen</> : <><CheckCheck size={11}/> Resolve</>}</button>}{c.mine && <button className="danger" onClick={() => deleteComment(c)}><Trash2 size={11}/> Delete</button>}</div>
          </article>)}
          {!comments.filter(c => showResolved || !c.resolved).length && <p className="zy-muted-note">No open comments. Select text in the document to quote it in a comment. Use @name to mention a teammate.</p>}
        </div>
        {canEdit && <form onSubmit={addComment} className="zy-comment-form">
          {selection && <div className="zy-quote-chip">“{selection.slice(0, 120)}{selection.length > 120 ? '…' : ''}”<button type="button" onClick={() => setSelection('')} aria-label="Remove quote"><X size={11}/></button></div>}
          <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)} rows={3} maxLength={4000} placeholder="Add a comment… use @name to mention" aria-label="New comment"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(e); }}/>
          <button className="button-primary" disabled={!commentBody.trim()}><Check size={13}/> Comment</button>
        </form>}
      </aside>}
    </div>
    {historyOpen && <div className="doc-history-backdrop" onMouseDown={event => event.target === event.currentTarget && setHistoryOpen(false)}><section className="doc-history-panel" role="dialog" aria-modal="true" aria-labelledby="doc-history-title"><header><div><div className="eyebrow">SAVED SNAPSHOTS</div><h2 id="doc-history-title">Version history</h2><p>Restoring a snapshot replaces the current content for everyone and saves it as a new revision.</p></div><button className="icon-button" aria-label="Close version history" onClick={() => setHistoryOpen(false)}><X size={17}/></button></header>{historyBusy ? <div className="doc-history-empty">Loading saved versions…</div> : historyError ? <div className="doc-history-empty" role="alert">{historyError}</div> : versions.length ? <div className="doc-history-list">{versions.map(version => <article key={version.id}><div className="doc-history-meta"><strong>Version {version.number}</strong><time>{new Date(version.createdAt).toLocaleString()} · {version.author}</time></div><p>{version.title}</p><small>{version.content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Empty document'}</small>{canEdit && <button className="button-secondary" onClick={() => restore(version)}>Restore this version</button>}</article>)}</div> : <div className="doc-history-empty"><History size={20}/><h3>No saved history yet</h3><p>Save an edit to create your first revision.</p></div>}</section></div>}
    {sharing && current && <ShareDialog documentId={current.id} canEdit={canEdit} title={current.title} visibility={current.visibility} shared={current.collaboratorIds || []} ownerId={current.ownerId} onClose={() => setSharing(false)} onSave={async v => { await patch({ visibility: v.visibility, collaboratorIds: v.shared }, 'Access updated'); }}/>}
  </>;
}
