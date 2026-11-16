import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, Code2, Copy, Download, ExternalLink, FileCode2, FileText, Folder, FolderOpen, GitBranch, History, LoaderCircle, Lock, Pencil, Plus, Search, Share2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import ShareDialog from './components/ShareDialog';
import { api, errorMessage, formatBytes, timeAgo, uploadWithProgress } from './lib/api';

const CodePreview = lazy(() => import('./CodePreview'));

type CodeProject = { id: string; name: string; description: string; ownerId: string; owner: string; fileCount: number; sizeBytes: number; languages: Record<string, number>; hasSite: boolean; visibility: 'workspace' | 'private'; sharedWith: string[]; repoUrl?: string; updatedAt: string; projectId: string | null };
type CodeFile = { id: string; path: string; language: string; sizeBytes: number; binary: boolean; updatedAt: string; versionCount: number };
type Tree = { name: string; path: string; children: Map<string, Tree>; file?: CodeFile };

const topLanguages = (languages: Record<string, number>) => {
  const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, size]) => ({ name, share: Math.round((size / total) * 100) }));
};

export default function CodeStudio({ notify, canEdit, projects }: { notify: (message: string) => void; canEdit: boolean; projects: { id: string | number; name: string }[] }) {
  const { id } = useParams();
  return id ? <CodeRepository key={id} id={id} notify={notify} canEdit={canEdit}/> : <CodeProjects notify={notify} canEdit={canEdit} projects={projects}/>;
}

function CodeProjects({ notify, canEdit, projects }: { notify: (message: string) => void; canEdit: boolean; projects: { id: string | number; name: string }[] }) {
  const [items, setItems] = useState<CodeProject[] | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'new' | 'github' | null>(null);
  const navigate = useNavigate();
  useEffect(() => { api<CodeProject[]>('/api/code-projects').then(setItems).catch(e => { setError(errorMessage(e)); setItems([]); }); }, []);
  return <>
    <section className="welcome-row subpage-welcome"><div><div className="eyebrow">ZYNCKLE CODE · SOURCE LIBRARY</div><h1>Code, <em>in context.</em></h1><p className="welcome-sub">Store, browse and share source code beside your projects. Files are displayed read-only and never executed.</p></div>
      <div className="zy-head-actions"><button className="button-secondary" onClick={() => setDialog('github')} disabled={!canEdit}><GitBranch size={15}/> Import from GitHub</button><button className="button-primary" onClick={() => setDialog('new')} disabled={!canEdit}><Plus size={16}/> New code project</button></div></section>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-heading"><div><div className="eyebrow">{items?.length ?? '—'} CODE PROJECTS</div><h2>Repositories</h2></div></div>
    <div className="project-list full-project-list">
      {items === null && <div className="zy-skeleton-rows"><i/><i/><i/></div>}
      {items?.map(p => <NavLink key={p.id} to={`/code/${p.id}`} className="project-row">
        <div className="project-art sage"><span>{p.name.slice(0, 1)}</span><i className="art-orbit"/><i className="art-dot"/></div>
        <div className="project-info"><div className="project-title-line"><h3>{p.name}</h3>{p.visibility === 'private' && <span className="status"><Lock size={9}/> Private</span>}{p.repoUrl && <span className="status"><GitBranch size={9}/> GitHub import</span>}</div>
          <p>{p.description || 'No description yet.'}</p>
          <div className="project-meta"><span>{p.fileCount} files</span><span className="meta-divider"/><span>{formatBytes(p.sizeBytes)}</span><span className="meta-divider"/><span>Updated {timeAgo(p.updatedAt)}</span>{topLanguages(p.languages).length > 0 && <><span className="meta-divider"/><span className="zy-langs">{topLanguages(p.languages).map(l => <em key={l.name}>{l.name} {l.share}%</em>)}</span></>}</div></div>
        <ArrowRight size={15} className="dashboard-project-arrow"/></NavLink>)}
      {items?.length === 0 && <div className="empty-state"><Code2 size={23}/><h3>Your code library starts here</h3><p>Create a code project and upload files or a ZIP, or import a public GitHub repository.</p>{canEdit && <div className="zy-head-actions"><button className="button-secondary" onClick={() => setDialog('github')}><GitBranch size={14}/> Import from GitHub</button><button className="button-primary" onClick={() => setDialog('new')}><Plus size={14}/> New code project</button></div>}</div>}
    </div>
    {dialog === 'new' && <NewCodeProject projects={projects} onClose={() => setDialog(null)} onCreated={p => { notify('Code project created'); navigate(`/code/${p.id}`); }}/>}
    {dialog === 'github' && <GithubImport onClose={() => setDialog(null)} onImported={(p, count) => { notify(`Imported ${count} files from GitHub`); navigate(`/code/${p.id}`); }}/>}
  </>;
}

