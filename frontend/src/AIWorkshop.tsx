import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Code2, Database, Eye, FileText, LoaderCircle, Pencil, Save, Sparkles, Square, Workflow } from 'lucide-react';
import AINav from './AINav';
import Markdown, { markdownToHtml } from './Markdown';
import { api, errorMessage, localDate, streamAI } from './lib/api';

type Project = { id: string | number; name: string; description: string };
type Task = { id: string | number; title: string; project: string; priority: string; status?: string; date?: string; description?: string; done: boolean; projectId?: string };
type SavedDoc = { id: string; title: string; content: string; updated: string };
type Mode = 'documentation' | 'architecture' | 'database' | 'planner';

const modes: { id: Mode; title: string; detail: string; icon: typeof FileText }[] = [
  { id: 'documentation', title: 'Documentation', detail: 'README, SRS, API docs, guides — from evidence', icon: BookOpen },
  { id: 'architecture', title: 'Architecture brief', detail: 'Quick design note with a Mermaid diagram', icon: Workflow },
  { id: 'database', title: 'Database design', detail: 'Entities, relationships, SQL and indexes', icon: Database },
  { id: 'planner', title: 'Project planner', detail: 'Milestones and reviewable task proposals', icon: Check },
];
const DOC_TYPES = ['README.md', 'Project overview', 'Software Requirements Specification', 'Architecture documentation', 'Database documentation', 'API documentation', 'Installation guide', 'Developer guide', 'Testing documentation', 'Deployment guide', 'Technical report', 'Project summary'];

