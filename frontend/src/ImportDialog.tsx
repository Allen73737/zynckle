import { useRef, useState } from 'react';
import { FileUp, LoaderCircle, Upload, X } from 'lucide-react';
import { api, errorMessage } from './lib/api';

const SOURCES = [
  { name: 'Notion', how: 'Database ⋯ menu → Export → Markdown & CSV' },
  { name: 'Trello', how: 'Board menu → Print, export and share → Export as CSV' },
  { name: 'Linear', how: 'Settings → Import / export → Export CSV' },
  { name: 'Asana', how: 'Project ▾ menu → Export/Print → CSV' },
];

/** Import tasks into a project from a CSV export. Columns are matched by name on the server. */
export default function ImportDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string; rows: number; header: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    setError(''); setResult(null);
    if (!f) return;
    if (f.size > 2_000_000) { setError('That file is larger than 2 MB. Split it into smaller exports.'); return; }
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const header = (lines[0] || '').split(',').map(h => h.replace(/^"|"$/g, '').trim()).filter(Boolean).slice(0, 8);
    setFile({ name: f.name, text, rows: Math.max(0, lines.length - 1), header });
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ created: number; skipped: number }>(`/api/projects/${projectId}/import`, { method: 'POST', raw: file.text, headers: { 'Content-Type': 'text/csv' } });
      setResult(r);
      window.dispatchEvent(new CustomEvent('zynckle:workspace-changed'));
    } catch (e) { setError(errorMessage(e, 'The file could not be imported')); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="modal zy-import" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="modal-head"><div><div className="eyebrow">IMPORT TASKS</div><h2 id="import-title">Into {projectName}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      <p className="zy-muted-note">Upload a CSV with a <b>Title</b> (or Name / Task) column. Description, Status, Priority, Due date and Assignee columns are picked up when present. Assignees are matched to members by email or name.</p>
      <ul className="zy-import-sources">{SOURCES.map(s => <li key={s.name}><strong>{s.name}</strong><small>{s.how}</small></li>)}</ul>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => pick(e.target.files?.[0])}/>
      <button type="button" className="zy-import-drop" onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
        <FileUp size={20}/>{file ? <span><strong>{file.name}</strong><small>{file.rows} row{file.rows === 1 ? '' : 's'} · columns: {file.header.join(', ') || 'none found'}</small></span> : <span><strong>Choose a CSV file</strong><small>or drop it here · up to 500 tasks</small></span>}
      </button>
      {result && <p className="zy-auth-info" role="status">Imported {result.created} task{result.created === 1 ? '' : 's'}{result.skipped ? `, skipped ${result.skipped} (no title, or over the 500 limit)` : ''}.</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button-secondary" onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>{!result && <button className="button-primary" onClick={submit} disabled={!file || busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Upload size={14}/>} Import tasks</button>}</div>
    </div>
  </div>;
}