function NewCodeProject({ projects, onClose, onCreated }: { projects: { id: string | number; name: string }[]; onClose: () => void; onCreated: (p: CodeProject) => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [projectId, setProjectId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { onCreated(await api<CodeProject>('/api/code-projects', { body: { name, description, projectId: projectId || undefined } })); } catch (x) { setError(errorMessage(x)); setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><div className="eyebrow">ZYNCKLE CODE</div><h2>New code project</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
    <label>Name<input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. checkout-service"/></label>
    <label>Description <span className="optional">OPTIONAL</span><textarea rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} placeholder="What lives in this repository?"/></label>
    <label>Linked project <span className="optional">OPTIONAL</span><select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">None</option>{projects.filter(p => typeof p.id === 'string').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {error && <p className="auth-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || !name.trim()}><Plus size={14}/> Create</button></div>
  </form></div>;
}

function GithubImport({ onClose, onImported }: { onClose: () => void; onImported: (p: CodeProject, count: number) => void }) {
  const [url, setUrl] = useState(''); const [branch, setBranch] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await api<{ project: CodeProject; added: number }>('/api/code-projects/import-github', { body: { url, branch: branch || undefined } }); onImported(r.project, r.added); } catch (x) { setError(errorMessage(x)); setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><div className="eyebrow">GITHUB · PUBLIC REPOSITORIES</div><h2>Import a repository</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18}/></button></div>
    <p>Zynckle downloads the repository archive from GitHub and imports text files up to 1 MB each. Archives are validated; nothing is executed.</p>
    <label>Repository URL<input autoFocus required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/owner/repository"/></label>
    <label>Branch <span className="optional">DEFAULT BRANCH IF EMPTY</span><input value={branch} onChange={e => setBranch(e.target.value)} placeholder="main"/></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button-primary" disabled={busy || !url.trim()}>{busy ? <><LoaderCircle className="spin" size={14}/> Importing…</> : <><GitBranch size={14}/> Import</>}</button></div>
  </form></div>;
}

function buildTree(files: CodeFile[]) {
  const root: Tree = { name: '', path: '', children: new Map() };
  for (const file of files) {
    let node = root;
    const parts = file.path.split('/');
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() });
      node = node.children.get(part)!;
      if (index === parts.length - 1) node.file = file;
    });
  }
  return root;
}

