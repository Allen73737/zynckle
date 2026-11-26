import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy, Download, FileCode, LoaderCircle, Pencil, Plus, RotateCcw, Save, Sparkles, Square, Trash2, Workflow, X } from 'lucide-react';
import Markdown, { markdownToHtml } from './Markdown';
import AINav from './AINav';
import { parseGraph } from './ArchitectureFlow';
import { api, errorMessage, streamAI, timeAgo } from './lib/api';

const ArchitectureFlow = lazy(() => import('./ArchitectureFlow'));

const SECTIONS: { key: string; title: string; note: string }[] = [
  { key: 'overview', title: 'System overview', note: 'Purpose, users, scope' },
  { key: 'functional', title: 'Functional requirements', note: 'What it must do' },
  { key: 'nonfunctional', title: 'Non-functional requirements', note: 'Quality targets' },
  { key: 'stack', title: 'Technology stack', note: 'Choices and trade-offs' },
  { key: 'system', title: 'System architecture', note: 'Flowchart' },
  { key: 'components', title: 'Component architecture', note: 'Interactive graph' },
  { key: 'database', title: 'Database architecture', note: 'Storage and tables' },
  { key: 'erd', title: 'Entity relationship diagram', note: 'erDiagram' },
  { key: 'api', title: 'API structure', note: 'Resources and conventions' },
  { key: 'dataflow', title: 'Data flow', note: 'Sequence diagram' },
  { key: 'security', title: 'Security considerations', note: 'Threats and controls' },
  { key: 'deployment', title: 'Deployment', note: 'Environments and topology' },
];

type Section = { content: string; updatedAt: string; edited?: boolean; model?: string };
type Design = { id: string; title: string; description: string; projectId: string | null; codeProjectId: string | null; sections: Record<string, Section>; updatedAt: string };
type Summary = { id: string; title: string; project: string | null; updatedAt: string; sectionCount: number; owner: string };

