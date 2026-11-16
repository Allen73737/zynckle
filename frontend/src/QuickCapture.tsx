import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Calendar, Columns3, Flag, FolderKanban, User, X, Zap } from 'lucide-react';
import { api, errorMessage, type Member } from './lib/api';
import { parseCapture } from './lib/capture';
import type { Project, Task } from './ProjectViews';

const EXAMPLES = ['Draft launch email tomorrow !high', 'Review pricing page fri @', 'Fix onboarding copy in 3 days ~review', 'Plan Q1 roadmap next week !urgent'];

/** Press C anywhere: type a task in plain language and Zynckle fills in the fields. */
export default function QuickCapture({ projects, defaultProjectId, onClose, onCreated }: { projects: Project[]; defaultProjectId?: string; onClose: () => void; onCreated: (task: Task) => void }) {
  const [text, setText] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [fallbackProject, setFallbackProject] = useState(defaultProjectId || String(projects[0]?.id || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const placeholder = useMemo(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)], []);
  useEffect(() => { input.current?.focus(); api<{ members: Member[] }>('/api/team').then(d => setMembers(d.members)).catch(() => {}); }, []);
  const parsed = useMemo(() => parseCapture(text, members, projects), [text, members, projects]);
  const projectId = parsed.project?.id || fallbackProject;
  const projectName = parsed.project?.name || projects.find(p => String(p.id) === fallbackProject)?.name;

  const submit = async (keepOpen: boolean) => {
    if (!parsed.title || busy) return;
    setBusy(true); setError('');
    try {
      let targetProjectId = projectId;
      if (!targetProjectId) {
        const defaultProj = await api<Project>('/api/projects', { body: { name: 'Main Project', description: 'Default workspace project' } });
        targetProjectId = String(defaultProj.id);
      }
      const task = await api<Task>(`/api/projects/${targetProjectId}/tasks`, { body: { title: parsed.title.slice(0, 160), date: parsed.date || 'No date', priority: parsed.priority || 'Normal', assigneeId: parsed.assignee?.id, status: parsed.status && parsed.status !== 'Done' ? parsed.status : undefined } });
      onCreated(task); setMade(n => n + 1); setText('');
      if (!keepOpen) onClose(); else input.current?.focus();
    } catch (e) { setError(errorMessage(e, 'Task could not be created')); }
    finally { setBusy(false); }
  };

  return <div className="zy-palette-backdrop zy-capture-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form className="zy-capture" role="dialog" aria-modal="true" aria-label="Quick capture" onSubmit={e => { e.preventDefault(); submit(false); }}>
      <div className="zy-capture-head"><span><Zap size={12}/> QUICK CAPTURE{made ? ` · ${made} added` : ''}</span><button type="button" className="tiny-icon" onClick={onClose} aria-label="Close"><X size={13}/></button></div>
      <input ref={input} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label="Describe the task" maxLength={300}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(true); } }}/>
      <div className="zy-capture-chips" aria-live="polite">
        <span className={parsed.dateLabel ? 'on' : ''}><Calendar size={11}/>{parsed.dateLabel || 'No date'}</span>
        <span className={parsed.priority ? `on p-${parsed.priority.toLowerCase()}` : ''}><Flag size={11}/>{parsed.priority || 'Normal'}</span>
        <span className={parsed.assignee ? 'on' : ''}><User size={11}/>{parsed.assignee?.name || 'Unassigned'}</span>
        <span className={parsed.project ? 'on' : ''}><FolderKanban size={11}/>{projectName || (projects.length ? 'Select project' : 'Auto: Main Project')}</span>
        {parsed.status && <span className="on"><Columns3 size={11}/>{parsed.status}</span>}
      </div>
      {!projects.length && <p className="zy-muted-note" style={{ color: 'var(--muted)', fontSize: '13.5px', margin: '4px 0' }}>No projects yet. Adding will automatically create “Main Project” for you.</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="zy-capture-foot">
        <span className="zy-capture-help"><kbd>tomorrow</kbd><kbd>fri</kbd><kbd>in 3 days</kbd><kbd>!high</kbd><kbd>@name</kbd><kbd>#project</kbd><kbd>~review</kbd></span>
        {!parsed.project && projects.length > 1 && <select value={fallbackProject} onChange={e => setFallbackProject(e.target.value)} aria-label="Project">{projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}</select>}
        <button className="button-primary" disabled={!parsed.title || busy}><ArrowUp size={13}/> Add</button>
      </div>
      <small className="zy-capture-hint">Enter to add · Ctrl+Enter to add and keep going · Esc to close</small>
    </form>
  </div>;
}
