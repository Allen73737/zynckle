import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Download, FileArchive, FileCode2, FileImage, FileText, FileVideo, Folder, FolderInput, FolderPlus, HardDrive, Lock, Pencil, Plus, Search, Share2, Trash2, UploadCloud, X } from 'lucide-react';
import ShareDialog from './components/ShareDialog';
import { api, errorMessage, formatBytes, timeAgo, uploadWithProgress } from './lib/api';
import { useRealtimeEvent } from './lib/realtime';
import './drive-preview.css';

type DriveFile = { id: string; name: string; sizeBytes: number; createdAt: string; mimeType?: string; folderId?: string | null; ownerId: string; owner: string; visibility: 'workspace' | 'private'; sharedWith: string[] };
type DriveFolder = { id: string; name: string; parentId: string | null; createdAt: string };
type Usage = { usedBytes: number; quotaBytes: number; fileCount: number; byType: Record<string, number>; driver: string; maxUploadBytes: number };
type Active = { file: DriveFile; content?: string; url?: string };
type Upload = { name: string; progress: number; error?: string };

const iconFor = (file: DriveFile) => {
  const mime = file.mimeType || '';
  if (mime.startsWith('image/')) return <FileImage size={17}/>;
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return <FileVideo size={17}/>;
  if (/zip|tar|7z|gzip/.test(mime)) return <FileArchive size={17}/>;
  if (/\.(js|jsx|ts|tsx|py|java|c|cpp|go|php|rs|rb|kt|cs|html|css|sql|json|ya?ml|xml|sh)$/i.test(file.name)) return <FileCode2 size={17}/>;
  return <FileText size={17}/>;
};

