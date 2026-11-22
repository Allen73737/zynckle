import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Check, CircleAlert, FilePlus2, FolderPlus, ListPlus, LoaderCircle, PencilLine, Play, Wand2 } from 'lucide-react';
import { markdownToHtml } from './Markdown';
import { api, errorMessage } from './lib/api';

export type AiAction =
  | { type: 'create_task'; projectId?: string; projectRef?: string; title: string; description?: string; priority?: string; date?: string; assigneeId?: string }
  | { type: 'update_task'; taskId: string; status?: string; priority?: string; date?: string; assigneeId?: string; title?: string }
  | { type: 'create_project'; name: string; description?: string }
  | { type: 'create_document'; title: string; content?: string };

type Outcome = { state: 'done' | 'error'; message?: string; link?: string };
const KNOWN = new Set(['create_task', 'update_task', 'create_project', 'create_document']);
const FENCE = /```zynckle-actions[^\n]*\n([\s\S]*?)```/;

/**
 * Separate the action plan from the prose of an answer. While a plan is still streaming
 * (opening fence, no closing fence yet) its JSON is hidden and `pending` is set.
 */
export function splitActions(content: string): { text: string; actions: AiAction[]; pending: boolean; invalid: boolean } {
  const match = content.match(FENCE);
  if (!match) {
    const open = content.indexOf('```zynckle-actions');
    return open >= 0 ? { text: content.slice(0, open).trimEnd(), actions: [], pending: true, invalid: false } : { text: content, actions: [], pending: false, invalid: false };
  }
  const text = (content.slice(0, match.index) + content.slice(match.index! + match[0].length)).trim();
  try {
    const parsed = JSON.parse(match[1]);
    const list = (Array.isArray(parsed) ? parsed : parsed?.actions) || [];
    const actions = list.filter((a: { type?: string }) => a && KNOWN.has(String(a.type))).slice(0, 25) as AiAction[];
    return { text, actions, pending: false, invalid: !actions.length };
  } catch {
    return { text, actions: [], pending: false, invalid: true };
  }
}

type Named = { id: string | number; name?: string; title?: string };