export default function ArchitectureStudio({ projects, notify, canEdit }: { projects: { id: string | number; name: string }[]; notify: (message: string) => void; canEdit: boolean }) {
  const [designs, setDesigns] = useState<Summary[]>([]);
  const [design, setDesign] = useState<Design | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', projectId: '' });
  const [available, setAvailable] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [live, setLive] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [guidance, setGuidance] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [scaffoldModalOpen, setScaffoldModalOpen] = useState(false);
  const [scaffoldData, setScaffoldData] = useState<{ title: string; serviceName: string; files: Record<string, string> } | null>(null);
  const [scaffoldBusy, setScaffoldBusy] = useState(false);
  const [activeScaffoldFile, setActiveScaffoldFile] = useState<string>('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api<Summary[]>('/api/ai/architectures').then(setDesigns).catch(() => {});
    api<{ available: boolean }>('/api/ai/status').then(s => setAvailable(s.available)).catch(() => {});
  }, []);

  const open = async (id: string) => {
    abort.current?.abort(); setQueue([]); setError('');
    try { const data = await api<Design>(`/api/ai/architectures/${id}`); setDesign(data); setDraft({ title: data.title, description: data.description, projectId: data.projectId || '' }); }
    catch (e) { setError(errorMessage(e)); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      const created = await api<Design>('/api/ai/architectures', { body: { title: draft.title.trim() || 'Untitled architecture', description: draft.description, projectId: draft.projectId || undefined } });
      setDesign(created);
      setDesigns(list => [{ id: created.id, title: created.title, project: projects.find(p => p.id === created.projectId)?.name || null, updatedAt: created.updatedAt, sectionCount: 0, owner: 'You' }, ...list]);
      if (available) setQueue(SECTIONS.map(s => s.key));
    } catch (e) { setError(errorMessage(e)); }
  };

  const saveMeta = async () => {
    if (!design) return;
    try { const updated = await api<Design>(`/api/ai/architectures/${design.id}`, { method: 'PATCH', body: { title: draft.title, description: draft.description, projectId: draft.projectId || null } }); setDesign(updated); notify('Design details saved'); }
    catch (e) { setError(errorMessage(e)); }
  };

  const generate = async (key: string) => {
    if (!design) return;
    setRunning(key); setLive(l => ({ ...l, [key]: '' })); setError('');
    const controller = new AbortController();
    abort.current = controller;
    let text = '';
    try {
      await streamAI({
        mode: 'architecture', section: key, architectureId: design.id, description: draft.description,
        overview: key === 'overview' ? undefined : (live.overview || design.sections.overview?.content), guidance: guidance[key],
        context: draft.projectId ? { projectId: draft.projectId } : {},
      }, { signal: controller.signal, onDelta: delta => { text += delta; setLive(l => ({ ...l, [key]: (l[key] || '') + delta })); } });
      setDesign(d => d ? { ...d, sections: { ...d.sections, [key]: { content: text, updatedAt: new Date().toISOString() } } } : d);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { setError(`${SECTIONS.find(s => s.key === key)?.title}: ${errorMessage(e)}`); setQueue([]); }
    } finally {
      setLive(l => { const next = { ...l }; delete next[key]; return next; });
      setRunning(null); abort.current = null;
    }
  };

  // Work through queued sections one at a time so later sections can build on the overview.
  useEffect(() => {
    if (running || !queue.length || !design) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    generate(next);
  }, [queue, running, design]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdit = async (key: string) => {
    if (!design) return;
    try { const updated = await api<Design>(`/api/ai/architectures/${design.id}`, { method: 'PATCH', body: { sections: { [key]: editText } } }); setDesign(updated); setEditing(null); notify('Section saved'); }
    catch (e) { setError(errorMessage(e)); }
  };

  const triggerScaffold = async () => {
    if (!design) return;
    setScaffoldBusy(true);
    setScaffoldModalOpen(true);
    try {
      const res = await api<{ title: string; serviceName: string; files: Record<string, string>; success: boolean }>('/api/ai/scaffold', {
        body: { title: draft.title, description: draft.description, sections: design.sections }
      });
      setScaffoldData(res);
      const firstFile = Object.keys(res.files || {})[0] || '';
      setActiveScaffoldFile(firstFile);
      notify('Starter stack scaffolded successfully');
    } catch (e) {
      notify(errorMessage(e, 'Scaffolding failed'));
    } finally {
      setScaffoldBusy(false);
    }
  };

  const toMarkdown = () => design ? [`# ${draft.title}`, '', `> ${draft.description.replace(/\n/g, '\n> ')}`, '', ...SECTIONS.filter(s => design.sections[s.key]).flatMap(s => [`## ${s.title}`, '', s.key === 'components' ? componentsMarkdown(design.sections[s.key].content) : design.sections[s.key].content, ''])].join('\n') : '';
  const exportMarkdown = () => { const url = URL.createObjectURL(new Blob([toMarkdown()], { type: 'text/markdown' })); const a = document.createElement('a'); a.href = url; a.download = `${draft.title.replace(/[^\w-]+/g, '-') || 'architecture'}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 500); };
  const saveToDocs = async () => {
    try { await api('/api/documents', { body: { title: `Architecture · ${draft.title}`.slice(0, 160), content: markdownToHtml(toMarkdown()), type: 'rich-text', projectId: draft.projectId || undefined } }); notify('Architecture saved to Documents'); }
    catch (e) { notify(errorMessage(e, 'Could not save to Documents')); }
  };
  const remove = async () => {
    if (!design || !window.confirm(`Delete “${design.title}”?`)) return;
    try { await api(`/api/ai/architectures/${design.id}`, { method: 'DELETE' }); setDesigns(list => list.filter(d => d.id !== design.id)); setDesign(null); setDraft({ title: '', description: '', projectId: '' }); }
    catch (e) { notify(errorMessage(e)); }
  };

  const done = design ? SECTIONS.filter(s => design.sections[s.key]).length : 0;

  return <>
    <section className="welcome-row subpage-welcome zy-compact-head"><div><div className="eyebrow">ZYNCKLE AI · ARCHITECTURE DESIGNER</div><h1>From an idea to a <em>system.</em></h1><p className="welcome-sub">Describe what you are building. Zynckle drafts each part of the architecture — regenerate or edit any section without losing the rest.</p></div></section>
    <AINav/>
    <div className="zy-arch">
      <aside className="zy-arch-list">
        <button className="button-secondary zy-block" onClick={() => { abort.current?.abort(); setQueue([]); setDesign(null); setDraft({ title: '', description: '', projectId: '' }); }}><Plus size={14}/> New design</button>
        <div className="eyebrow">SAVED DESIGNS · {designs.length}</div>
        {designs.map(d => <button key={d.id} className={`zy-arch-item ${design?.id === d.id ? 'selected' : ''}`} onClick={() => open(d.id)}><strong>{d.title}</strong><small>{d.sectionCount}/12 sections · {timeAgo(d.updatedAt)}{d.project ? ` · ${d.project}` : ''}</small></button>)}
        {!designs.length && <p className="zy-muted-note">Designs are shared with your workspace.</p>}
      </aside>
      <section className="zy-arch-main">
        {error && <div className="zy-inline-error" role="alert"><X size={13}/>{error}</div>}
        {!design ? <form className="zy-arch-brief" onSubmit={create}>
          <div className="zy-arch-number">00</div>
          <div>
            <div className="eyebrow">THE BRIEF</div>
            <input className="zy-arch-title" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Name this system" maxLength={120} aria-label="Design title"/>
            <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} rows={7} maxLength={8000} required minLength={20} aria-label="Project description"
              placeholder="Describe the product in plain language: who uses it, what they do, scale expectations, constraints, integrations… e.g. “A booking platform for independent physiotherapists with patient intake forms, reminders by SMS, Stripe payments and a clinic dashboard. ~200 clinics in year one.”"/>
            <div className="zy-arch-brief-row">
              <label className="zy-field">Link a project (optional)<select value={draft.projectId} onChange={e => setDraft(d => ({ ...d, projectId: e.target.value }))}><option value="">None</option>{projects.filter(p => typeof p.id === 'string').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <button className="button-primary" disabled={!canEdit || draft.description.trim().length < 20}><Sparkles size={15}/> {available ? 'Design the architecture' : 'Create design'}</button>
            </div>
            {!available && <p className="zy-muted-note">AI generation is unavailable until a provider key is configured. You can still create a design and write sections by hand.</p>}
          </div>
        </form> : <>
          <header className="zy-arch-head">
            <div className="zy-arch-head-main">
              <input className="zy-arch-title" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} onBlur={() => draft.title !== design.title && saveMeta()} aria-label="Design title" disabled={!canEdit}/>
              <details className="zy-arch-brief-edit"><summary>Brief · {draft.description.length} characters</summary><textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} rows={5} disabled={!canEdit} aria-label="Project description"/><button className="text-button" onClick={saveMeta} disabled={!canEdit}><Save size={13}/> Save brief</button></details>
            </div>
            <div className="zy-arch-progress"><span>{done}/12</span><i><b style={{ width: `${(done / 12) * 100}%` }}/></i></div>
            <div className="zy-arch-actions">
              {running || queue.length ? <button className="button-secondary" onClick={() => { setQueue([]); abort.current?.abort(); }}><Square size={12}/> Stop</button>
                : <button className="button-primary" disabled={!available || !canEdit} onClick={() => setQueue(SECTIONS.filter(s => !design.sections[s.key]).map(s => s.key))}><Sparkles size={14}/> {done ? 'Fill missing sections' : 'Generate all'}</button>}
              <button className="button-secondary" onClick={triggerScaffold} disabled={!done} title="Scaffold Spring Boot, React, and OpenAPI boilerplate"><Code2 size={14}/> Scaffold Code</button>
              <button className="button-secondary" onClick={exportMarkdown} disabled={!done}><Download size={14}/> Markdown</button>
              <button className="button-secondary" onClick={saveToDocs} disabled={!done || !canEdit}><Save size={14}/> To Documents</button>
              <button className="icon-button danger" onClick={remove} aria-label="Delete design" title="Delete design" disabled={!canEdit}><Trash2 size={15}/></button>
            </div>
          </header>
          <nav className="zy-arch-index" aria-label="Sections">{SECTIONS.map((s, i) => <a key={s.key} href={`#arch-${s.key}`} className={design.sections[s.key] ? 'filled' : running === s.key ? 'running' : ''}><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</a>)}</nav>
          {SECTIONS.map((section, index) => {
            const saved = design.sections[section.key];
            const streamingText = live[section.key];
            const content = streamingText ?? saved?.content ?? '';
            const isRunning = running === section.key;
            const queued = queue.includes(section.key);
            const graph = section.key === 'components' && content && !isRunning ? parseGraph(content) : null;
            return <article key={section.key} id={`arch-${section.key}`} className={`zy-arch-section ${isRunning ? 'running' : ''}`}>
              <div className="zy-arch-number">{String(index + 1).padStart(2, '0')}</div>
              <div className="zy-arch-body">
                <header>
                  <div><h2>{section.title}</h2><small>{isRunning ? 'Writing…' : queued ? 'Queued' : saved ? `${saved.edited ? 'Edited' : 'Generated'} ${timeAgo(saved.updatedAt)}` : section.note}</small></div>
                  <div className="zy-arch-section-actions">
                    {saved && !isRunning && <button className="text-button" onClick={() => { navigator.clipboard.writeText(saved.content); setCopiedKey(section.key); notify('Section copied'); setTimeout(() => setCopiedKey(null), 2000); }}>{copiedKey === section.key ? <><Check size={12}/> Copied</> : <><Copy size={12}/> Copy</>}</button>}
                    {saved && !isRunning && canEdit && <button className="text-button" onClick={() => { setEditing(section.key); setEditText(saved.content); }}><Pencil size={12}/> Edit</button>}
                    {canEdit && <button className="text-button" disabled={!available || Boolean(running) || queued || !draft.description.trim()} onClick={() => generate(section.key)}>{isRunning ? <LoaderCircle className="spin" size={12}/> : saved ? <RotateCcw size={12}/> : <Sparkles size={12}/>} {saved ? 'Regenerate' : 'Generate'}</button>}
                  </div>
                </header>
                {canEdit && !isRunning && <input className="zy-arch-guidance" value={guidance[section.key] || ''} onChange={e => setGuidance(g => ({ ...g, [section.key]: e.target.value }))} placeholder="Optional guidance for regenerating this section (e.g. “prefer serverless”, “add offline mode”)" aria-label={`Guidance for ${section.title}`}/>}
                {editing === section.key ? <div className="zy-arch-editor"><textarea value={editText} onChange={e => setEditText(e.target.value)} rows={14} aria-label={`Edit ${section.title}`}/><div><button className="button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button-primary" onClick={() => saveEdit(section.key)}><Check size={14}/> Save section</button></div></div>
                  : content ? (section.key === 'components' ? (graph ? <><Suspense fallback={<div className="zy-flow-canvas zy-skeleton"/>}><ArchitectureFlow graph={graph}/></Suspense><ul className="zy-flow-legend">{graph.nodes.map(n => <li key={n.id}><strong>{n.label}</strong><small>{n.kind}</small>{n.description}</li>)}</ul></> : isRunning ? <pre className="zy-arch-raw">{content}</pre> : <><p className="zy-muted-note">The component graph could not be parsed. Regenerate the section or edit the JSON.</p><pre className="zy-arch-raw">{content}</pre></>)
                    : <Markdown source={content} streaming={isRunning}/>)
                    : <div className="zy-arch-placeholder"><Workflow size={16}/>{available ? 'Not generated yet.' : 'Write this section by hand with Edit, or configure an AI provider.'}{!available && canEdit && <button className="text-button" onClick={() => { setEditing(section.key); setEditText(''); }}><Pencil size={12}/> Write</button>}</div>}
              </div>
            </article>;
          })}
        </>}
      </section>
    </div>

    {scaffoldModalOpen && (
      <div className="modal-backdrop" onClick={() => setScaffoldModalOpen(false)}>
        <div className="modal" style={{ maxWidth: 880, width: '92%' }} onClick={e => e.stopPropagation()}>
          <div className="modal-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Code2 size={18} />
              <div>
                <strong>Architecture Code & Stack Scaffolder</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Auto-generated production boilerplate from system design specifications
                </div>
              </div>
            </div>
            <button className="icon-button" onClick={() => setScaffoldModalOpen(false)}><X size={15} /></button>
          </div>

          <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            {scaffoldBusy && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
                <LoaderCircle className="spin" size={20} />
                <span>Synthesizing Spring Boot 3.4 REST endpoints, OpenAPI schemas, and React client…</span>
              </div>
            )}

            {scaffoldData && !scaffoldBusy && (
              <div>
                {/* File Tabs */}
                <div className="zy-tabs small" style={{ marginBottom: 12 }}>
                  {Object.keys(scaffoldData.files).map(filename => (
                    <button
                      key={filename}
                      className={activeScaffoldFile === filename ? 'active' : ''}
                      onClick={() => setActiveScaffoldFile(filename)}
                    >
                      <FileCode size={13} /> {filename}
                    </button>
                  ))}
                </div>

                {activeScaffoldFile && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className="zy-mono" style={{ fontSize: 12, fontWeight: 600 }}>{activeScaffoldFile}</span>
                      <button
                        className="button-secondary btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(scaffoldData.files[activeScaffoldFile]);
                          notify(`Copied ${activeScaffoldFile} to clipboard`);
                        }}
                      >
                        <Copy size={12} /> Copy Code
                      </button>
                    </div>
                    <pre style={{
                      padding: 14, background: 'var(--surface-soft)', borderRadius: 'var(--radius-m)',
                      fontFamily: "'DM Mono', monospace", fontSize: 12, overflowX: 'auto', maxHeight: 360,
                      border: '1px solid var(--line)', whiteSpace: 'pre-wrap'
                    }}>
                      {scaffoldData.files[activeScaffoldFile]}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-foot">
            <button className="button-secondary" onClick={() => setScaffoldModalOpen(false)}>Close</button>
            {scaffoldData && (
              <button
                className="button-primary"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(scaffoldData.files, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${scaffoldData.serviceName}-scaffold.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  notify('Scaffold bundle downloaded');
                }}
              >
                <Download size={14} /> Download Stack Bundle
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </>;
}

function componentsMarkdown(content: string) {
  const graph = parseGraph(content);
  if (!graph) return content;
  const lines = ['```mermaid', 'flowchart LR', ...graph.nodes.map(n => `  ${n.id.replace(/\W/g, '_')}["${n.label.replace(/"/g, "'")}"]`), ...graph.edges.map(e => `  ${e.source.replace(/\W/g, '_')} -->${e.label ? `|${e.label.replace(/[|"]/g, '')}|` : ''} ${e.target.replace(/\W/g, '_')}`), '```', ''];
  return [...lines, ...graph.nodes.map(n => `- **${n.label}** (${n.kind}) — ${n.description}`)].join('\n');
}