export default function DriveStudio({ notify, canEdit, isAdmin, accountId, onUsage }: { token: string; notify: (message: string) => void; canEdit: boolean; isAdmin: boolean; accountId?: string; onUsage?: (usage: Usage) => void }) {
  const [params, setParams] = useSearchParams();
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Active | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sharing, setSharing] = useState<DriveFile | null>(null);
  const [moving, setMoving] = useState<DriveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refreshUsage = () => api<Usage>('/api/storage/usage').then(u => { setUsage(u); onUsage?.(u); }).catch(() => {});
  const load = async () => {
    const [fileData, folderData] = await Promise.all([api<DriveFile[]>('/api/files'), api<DriveFolder[]>('/api/folders')]);
    setFiles(fileData); setFolders(folderData);
    return fileData;
  };
  useEffect(() => {
    load().then(list => { const wanted = list.find(f => f.id === params.get('file')); if (wanted) { setCurrentFolder(wanted.folderId || null); open(wanted); } }).catch(e => { setError(errorMessage(e, 'Files could not be loaded')); setFiles([]); });
    refreshUsage();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeEvent('file.changed', (file: DriveFile) => setFiles(list => list ? (list.some(f => f.id === file.id) ? list.map(f => f.id === file.id ? { ...f, ...file } : f) : [file, ...list]) : list));
  useRealtimeEvent('file.deleted', ({ id }: { id: string }) => { setFiles(list => list?.filter(f => f.id !== id) || list); if (active?.file.id === id) setActive(null); });

  const searching = query.trim().length > 0;
  const visible = useMemo(() => (files || []).filter(file => searching ? file.name.toLowerCase().includes(query.trim().toLowerCase()) : (file.folderId || null) === currentFolder), [files, query, currentFolder, searching]);
  const childFolders = useMemo(() => searching ? [] : folders.filter(folder => (folder.parentId || null) === currentFolder).sort((a, b) => a.name.localeCompare(b.name)), [folders, currentFolder, searching]);
  const breadcrumbs = useMemo(() => { const result: DriveFolder[] = []; let folder = folders.find(item => item.id === currentFolder); let guard = 0; while (folder && guard++ < 25) { result.unshift(folder); folder = folders.find(item => item.id === folder?.parentId); } return result; }, [folders, currentFolder]);
  const folderOptions = useMemo(() => flattenFolders(folders), [folders]);
  const fileCount = (folderId: string) => (files || []).filter(f => f.folderId === folderId).length + folders.filter(f => f.parentId === folderId).length;

  const createFolder = async () => {
    const name = window.prompt('Folder name')?.trim(); if (!name) return;
    try { const data = await api<DriveFolder>('/api/folders', { body: { name, parentId: currentFolder } }); setFolders(current => [...current, data]); notify('Folder created'); }
    catch (e) { setError(errorMessage(e, 'Folder could not be created')); }
  };
  const renameFolder = async (folder: DriveFolder) => {
    const name = window.prompt('Rename folder', folder.name)?.trim(); if (!name || name === folder.name) return;
    try { const data = await api<DriveFolder>(`/api/folders/${folder.id}`, { method: 'PATCH', body: { name } }); setFolders(current => current.map(item => item.id === folder.id ? data : item)); notify('Folder renamed'); }
    catch (e) { setError(errorMessage(e, 'Folder could not be renamed')); }
  };
  const deleteFolder = async (folder: DriveFolder) => {
    if (!window.confirm(`Delete “${folder.name}”? Its files and subfolders will move up one level.`)) return;
    try { await api(`/api/folders/${folder.id}`, { method: 'DELETE' }); if (currentFolder === folder.id) setCurrentFolder(folder.parentId || null); await load(); notify('Folder deleted; its contents were kept'); }
    catch (e) { setError(errorMessage(e, 'Folder could not be deleted')); }
  };
  const moveFile = async (file: DriveFile, folderId: string | null) => {
    try { const data = await api<DriveFile>(`/api/files/${file.id}`, { method: 'PATCH', body: { folderId } }); setFiles(current => current?.map(item => item.id === file.id ? { ...item, ...data } : item) || current); setMoving(null); notify('File moved'); }
    catch (e) { setError(errorMessage(e, 'File could not be moved')); }
  };

  const upload = async (list: FileList | File[] | null) => {
    const items = Array.from(list || []);
    if (!items.length) return;
    setError('');
    const max = usage?.maxUploadBytes || 25 * 1048576;
    setUploads(items.map(f => ({ name: f.name, progress: 0, error: f.size > max ? `Larger than ${formatBytes(max)}` : undefined })));
    let ok = 0;
    for (const [index, file] of items.entries()) {
      if (file.size > max) continue;
      try {
        const saved = await uploadWithProgress<DriveFile>('/api/files/upload', file, { 'x-file-name': encodeURIComponent(file.name), ...(currentFolder ? { 'x-folder-id': currentFolder } : {}) }, p => setUploads(u => u.map((x, i) => i === index ? { ...x, progress: p } : x)));
        setFiles(current => current?.some(f => f.id === saved.id) ? current : [saved, ...(current || [])]);
        setUploads(u => u.map((x, i) => i === index ? { ...x, progress: 1 } : x));
        ok++;
      } catch (e) { setUploads(u => u.map((x, i) => i === index ? { ...x, error: errorMessage(e) } : x)); }
    }
    if (ok) notify(`${ok} file${ok === 1 ? '' : 's'} uploaded`);
    refreshUsage();
    window.setTimeout(() => setUploads(u => u.filter(x => x.error)), 2200);
    if (input.current) input.current.value = '';
  };

  const open = async (file: DriveFile) => {
    setPreviewLoading(true); setActive({ file });
    setParams(p => { const n = new URLSearchParams(p); n.set('file', file.id); return n; }, { replace: true });
    try { const data = await api<{ content?: string; url?: string }>(`/api/files/${file.id}`); setActive({ file, content: data.content, url: data.url }); }
    catch (e) { setError(errorMessage(e, 'File could not be opened')); }
    finally { setPreviewLoading(false); }
  };
  const download = async (file: DriveFile) => {
    try { const blob = await api<Blob>(`/api/files/${file.id}/download`); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError(errorMessage(e, 'Download failed')); }
  };
  const rename = async (file: DriveFile) => {
    const name = window.prompt('New file name', file.name)?.trim();
    if (!name || name === file.name) return;
    try { const data = await api<DriveFile>(`/api/files/${file.id}`, { method: 'PATCH', body: { name } }); setFiles(current => current?.map(item => item.id === file.id ? { ...item, ...data } : item) || current); if (active?.file.id === file.id) setActive({ ...active, file: { ...active.file, name: data.name } }); notify('File renamed'); }
    catch (e) { setError(errorMessage(e, 'Rename failed')); }
  };
  const remove = async (file: DriveFile) => {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    try { await api(`/api/files/${file.id}`, { method: 'DELETE' }); setFiles(current => current?.filter(item => item.id !== file.id) || current); if (active?.file.id === file.id) setActive(null); notify('File deleted'); refreshUsage(); }
    catch (e) { setError(errorMessage(e, 'Delete failed')); }
  };
  const canManage = (file: DriveFile) => file.ownerId === accountId || isAdmin;
  const mime = active?.file.mimeType || '';
  const usedShare = usage ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100) : 0;

  return <div onDragEnter={e => { if (canEdit && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragOver={e => { if (dragging) e.preventDefault(); }} onDragLeave={e => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); if (canEdit) upload(e.dataTransfer.files); }} className="zy-drive-root">
    <section className="welcome-row subpage-welcome"><div><div className="eyebrow">ZYNCKLE DRIVE · WORKSPACE FILES</div><h1>Your files, <em>in reach.</em></h1><p className="welcome-sub">Upload documents, media, archives and source files. Previews use short-lived signed links; nothing uploaded is ever executed.</p></div>
      <div className="zy-head-actions">{canEdit && <button className="button-secondary" onClick={createFolder}><FolderPlus size={15}/> New folder</button>}<button className="button-primary" onClick={() => input.current?.click()} disabled={!canEdit || uploads.some(u => u.progress < 1 && !u.error)}><Plus size={16}/>Upload files</button></div>
      <input ref={input} type="file" multiple hidden onChange={e => upload(e.target.files)}/></section>
    {error && <div className="zy-inline-error" role="alert"><X size={13}/>{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
    {usage && <div className="zy-usage"><div><span>{formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} used</span><span>{usage.fileCount} files · {usage.driver === 's3' ? 'Cloud object storage' : 'Local disk storage'} · up to {formatBytes(usage.maxUploadBytes)} per file</span></div><i><b style={{ width: `${usedShare}%` }} className={usedShare > 90 ? 'full' : ''}/></i>{Object.keys(usage.byType).length > 0 && <ul>{Object.entries(usage.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}>{k}<em>{formatBytes(v)}</em></li>)}</ul>}</div>}
    <div className="drive-toolbar">
      <nav className="zy-crumbs" aria-label="Folder path"><button onClick={() => { setCurrentFolder(null); setQuery(''); }} className={!currentFolder && !searching ? 'current' : ''}><HardDrive size={13}/> Drive</button>{breadcrumbs.map(f => <span key={f.id}><ChevronRight size={12}/><button onClick={() => setCurrentFolder(f.id)} className={f.id === currentFolder ? 'current' : ''}>{f.name}</button></span>)}{searching && <span><ChevronRight size={12}/><em>Search results</em></span>}</nav>
      <div className="drive-search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search all files" aria-label="Search files"/>{query && <button className="tiny-icon" onClick={() => setQuery('')} aria-label="Clear search"><X size={12}/></button>}</div>
    </div>
    {uploads.length > 0 && <div className="zy-upload-list" role="status">{uploads.map((u, i) => <div key={i} className={u.error ? 'failed' : u.progress >= 1 ? 'done' : ''}><span>{u.name}</span>{u.error ? <em>{u.error}</em> : <i><b style={{ width: `${Math.round(u.progress * 100)}%` }}/></i>}</div>)}</div>}
    <div className="drive-layout">
      <section className="drive-list">
        {files === null && <div className="zy-skeleton-rows"><i/><i/><i/></div>}
        {childFolders.map(folder => <article className="drive-row zy-folder-row" key={folder.id}><button className="drive-open" onClick={() => setCurrentFolder(folder.id)}><span className="drive-file-icon"><Folder size={17}/></span><span><strong>{folder.name}</strong><small>{fileCount(folder.id)} item{fileCount(folder.id) === 1 ? '' : 's'}</small></span></button>{canEdit && <div className="drive-actions"><button className="icon-button" aria-label={`Rename ${folder.name}`} title="Rename" onClick={() => renameFolder(folder)}><Pencil size={14}/></button><button className="icon-button danger" aria-label={`Delete ${folder.name}`} title="Delete folder" onClick={() => deleteFolder(folder)}><Trash2 size={14}/></button></div>}</article>)}
        {visible.map(file => <article className={`drive-row ${active?.file.id === file.id ? 'selected' : ''}`} key={file.id}><button className="drive-open" onClick={() => open(file)}><span className="drive-file-icon">{iconFor(file)}</span><span><strong>{file.visibility === 'private' && <Lock size={10}/>} {file.name}</strong><small>{formatBytes(file.sizeBytes)} · {timeAgo(file.createdAt)} · {file.owner}</small></span></button>
          <div className="drive-actions"><button className="icon-button" aria-label={`Download ${file.name}`} title="Download" onClick={() => download(file)}><Download size={15}/></button>
            {canEdit && <><button className="icon-button" aria-label={`Move ${file.name}`} title="Move to folder" onClick={() => setMoving(file)}><FolderInput size={14}/></button><button className="icon-button" aria-label={`Rename ${file.name}`} title="Rename" onClick={() => rename(file)}><Pencil size={14}/></button>
            {canManage(file) && <button className="icon-button" aria-label={`Share ${file.name}`} title="Share" onClick={() => setSharing(file)}><Share2 size={14}/></button>}
            <button className="icon-button danger" aria-label={`Delete ${file.name}`} title="Delete" onClick={() => remove(file)}><Trash2 size={15}/></button></>}</div></article>)}
        {files && !visible.length && !childFolders.length && <div className="drive-empty"><HardDrive size={25}/><h2>{query ? 'No files match that search' : currentFolder ? 'This folder is empty' : 'A little room for your files'}</h2><p>{query ? 'Try a different name.' : 'Drop files anywhere on this page, or use Upload.'}</p>{!query && canEdit && <button className="button-secondary" onClick={() => input.current?.click()}><Plus size={14}/> Add files</button>}</div>}
      </section>
      <section className="drive-preview">{active ? <>
        <div className="editor-head">{active.file.name}<span>{active.content !== undefined ? 'TEXT PREVIEW' : 'FILE PREVIEW'}</span></div>
        {previewLoading ? <div className="zy-skeleton-code"><i/><i/><i/></div>
          : active.url && mime === 'application/pdf' ? <iframe className="drive-pdf-preview" title={`${active.file.name} preview`} src={active.url}/>
          : active.url && mime.startsWith('image/') && mime !== 'image/svg+xml' ? <img className="drive-image-preview" src={active.url} alt={active.file.name}/>
          : active.url && mime.startsWith('video/') ? <video className="drive-video-preview" src={active.url} controls/>
          : active.url && mime.startsWith('audio/') ? <div className="drive-empty"><FileVideo size={24}/><audio src={active.url} controls/></div>
          : active.content !== undefined ? <pre>{active.content || '(empty file)'}</pre>
          : <div className="drive-empty"><FileText size={24}/><h2>Preview unavailable</h2><p>{/officedocument|msword|ms-excel|powerpoint/.test(mime) ? 'Office files are stored safely. Download to open them in Word, Excel or PowerPoint.' : 'This file is stored safely. Download it to open it in a compatible app.'}</p><button className="button-secondary" onClick={() => download(active.file)}><Download size={14}/> Download file</button></div>}
        <dl className="zy-file-facts"><div><dt>Size</dt><dd>{formatBytes(active.file.sizeBytes)}</dd></div><div><dt>Type</dt><dd>{mime || 'unknown'}</dd></div><div><dt>Owner</dt><dd>{active.file.owner}</dd></div><div><dt>Access</dt><dd>{active.file.visibility === 'private' ? `Private · ${active.file.sharedWith?.length || 0} shared` : 'Workspace'}</dd></div></dl>
      </> : <div className="drive-empty"><FileText size={24}/><h2>Choose a file to preview</h2><p>Text, images, PDF, audio and video can be previewed here.</p></div>}</section>
    </div>
    {dragging && <div className="zy-dropzone" aria-hidden="true"><UploadCloud size={30}/><strong>Drop to upload{breadcrumbs.length ? ` into ${breadcrumbs[breadcrumbs.length - 1].name}` : ''}</strong><span>Up to {formatBytes(usage?.maxUploadBytes || 25 * 1048576)} per file</span></div>}
    {moving && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setMoving(null)}><section className="modal" role="dialog" aria-modal="true"><div className="modal-head"><div><div className="eyebrow">MOVE FILE</div><h2>{moving.name}</h2></div><button className="icon-button" onClick={() => setMoving(null)} aria-label="Close"><X size={18}/></button></div>
      <div className="zy-move-list"><button className={!moving.folderId ? 'current' : ''} onClick={() => moveFile(moving, null)}><HardDrive size={14}/> Drive (top level)</button>{folderOptions.map(f => <button key={f.id} className={moving.folderId === f.id ? 'current' : ''} style={{ paddingLeft: 12 + f.depth * 16 }} onClick={() => moveFile(moving, f.id)}><Folder size={14}/> {f.name}</button>)}</div></section></div>}
    {sharing && <ShareDialog title={sharing.name} visibility={sharing.visibility} shared={sharing.sharedWith || []} ownerId={sharing.ownerId} onClose={() => setSharing(null)} onSave={async v => { const data = await api<DriveFile>(`/api/files/${sharing.id}`, { method: 'PATCH', body: { visibility: v.visibility, sharedWith: v.shared } }); setFiles(list => list?.map(f => f.id === data.id ? { ...f, ...data } : f) || list); notify('Access updated'); }}/>}
  </div>;
}

function flattenFolders(folders: DriveFolder[], parentId: string | null = null, depth = 0): (DriveFolder & { depth: number })[] {
  return folders.filter(f => (f.parentId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name)).flatMap(f => [{ ...f, depth }, ...flattenFolders(folders, f.id, depth + 1)]);
}