function describe(action: AiAction, projects: Named[], tasks: Named[], members: Named[]) {
  const project = (id?: string) => projects.find(p => String(p.id) === id)?.name;
  const person = (id?: string) => members.find(m => String(m.id) === id)?.name;
  switch (action.type) {
    case 'create_project': return { icon: FolderPlus, title: `New project “${action.name}”`, detail: action.description };
    case 'create_document': return { icon: FilePlus2, title: `New document “${action.title}”`, detail: action.content ? `${action.content.replace(/[#*_`>]/g, '').slice(0, 140)}${action.content.length > 140 ? '…' : ''}` : undefined };
    case 'create_task': return {
      icon: ListPlus, title: action.title,
      detail: [`in ${project(action.projectId) || action.projectRef || 'unknown project'}`, action.priority && action.priority !== 'Normal' ? action.priority : '', action.date ? `due ${action.date}` : '', person(action.assigneeId) ? `→ ${person(action.assigneeId)}` : ''].filter(Boolean).join(' · '),
    };
    case 'update_task': {
      const changes = [action.status && `status → ${action.status}`, action.priority && `priority → ${action.priority}`, action.date && `due → ${action.date}`, action.assigneeId && `assign → ${person(action.assigneeId) || 'member'}`, action.title && `rename → “${action.title}”`].filter(Boolean).join(' · ');
      return { icon: PencilLine, title: tasks.find(t => String(t.id) === action.taskId)?.title || `Task ${action.taskId.slice(0, 8)}`, detail: changes || 'no changes' };
    }
  }
}

const storageKey = (id: string) => `zynckle-actions-${id}`;
const readOutcomes = (id: string): Record<number, Outcome> => { try { return JSON.parse(localStorage.getItem(storageKey(id)) || '{}'); } catch { return {}; } };

/** A reviewable action plan: nothing changes until the user applies it. */
export function ActionPlan({ messageId, actions, projects, tasks, canEdit, notify }: {
  messageId: string; actions: AiAction[]; projects: Named[]; tasks: Named[]; canEdit: boolean; notify: (message: string) => void;
}) {
  const [selected, setSelected] = useState<boolean[]>(() => actions.map(() => true));
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>(() => readOutcomes(messageId));
  const [running, setRunning] = useState<number | null>(null);
  const [members, setMembers] = useState<Named[]>([]);
  useEffect(() => { api<{ members: Named[] }>('/api/team').then(d => setMembers(Array.isArray(d?.members) ? d.members : [])).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem(storageKey(messageId), JSON.stringify(outcomes)); } catch { /* storage unavailable */ } }, [messageId, outcomes]);

  const rows = useMemo(() => actions.map(a => describe(a, projects, tasks, members)), [actions, projects, tasks, members]);
  const pending = actions.map((_, i) => i).filter(i => selected[i] && outcomes[i]?.state !== 'done');
  const doneCount = Object.values(outcomes).filter(o => o.state === 'done').length;

  const apply = async () => {
    const created = new Map<string, string>(); // project name → id, for projectRef
    let failures = 0;
    for (const i of pending) {
      setRunning(i);
      const action = actions[i];
      try {
        let outcome: Outcome = { state: 'done' };
        if (action.type === 'create_project') {
          const p = await api<{ id: string }>('/api/projects', { body: { name: action.name, description: action.description || '' } });
          created.set(action.name.toLowerCase(), p.id);
          outcome = { state: 'done', link: `/projects/${p.id}` };
        } else if (action.type === 'create_task') {
          const projectId = action.projectId || (action.projectRef && (created.get(action.projectRef.toLowerCase()) || projects.find(p => p.name?.toLowerCase() === action.projectRef!.toLowerCase())?.id));
          if (!projectId) throw new Error('Pick a project first: this task has none');
          const t = await api<{ id: string }>(`/api/projects/${projectId}/tasks`, { body: { title: action.title, description: action.description || '', priority: action.priority || 'Normal', date: action.date, assigneeId: action.assigneeId } });
          outcome = { state: 'done', link: `/projects/${projectId}?task=${t.id}` };
        } else if (action.type === 'update_task') {
          const { type: _type, taskId, ...changes } = action;
          const t = await api<{ projectId: string }>(`/api/tasks/${taskId}`, { method: 'PATCH', body: changes });
          outcome = { state: 'done', link: `/projects/${t.projectId}?task=${taskId}` };
        } else if (action.type === 'create_document') {
          const d = await api<{ id: string }>('/api/documents', { body: { title: action.title, content: markdownToHtml(action.content || ''), type: 'rich-text' } });
          outcome = { state: 'done', link: `/documents?doc=${d.id}` };
        }
        setOutcomes(o => ({ ...o, [i]: outcome }));
      } catch (e) {
        failures++;
        setOutcomes(o => ({ ...o, [i]: { state: 'error', message: errorMessage(e, 'Could not apply this change') } }));
      }
    }
    setRunning(null);
    window.dispatchEvent(new CustomEvent('zynckle:workspace-changed'));
    notify(failures ? `${pending.length - failures} applied, ${failures} failed` : `${pending.length} change${pending.length === 1 ? '' : 's'} applied`);
  };

  return <section className="zy-plan" aria-label="Proposed changes">
    <header><span className="zy-ai-glyph small"><Wand2 size={12}/></span><strong>Proposed changes</strong><small>{doneCount ? `${doneCount} of ${actions.length} applied` : `${actions.length} change${actions.length === 1 ? '' : 's'} · review before applying`}</small></header>
    <ol>{actions.map((_, i) => { const row = rows[i]; const outcome = outcomes[i]; const Icon = row.icon; return <li key={i} className={outcome?.state || ''}>
      <label>
        <input type="checkbox" checked={selected[i] && outcome?.state !== 'done'} disabled={!canEdit || outcome?.state === 'done' || running !== null} onChange={e => setSelected(s => s.map((v, j) => j === i ? e.target.checked : v))}/>
        <Icon size={14}/>
        <span><strong>{row.title}</strong>{row.detail && <small>{row.detail}</small>}{outcome?.state === 'error' && <em><CircleAlert size={12}/>{outcome.message}</em>}</span>
      </label>
      {running === i ? <LoaderCircle className="spin" size={14}/> : outcome?.state === 'done' ? (outcome.link ? <NavLink to={outcome.link} className="zy-plan-done"><Check size={13}/> Open</NavLink> : <span className="zy-plan-done"><Check size={13}/></span>) : null}
    </li>; })}</ol>
    {canEdit ? pending.length > 0 && <footer><button className="button-primary" onClick={apply} disabled={running !== null}>{running !== null ? <LoaderCircle className="spin" size={14}/> : <Play size={14}/>} Apply {pending.length} change{pending.length === 1 ? '' : 's'}</button><small>Runs with your permissions. Each change is logged in workspace activity.</small></footer>
      : <footer><small>Viewers can’t apply changes. Ask an editor or admin.</small></footer>}
  </section>;
}