export default function AIWorkshop({ projects, tasks, notify, onDocumentSaved, onTasksCreated }: { token: string; projects: Project[]; tasks: Task[]; notify: (message: string) => void; onDocumentSaved: (doc: SavedDoc) => void; onTasksCreated: (tasks: Task[]) => void }) {
  const [mode, setMode] = useState<Mode>('documentation');
  const [projectId, setProjectId] = useState('');
  const [codeProjectId, setCodeProjectId] = useState('');
  const [codeProjects, setCodeProjects] = useState<{ id: string; name: string; fileCount: number }[]>([]);
  const [format, setFormat] = useState('README.md');
  const [instructions, setInstructions] = useState('');
  const [output, setOutput] = useState('');
  const [view, setView] = useState<'preview' | 'edit'>('preview');
  const [documentTitle, setDocumentTitle] = useState('');
  const [available, setAvailable] = useState(false);
  const [providerMessage, setProviderMessage] = useState('Checking AI provider');
  const [sources, setSources] = useState<{ label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const project = projects.find(p => String(p.id) === projectId);
  const projectTasks = useMemo(() => tasks.filter(t => t.projectId === project?.id), [tasks, project?.id]);
  useEffect(() => {
    api<{ available: boolean; message: string }>('/api/ai/status').then(data => { setAvailable(Boolean(data.available)); setProviderMessage(data.message || 'AI provider status unavailable'); }).catch(() => setProviderMessage('Start the backend to check AI availability'));
    api<{ id: string; name: string; fileCount: number }[]>('/api/code-projects').then(setCodeProjects).catch(() => {});
  }, []);

  const promptFor = () => {
    const brief = `Additional brief from the user: ${instructions.trim() || '(none)'}`;
    if (mode === 'documentation') return `Create a ${format} for this project using only the reference material provided.${codeProjectId ? ' Treat the source files as primary evidence.' : ' No source code was provided — be explicit about what is unknown.'}\n${brief}`;
    if (mode === 'architecture') return `Create a concise architecture proposal with goals, components, data flow, trust boundaries, trade-offs, failure modes and open questions. Include a Mermaid flowchart that matches this project. Do not claim it is implemented.\n${brief}`;
    if (mode === 'database') return `Design a relational data model for this project.\n${brief}`;
    return `Plan this project as milestones and tasks.${projectTasks.length ? ' Avoid duplicating the existing tasks listed in the context.' : ''}\n${brief}`;
  };

  const generate = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true); setOutput(''); setSources([]);
    abort.current = new AbortController();
    const aiMode = mode === 'documentation' ? 'docs' : mode === 'architecture' ? 'general' : mode;
    let text = '';
    try {
      await streamAI({ messages: [{ role: 'user', content: promptFor() }], mode: aiMode, context: { projectId: project?.id, codeProjectId: codeProjectId || undefined } }, {
        signal: abort.current.signal, onMeta: meta => setSources(meta.sources), onDelta: d => { text += d; setOutput(o => o + d); },
      });
      setView(mode === 'planner' ? 'edit' : 'preview');
      setDocumentTitle(`${mode === 'documentation' ? format : modes.find(item => item.id === mode)?.title}${project ? ` · ${project.name}` : ''}`);
      if (!text) setOutput('The provider returned an empty response.');
    } catch (e) { if ((e as Error).name !== 'AbortError') setError(errorMessage(e, 'Generation failed')); }
    finally { setBusy(false); }
  };
  const saveDocument = async () => {
    if (!output.trim()) return; setError('');
    try { const data = await api<SavedDoc>('/api/documents', { body: { title: documentTitle.trim() || 'AI draft', content: mode === 'planner' ? `<pre><code>${output.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</code></pre>` : markdownToHtml(output), type: 'rich-text', projectId: project?.id } }); onDocumentSaved(data); notify('Reviewed draft saved to Documents'); }
    catch (e) { setError(errorMessage(e, 'Draft could not be saved')); }
  };
  const plan = useMemo(() => {
    if (mode !== 'planner' || !output.trim() || busy) return null;
    try { const raw = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { milestones?: { name: string; goal: string }[]; tasks?: { title?: string; description?: string; priority?: string; dueOffsetDays?: number | null; milestone?: string }[] }; }
    catch { return null; }
  }, [output, mode, busy]);
  const createTasks = async () => {
    if (!project) { setError('Choose a project before creating tasks.'); return; }
    if (!plan) { setError('The plan is not valid JSON yet. Fix it in the editor and try again.'); return; }
    const suggestions = (plan.tasks || []).filter(t => t.title?.trim()).slice(0, 20).map(t => {
      const offset = Number.isInteger(t.dueOffsetDays) && (t.dueOffsetDays as number) >= 0 && (t.dueOffsetDays as number) <= 365 ? t.dueOffsetDays as number : null;
      return { title: t.title!.trim().slice(0, 160), description: `${t.milestone ? `Milestone: ${t.milestone}\n\n` : ''}${String(t.description || '')}`.slice(0, 5000), priority: ['Low', 'Normal', 'High', 'Urgent'].includes(t.priority || '') ? t.priority : 'Normal', date: offset === null ? 'No date' : localDate(Date.now() + offset * 86400000), status: 'Backlog' };
    });
    if (!suggestions.length) { setError('The reviewed JSON does not contain any task titles.'); return; }
    if (!window.confirm(`Create ${suggestions.length} tasks in ${project.name}?`)) return;
    try { const data = await api<Task[]>(`/api/projects/${project.id}/tasks/bulk`, { body: { tasks: suggestions } }); onTasksCreated(data); notify(`${data.length} reviewed tasks added to ${project.name}`); }
    catch (e) { setError(errorMessage(e, 'Could not create tasks from this plan')); }
  };
  const ModeIcon = modes.find(item => item.id === mode)?.icon || Sparkles;
  return <>
    <section className="welcome-row subpage-welcome zy-compact-head"><div><div className="eyebrow">ZYNCKLE AI · REVIEW BEFORE APPLYING</div><h1>Make the next move <em>clearer.</em></h1><p className="welcome-sub">Generate evidence-based documentation and plans, inspect every line, then choose what to save or create.</p></div></section>
    <AINav/>
    <div className="ai-provider-state"><span className={available ? 'provider-on' : ''}/><div><strong>{available ? 'AI provider connected' : 'AI provider not configured'}</strong><small>{providerMessage}. Provider credentials remain on the backend.</small></div></div>
    <div className="ai-workspace"><section className="ai-work-config"><div className="eyebrow">CHOOSE A WORKFLOW</div><div className="ai-mode-list">{modes.map(item => <button key={item.id} className={mode === item.id ? 'selected' : ''} onClick={() => setMode(item.id)}><item.icon size={16}/><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div>
      <form className="ai-config-form" onSubmit={generate}><label>Project context<select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {(mode === 'documentation' || mode === 'database' || mode === 'architecture') && <label>Source code evidence<select value={codeProjectId} onChange={e => setCodeProjectId(e.target.value)}><option value="">None</option>{codeProjects.map(p => <option key={p.id} value={p.id}>{p.name} · {p.fileCount} files</option>)}</select></label>}
        {mode === 'documentation' && <label>Document type<select value={format} onChange={e => setFormat(e.target.value)}>{DOC_TYPES.map(value => <option key={value}>{value}</option>)}</select></label>}
        <label>What should it focus on?<textarea rows={5} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Add goals, constraints, audience, or missing context…" maxLength={4000}/></label>
        {busy ? <button type="button" className="button-secondary" onClick={() => abort.current?.abort()}><Square size={13}/> Stop</button> : <button className="button-primary" disabled={!available}><Sparkles size={15}/> Generate draft</button>}
        {mode === 'documentation' && <p className="zy-muted-note">The generator only states what the selected sources support and marks everything else as an assumption.</p>}</form></section>
      <section className="ai-review"><div className="ai-review-head"><span><ModeIcon size={16}/>{modes.find(item => item.id === mode)?.title} · REVIEW{busy && <LoaderCircle className="spin" size={13}/>}</span><div>{output && !busy && <><div className="zy-segmented small"><button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}><Eye size={12}/> Preview</button><button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}><Pencil size={12}/> Edit</button></div><button className="text-button" onClick={saveDocument}><Save size={14}/> Save to Documents</button></>}{mode === 'planner' && output && !busy && <button className="button-primary" onClick={createTasks} disabled={!plan || !project}><Check size={14}/> Create {plan?.tasks?.length || ''} tasks</button>}</div></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {sources.length > 0 && <div className="zy-sources inset"><span>Evidence</span>{sources.map((s, i) => <em key={i}><Code2 size={11}/>{s.label}</em>)}</div>}
        {output ? <>{!busy && <input className="ai-title-input" aria-label="Saved document title" value={documentTitle} onChange={e => setDocumentTitle(e.target.value)} placeholder="Draft title"/>}
          {mode === 'planner' && plan && view === 'preview' ? <div className="zy-plan">{plan.milestones?.map(m => <section key={m.name}><h3>{m.name}</h3><p>{m.goal}</p><ul>{(plan.tasks || []).filter(t => t.milestone === m.name).map((t, i) => <li key={i}><span className={`priority priority-${(t.priority || 'normal').toLowerCase()}`}/>{t.title}<small>{t.description}</small></li>)}</ul></section>)}</div>
            : view === 'preview' || busy ? <div className="zy-review-preview"><Markdown source={output} streaming={busy}/></div>
            : <textarea className="ai-output" value={output} onChange={e => setOutput(e.target.value)} aria-label="Review and edit AI draft" spellCheck/>}
          {mode === 'planner' && !busy && !plan && <p className="zy-muted-note zy-pad">The plan isn’t valid JSON yet — edit it before creating tasks.</p>}</>
          : <div className="doc-empty"><Code2/><h2>Your draft will appear here</h2><p>{available ? 'Choose a workflow, add context and evidence, then generate a draft you can edit before applying.' : 'Configure GROQ_API_KEY (or another provider) in the backend environment to enable generation.'}</p></div>}</section></div>
  </>;
}