function CodeRepository({ id, notify, canEdit }: { id: string; notify: (message: string) => void; canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<CodeProject | null>(null);
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ file: CodeFile; content: string | null; version: number | null } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [line, setLine] = useState<number | undefined>();
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState<{ fileId: string; path: string; matches: { line: number; text: string }[] }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [upload, setUpload] = useState<{ label: string; progress: number } | null>(null);
  const [versions, setVersions] = useState<{ index: number | null; current: boolean; sizeBytes: number; updatedAt: string; author: string }[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [meta, setMeta] = useState({ name: '', description: '' });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [p, f] = await Promise.all([api<CodeProject>(`/api/code-projects/${id}`), api<CodeFile[]>(`/api/code-projects/${id}/files`)]);
    setProject(p); setFiles(f); setMeta({ name: p.name, description: p.description });
    return f;
  };
  useEffect(() => {
    load().then(list => {
      const wanted = params.get('file');
      const first = list.find(f => f.id === wanted) || list.find(f => /(^|\/)readme\.md$/i.test(f.path)) || list[0];
      if (first) openFile(first);
      setOpen(new Set(list.length < 40 ? list.flatMap(f => f.path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))) : []));
    }).catch(e => setError(errorMessage(e)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = async (file: CodeFile, atLine?: number, version: number | null = null) => {
    setLoadingFile(true); setLine(atLine); setVersions(null);
    setParams(current => { const next = new URLSearchParams(current); next.set('file', file.id); return next; }, { replace: true });
    const parts = file.path.split('/');
    setOpen(current => new Set([...current, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))]));
    try { const data = await api<{ content: string | null }>(`/api/code-files/${file.id}${version !== null ? `?version=${version}` : ''}`); setActive({ file, content: data.content, version }); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoadingFile(false); }
  };

  // Debounced server-side content search.
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 2) { setSearch(null); return; }
    setSearching(true);
    const timer = window.setTimeout(() => { api<{ results: { fileId: string; path: string; matches: { line: number; text: string }[] }[] }>(`/api/code-projects/${id}/search?q=${encodeURIComponent(q)}`).then(r => setSearch(r.results)).catch(() => setSearch([])).finally(() => setSearching(false)); }, 280);
    return () => window.clearTimeout(timer);
  }, [filter, id]);

  const tree = useMemo(() => buildTree(files), [files]);

  const uploadFiles = async (list: FileList | null, folder = false) => {
    if (!list?.length) return;
    const items = Array.from(list).filter(f => !/(^|\/)(node_modules|\.git|dist|build|target|__pycache__)\//.test((f as File & { webkitRelativePath: string }).webkitRelativePath || ''));
    let done = 0; let failed = 0;
    for (const file of items) {
      const relative = (file as File & { webkitRelativePath: string }).webkitRelativePath;
      const path = folder && relative ? relative.split('/').slice(1).join('/') : file.name;
      setUpload({ label: `Uploading ${done + 1} of ${items.length}`, progress: done / items.length });
      try {
        if (file.size > 1_000_000) throw new Error('too large');
        await uploadWithProgress(`/api/code-projects/${id}/files`, file, { 'x-file-path': encodeURIComponent(path) });
      } catch { failed++; }
      done++;
    }
    setUpload(null);
    await load();
    notify(failed ? `${done - failed} files uploaded · ${failed} skipped (over 1 MB or invalid)` : `${done} files uploaded`);
  };

  const uploadZip = async (file: File | undefined) => {
    if (!file) return;
    setUpload({ label: `Uploading ${file.name}`, progress: 0 });
    try {
      const result = await uploadWithProgress<{ added: number; replaced: number; skipped: { name: string; reason: string }[] }>(`/api/code-projects/${id}/zip`, file, {}, p => setUpload({ label: p < 1 ? `Uploading ${file.name}` : 'Extracting safely…', progress: p }));
      await load();
      notify(`${result.added} added · ${result.replaced} updated${result.skipped.length ? ` · ${result.skipped.length} skipped` : ''}`);
      if (result.skipped.length) setError(`Skipped: ${result.skipped.slice(0, 6).map(s => `${s.name} (${s.reason})`).join(', ')}${result.skipped.length > 6 ? '…' : ''}`);
    } catch (e) { setError(errorMessage(e)); }
    finally { setUpload(null); if (zipInput.current) zipInput.current.value = ''; }
  };

  const download = async (url: string, name: string) => {
    try { const blob = await api<Blob>(url); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(href), 800); }
    catch (e) { setError(errorMessage(e)); }
  };
  const previewSite = async () => { try { const r = await api<{ url: string }>(`/api/code-projects/${id}/site`); window.open(r.url, '_blank', 'noopener,noreferrer'); } catch (e) { setError(errorMessage(e)); } };
  const saveMeta = async (e: React.FormEvent) => { e.preventDefault(); try { setProject(await api<CodeProject>(`/api/code-projects/${id}`, { method: 'PATCH', body: meta })); setEditingMeta(false); notify('Details saved'); } catch (x) { setError(errorMessage(x)); } };
  const removeProject = async () => { if (!project || !window.confirm(`Delete ${project.name} and all ${project.fileCount} files? This cannot be undone.`)) return; try { await api(`/api/code-projects/${id}`, { method: 'DELETE' }); notify('Code project deleted'); navigate('/code'); } catch (e) { setError(errorMessage(e)); } };
  const removeFile = async (file: CodeFile) => { if (!window.confirm(`Delete ${file.path}?`)) return; try { await api(`/api/code-files/${file.id}`, { method: 'DELETE' }); setFiles(f => f.filter(x => x.id !== file.id)); if (active?.file.id === file.id) setActive(null); } catch (e) { setError(errorMessage(e)); } };
  const askAI = (mode: 'explain' | 'review') => { if (!active) return; navigate(`/ai?mode=${mode}&codeProject=${id}&codeFile=${active.file.id}&prompt=${encodeURIComponent(mode === 'explain' ? `What does ${active.file.path} do?` : `Review ${active.file.path} for bugs, security and maintainability.`)}`); };

  const renderNode = (node: Tree, depth: number): React.ReactNode => [...node.children.values()].sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map(child => child.file
    ? <button key={child.path} className={`zy-tree-file ${active?.file.id === child.file.id ? 'selected' : ''}`} style={{ paddingLeft: 10 + depth * 13 }} onClick={() => openFile(child.file!)} title={child.path}>{/\.(md|txt)$/i.test(child.name) ? <FileText size={13}/> : <FileCode2 size={13}/>}<span>{child.name}</span></button>
    : <div key={child.path}><button className="zy-tree-folder" style={{ paddingLeft: 8 + depth * 13 }} onClick={() => setOpen(o => { const n = new Set(o); if (n.has(child.path)) n.delete(child.path); else n.add(child.path); return n; })} aria-expanded={open.has(child.path)}>{open.has(child.path) ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}{open.has(child.path) ? <FolderOpen size={13}/> : <Folder size={13}/>}<span>{child.name}</span></button>{open.has(child.path) && renderNode(child, depth + 1)}</div>);

  if (error && !project) return <div className="empty-state"><Code2 size={23}/><h3>Code project unavailable</h3><p>{error}</p><NavLink className="button-secondary" to="/code">Back to code</NavLink></div>;
  return <>
    <div className="breadcrumb"><NavLink to="/code">Code</NavLink><span>/</span><span>{project?.name || '…'}</span></div>
    <section className="project-detail-head zy-code-head">
      <div className="project-art large sage"><span>{project?.name[0] || '·'}</span></div>
      {editingMeta ? <form className="zy-inline-form" onSubmit={saveMeta}><input value={meta.name} onChange={e => setMeta(m => ({ ...m, name: e.target.value }))} maxLength={100} required aria-label="Name"/><textarea value={meta.description} onChange={e => setMeta(m => ({ ...m, description: e.target.value }))} rows={2} maxLength={2000} aria-label="Description"/><div><button type="button" className="button-secondary" onClick={() => setEditingMeta(false)}>Cancel</button><button className="button-primary">Save</button></div></form>
        : <div><div className="eyebrow">CODE PROJECT · {project?.fileCount ?? 0} FILES · {formatBytes(project?.sizeBytes || 0)}{project?.visibility === 'private' ? ' · PRIVATE' : ''}</div><h1>{project?.name}</h1><p>{project?.description || 'No description yet.'}{project?.repoUrl && <> · <a className="zy-link" href={project.repoUrl} target="_blank" rel="noreferrer noopener">{project.repoUrl.replace('https://', '')}</a></>}</p></div>}
      <div className="zy-head-actions">
        {canEdit && <><button className="icon-button" title="Edit details" aria-label="Edit details" onClick={() => setEditingMeta(true)}><Pencil size={15}/></button><button className="icon-button" title="Share" aria-label="Share" onClick={() => setSharing(true)}><Share2 size={15}/></button></>}
        <button className="icon-button" title="Download ZIP" aria-label="Download as ZIP" onClick={() => project && download(`/api/code-projects/${id}/download`, `${project.name}.zip`)} disabled={!files.length}><Download size={15}/></button>
        {project?.hasSite && <button className="button-secondary" onClick={previewSite}><ExternalLink size={14}/> Preview site</button>}
        {canEdit && <div className="zy-menu-wrap"><button className="button-primary" onClick={() => fileInput.current?.click()}><Upload size={14}/> Upload</button>
          <div className="zy-split"><button onClick={() => folderInput.current?.click()}>Folder</button><button onClick={() => zipInput.current?.click()}>ZIP</button></div></div>}
        {canEdit && <button className="icon-button danger" title="Delete code project" aria-label="Delete code project" onClick={removeProject}><Trash2 size={15}/></button>}
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={e => { uploadFiles(e.target.files); e.target.value = ''; }}/>
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={e => { uploadFiles(e.target.files, true); e.target.value = ''; }}/>
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={e => uploadZip(e.target.files?.[0])}/>
    </section>
    {upload && <div className="zy-progress-line" role="status"><span>{upload.label}</span><i><b style={{ width: `${Math.round(upload.progress * 100)}%` }}/></i></div>}
    {error && project && <div className="zy-inline-error" role="alert"><X size={13}/>{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
    <div className="zy-repo">
      <aside className="zy-repo-tree">
        <label className="zy-search-field"><Search size={13}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search files and code" aria-label="Search files and code"/>{searching && <LoaderCircle size={12} className="spin"/>}</label>
        {search ? <div className="zy-search-results">
          <div className="eyebrow">{search.length} MATCHING FILES</div>
          {search.map(r => <div key={r.fileId} className="zy-search-hit"><button onClick={() => { const f = files.find(x => x.id === r.fileId); if (f) openFile(f, r.matches[0]?.line); }}><FileCode2 size={12}/>{r.path}</button>{r.matches.map(m => <button key={m.line} className="zy-search-line" onClick={() => { const f = files.find(x => x.id === r.fileId); if (f) openFile(f, m.line); }}><span>{m.line}</span><code>{m.text}</code></button>)}</div>)}
          {!search.length && !searching && <p className="zy-muted-note">No matches.</p>}
        </div> : <div className="zy-tree">{files.length ? renderNode(tree, 0) : <div className="drive-empty"><Code2 size={22}/><h2>An empty repository</h2><p>Upload files, a folder or a ZIP archive.</p></div>}</div>}
      </aside>
      <section className="code-view zy-repo-view">
        {active ? <>
          <div className="editor-head zy-file-head">
            <span className="zy-file-path">{active.file.path.split('/').map((part, i, all) => <span key={i}>{i > 0 && <em>/</em>}{i === all.length - 1 ? <strong>{part}</strong> : part}</span>)}</span>
            <span className="zy-file-tools">
              <span>{active.file.language} · {formatBytes(active.file.sizeBytes)}</span>
              {active.version !== null && <span className="zy-pill">Older version</span>}
              <button className="text-button" onClick={async () => setVersions(versions ? null : await api(`/api/code-files/${active.file.id}/versions`))}><History size={12}/> {active.file.versionCount + 1} version{active.file.versionCount ? 's' : ''}</button>
              {active.content !== null && <button className="text-button" onClick={() => { navigator.clipboard.writeText(active.content || ''); notify('Copied source'); }}><Copy size={12}/> Copy</button>}
              <button className="text-button" onClick={() => download(`/api/code-files/${active.file.id}/raw`, active.file.path.split('/').pop() || 'file')}><Download size={12}/> Download</button>
              {canEdit && <button className="text-button danger" onClick={() => removeFile(active.file)}><Trash2 size={12}/></button>}
            </span>
          </div>
          {versions && <div className="zy-versions">{versions.map(v => <button key={String(v.index)} className={(v.index ?? null) === active.version ? 'active' : ''} onClick={() => openFile(active.file, undefined, v.index)}><strong>{v.current ? 'Current' : `Version ${versions.length - 1 - (v.index ?? 0)}`}</strong><small>{formatBytes(v.sizeBytes)} · {v.author} · {timeAgo(v.updatedAt)}</small></button>)}</div>}
          {!active.file.binary && active.content !== null && <div className="zy-ai-actions"><Sparkles size={12}/><span>Zynckle AI</span><button onClick={() => askAI('explain')}><Code2 size={12}/> Explain this file</button><button onClick={() => askAI('review')}><ShieldCheck size={12}/> Review it</button></div>}
          {loadingFile ? <div className="zy-skeleton-code"><i/><i/><i/><i/><i/></div>
            : active.content === null ? <div className="doc-empty"><FileCode2/><h2>Binary file</h2><p>This file can be downloaded but not displayed as text.</p></div>
            : <Suspense fallback={<div className="zy-skeleton-code"><i/><i/><i/></div>}><CodePreview name={active.file.path} content={active.content} lineNumbers highlightLine={line}/></Suspense>}
        </> : <div className="doc-empty"><FileCode2/><h2>Choose a file</h2><p>Select a file from the tree to read it with syntax highlighting.</p></div>}
      </section>
    </div>
    {sharing && project && <ShareDialog title={project.name} visibility={project.visibility} shared={project.sharedWith || []} ownerId={project.ownerId} onClose={() => setSharing(false)} onSave={async v => { setProject(await api<CodeProject>(`/api/code-projects/${id}`, { method: 'PATCH', body: { visibility: v.visibility, sharedWith: v.shared } })); notify('Access updated'); }}/>}
  </>;
}
