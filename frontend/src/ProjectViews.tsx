import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowRight, Calendar, CalendarDays, ChevronLeft, ChevronRight, GanttChart, Check, FolderKanban, LayoutGrid, List, MessageSquare, Pencil, Plus, Save, Search, Tag, Trash2, Upload, User, X, Activity as ActivityIcon, Sparkles } from 'lucide-react';
import { api, errorMessage, localDate, timeAgo, type Member } from './lib/api';
import { useRealtimeEvent } from './lib/realtime';

const ImportDialog = lazy(() => import('./ImportDialog'));

export type Project = { id: string | number; name: string; description: string; color: string; progress: number; due: string; members: number; status: string; tags?: string[]; memberIds?: string[]; memberList?: Member[]; archived?: boolean; ownerId?: string; taskCount?: number; doneCount?: number };
export type Task = { id: string | number; title: string; project: string; date: string; priority: string; done: boolean; status?: string; due?: string; projectId?: string; description?: string; assigneeId?: string | null; assignee?: Member | null; commentCount?: number; position?: number; createdAt?: string };
export type ActivityItem = { id: string; verb: string; summary: string; entityType: string; createdAt: string; actor: Member; projectId?: string | null };

export const COLUMNS = ['Backlog', 'To do', 'In progress', 'In review', 'Done'];
export const statusOf = (t: Task) => t.status || (t.done ? 'Done' : 'To do');
const isOverdue = (t: Task) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && statusOf(t) !== 'Done' && t.date < localDate();
const shortDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`)) : value;

export function ProjectRow({ project, onDelete }: { project: Project; onDelete: (id: string | number) => void }) {
  return <NavLink to={`/projects/${project.id}`} className="project-row"><div className={`project-art ${project.color}`}><span>{project.name.slice(0, 1)}</span><i className="art-orbit"/><i className="art-dot"/></div><div className="project-info"><div className="project-title-line"><h3>{project.name}</h3><span className={`status status-${project.status.toLowerCase().replace(/ /g, '-')}`}><i/>{project.status}</span>{project.archived && <span className="status"><Archive size={9}/> Archived</span>}</div><p>{project.description || 'A new idea, ready to take shape.'}</p><div className="project-meta"><span>{project.members} member{project.members === 1 ? '' : 's'}</span><span className="meta-divider"/><span>{project.due && project.due !== 'Not set' ? `Due ${shortDate(project.due)}` : 'No deadline'}</span>{project.taskCount !== undefined && <><span className="meta-divider"/><span className="tiny-progress"><i style={{ width: `${project.progress}%` }}/></span><span>{project.progress}%</span></>}{!!project.tags?.length && <><span className="meta-divider"/>{project.tags.slice(0, 3).map(t => <em key={t} className="zy-tag">{t}</em>)}</>}</div></div><button className="row-more" aria-label={`Delete ${project.name}`} title="Delete project" onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project.id); }}><Trash2 size={15}/></button></NavLink>;
}

export function Projects({ projects, onNew, onDelete, search, canEdit, onSeedWorkspace }: { projects: Project[]; onNew: () => void; onDelete: (id: string | number) => void; search: string; canEdit: boolean; onSeedWorkspace?: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<Project[]>([]);
  const [status, setStatus] = useState('All');
  useEffect(() => { if (showArchived) api<Project[]>('/api/projects?archived=include').then(all => setArchived(all.filter(p => p.archived))).catch(() => {}); }, [showArchived]);
  const source = showArchived ? archived : projects;
  const list = source.filter(p => `${p.name} ${p.description} ${(p.tags || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (status === 'All' || p.status === status));
  return <><section className="welcome-row subpage-welcome"><div><div className="eyebrow">YOUR WORK, TAKING SHAPE</div><h1>Projects <em>in motion.</em></h1><p className="welcome-sub">Keep every moving piece connected to the bigger picture.</p></div>{canEdit && <div style={{ display: 'flex', gap: '10px' }}>{onSeedWorkspace && !projects.length && <button className="button-secondary" onClick={onSeedWorkspace}><Sparkles size={16}/> Seed starter data</button>}<button className="button-primary" onClick={onNew}><Plus size={16}/> New project</button></div>}</section>
    <div className="section-heading"><div><div className="eyebrow">{list.length} {showArchived ? 'ARCHIVED' : 'ACTIVE'} PROJECTS</div><h2>{showArchived ? 'Archive' : 'All projects'}</h2></div>
      <div className="zy-filter-row"><div className="zy-segmented small">{['All', 'Planning', 'In progress', 'In review', 'Completed'].map(s => <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div><button className="text-button" onClick={() => setShowArchived(a => !a)}>{showArchived ? <><FolderKanban size={13}/> Active projects</> : <><Archive size={13}/> Archived</>}</button></div></div>
    <div className="project-list full-project-list">{list.map(p => <ProjectRow key={p.id} project={p} onDelete={onDelete}/>)}{!list.length && <div className="empty-state"><FolderKanban size={23}/><h3>{search || status !== 'All' ? 'No projects match' : showArchived ? 'Nothing archived' : 'A blank canvas'}</h3><p>{search || status !== 'All' ? 'Try another filter or clear the search.' : showArchived ? 'Archived projects stay searchable here.' : 'Create a project or load starter sample data to bring your ideas into focus.'}</p>{!search && !showArchived && canEdit && <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}><button className="button-primary" onClick={onNew}><Plus size={15}/> Create a project</button>{onSeedWorkspace && <button className="button-secondary" onClick={onSeedWorkspace}><Sparkles size={15}/> Load Starter Projects & Tasks</button>}</div>}</div>}</div></>;
}

function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { api<{ members: Member[] }>('/api/team').then(d => setMembers(d.members)).catch(() => {}); }, []);
  return members;
}

export function ProjectDetail({ projects, tasks, onEdit, onTask, onMove, onOpenTask, onProjectChange, onDelete, canEdit, accountId }: {
  projects: Project[]; tasks: Task[]; onEdit: (project: Project) => void; onTask: (project: string) => void; onMove: (id: string, status: string) => void; onOpenTask: (task: Task) => void;
  onProjectChange: (project: Project) => void; onDelete: (id: string | number) => void; canEdit: boolean; accountId?: string;
}) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const members = useMembers();
  const [view, setView] = useState<'board' | 'list' | 'timeline' | 'calendar' | 'activity'>(() => (localStorage.getItem('zynckle-project-view') as 'board' | 'list' | 'timeline' | 'calendar') || 'board');
  const [filter, setFilter] = useState('');
  const [priority, setPriority] = useState('Any');
  const [assignee, setAssignee] = useState('Anyone');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [announce, setAnnounce] = useState('');
  const project = projects.find(p => String(p.id) === id);
  useEffect(() => { localStorage.setItem('zynckle-project-view', view === 'activity' ? 'board' : view); }, [view]);
  useEffect(() => { if (view === 'activity' && project) api<ActivityItem[]>(`/api/activity?projectId=${project.id}&limit=60`).then(setActivity).catch(() => setActivity([])); }, [view, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtimeEvent('activity', (item: ActivityItem) => { if (item.projectId === id) setActivity(list => list ? [item, ...list] : list); });
  useEffect(() => { const taskId = params.get('task'); const task = taskId && tasks.find(t => String(t.id) === taskId); if (task) { onOpenTask(task); setParams(p => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true }); } }, [params, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => tasks.filter(t => t.projectId === String(project?.id) || (!t.projectId && t.project === project?.name)), [tasks, project]);
  const visible = items.filter(t => `${t.title} ${t.description || ''}`.toLowerCase().includes(filter.toLowerCase()) && (priority === 'Any' || t.priority === priority) && (assignee === 'Anyone' || (assignee === 'Me' ? t.assigneeId === accountId : assignee === 'Unassigned' ? !t.assigneeId : t.assigneeId === assignee)));
  if (!project) return <div className="empty-state"><FolderKanban size={23}/><h3>Project not found</h3><p>It may have been removed, archived, or belong to another workspace.</p><NavLink className="button-secondary" to="/projects">Back to projects</NavLink></div>;
  const progress = items.length ? Math.round(items.filter(t => statusOf(t) === 'Done').length / items.length * 100) : 0;
  const patch = async (values: Record<string, unknown>, message: string) => {
    try { onProjectChange(await api<Project>(`/api/projects/${project.id}`, { method: 'PATCH', body: values })); }
    catch (e) { window.alert(errorMessage(e, message)); }
  };
  const addTag = (e: React.FormEvent) => { e.preventDefault(); const tag = tagInput.trim(); if (!tag) return; patch({ tags: [...(project.tags || []), tag] }, 'Tag could not be added'); setTagInput(''); };
  const overdue = items.filter(isOverdue).length;

  const card = (t: Task) => <div className={`kanban-card zy-card ${dragging === String(t.id) ? 'dragging' : ''}`} key={t.id} draggable={canEdit} tabIndex={0} role="button" aria-label={`${t.title}, ${statusOf(t)}. Press Enter to open${canEdit ? ', Alt plus left or right arrow to move between columns' : ''}.`}
    onDragStart={e => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; setDragging(String(t.id)); }} onDragEnd={() => { setDragging(null); setOver(null); }}
    onClick={() => onOpenTask(t)} onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTask(t); return; }
      // Keyboard alternative to drag and drop.
      if (canEdit && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const next = COLUMNS[COLUMNS.indexOf(statusOf(t)) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) { onMove(String(t.id), next); setAnnounce(`${t.title} moved to ${next}`); }
      }
    }}>
    <span className={`kanban-tag zy-priority-${t.priority.toLowerCase()}`}>{t.priority}</span><strong>{t.title}</strong>
    <div><span title={t.assignee?.name || 'Unassigned'} className={t.assignee ? '' : 'zy-unassigned'}>{t.assignee?.avatar || <User size={9}/>}</span><small className={isOverdue(t) ? 'zy-overdue' : ''}>{t.commentCount ? <><MessageSquare size={9}/> {t.commentCount} · </> : null}{t.date && t.date !== 'No date' ? shortDate(t.date) : 'No date'}</small></div></div>;

  return <><div className="breadcrumb"><NavLink to="/projects">Projects</NavLink><span>/</span><span>{project.name}</span></div>
    <section className="project-detail-head"><div className={`project-art large ${project.color}`}><span>{project.name[0]}</span></div><div><div className="eyebrow">PROJECT · {project.status.toUpperCase()}{project.archived ? ' · ARCHIVED' : ''}</div><h1>{project.name}</h1><p>{project.description}</p>
      <div className="zy-tag-row">{(project.tags || []).map(t => <em key={t} className="zy-tag">{t}{canEdit && <button aria-label={`Remove tag ${t}`} onClick={() => patch({ tags: (project.tags || []).filter(x => x !== t) }, 'Tag could not be removed')}><X size={9}/></button>}</em>)}{canEdit && <form onSubmit={addTag}><Tag size={11}/><input value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="Add tag" maxLength={24} aria-label="Add tag"/></form>}</div></div>
      <div className="zy-head-actions">{canEdit && <button className="button-secondary" onClick={() => onEdit(project)}><Pencil size={15}/> Edit project</button>}
        <button className="icon-button" title="Ask AI about this project" aria-label="Ask AI about this project" onClick={() => navigate(`/ai?project=${project.id}&prompt=${encodeURIComponent('Summarise where this project stands, the risks, and what to do next.')}`)}><Sparkles size={15}/></button>
        {canEdit && <button className="icon-button" title={project.archived ? 'Restore project' : 'Archive project'} aria-label={project.archived ? 'Restore project' : 'Archive project'} onClick={() => patch({ archived: !project.archived }, 'Archive failed')}>{project.archived ? <ArchiveRestore size={15}/> : <Archive size={15}/>}</button>}
        {canEdit && <button className="icon-button danger" title="Delete project" aria-label="Delete project" onClick={() => onDelete(project.id)}><Trash2 size={15}/></button>}</div></section>
    <div className="detail-stats"><div><span>Progress</span><strong>{progress}%</strong><div className="detail-progress"><i style={{ width: `${progress}%` }}/></div></div><div><span>Due date</span><strong>{project.due && project.due !== 'Not set' ? shortDate(project.due) : 'Not set'}</strong></div>
      <div className="zy-members-stat"><span>People</span><button className="zy-avatar-stack" onClick={() => canEdit && setMembersOpen(o => !o)} aria-label="Manage project members">{(project.memberList || []).slice(0, 5).map(m => <i key={m.id} title={m.name}>{m.avatar}</i>)}<strong>{project.members} member{project.members === 1 ? '' : 's'}</strong></button>
        {membersOpen && <div className="zy-dropdown" onMouseLeave={() => setMembersOpen(false)}>{members.map(m => <label key={m.id} className="zy-check"><input type="checkbox" checked={(project.memberIds || []).includes(m.id)} onChange={e => patch({ memberIds: e.target.checked ? [...(project.memberIds || []), m.id] : (project.memberIds || []).filter(x => x !== m.id) }, 'Members could not be updated')}/>{m.name}</label>)}</div>}</div>
      <div><span>Tasks</span><strong>{items.length} tasks{overdue ? <em className="zy-overdue"> · {overdue} overdue</em> : ''}</strong></div></div>
    <div className="kanban-head"><div><div className="eyebrow">THE WORK</div><h2>Tasks & milestones</h2></div>
      <div className="zy-head-actions"><div className="zy-segmented small" role="tablist"><button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}><LayoutGrid size={12}/> Board</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={12}/> List</button><button className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}><GanttChart size={12}/> Timeline</button><button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays size={12}/> Calendar</button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><ActivityIcon size={12}/> Activity</button></div>{canEdit && <button className="button-secondary" onClick={() => setImporting(true)} title="Import tasks from a CSV export (Notion, Trello, Linear, Asana)"><Upload size={15}/> Import</button>}{canEdit && <button className="button-secondary" onClick={() => onTask(project.name)}><Plus size={15}/> Add task</button>}</div></div>
    {view !== 'activity' && <div className="zy-board-filters"><label className="zy-search-field"><Search size={13}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tasks" aria-label="Filter tasks"/></label>
      <select value={priority} onChange={e => setPriority(e.target.value)} aria-label="Priority filter"><option>Any</option><option>Urgent</option><option>High</option><option>Normal</option><option>Low</option></select>
      <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Assignee filter"><option>Anyone</option><option value="Me">Assigned to me</option><option>Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {(filter || priority !== 'Any' || assignee !== 'Anyone') && <button className="text-button" onClick={() => { setFilter(''); setPriority('Any'); setAssignee('Anyone'); }}><X size={12}/> Clear</button>}<span className="zy-muted-note">{visible.length} of {items.length}</span></div>}
    <p className="sr-only" aria-live="polite">{announce}</p>
    {view === 'board' && <div className="kanban-board">{COLUMNS.map(col => { const colItems = visible.filter(t => statusOf(t) === col).sort((a, b) => (a.position || 0) - (b.position || 0)); return <div className={`kanban-column ${over === col ? 'zy-drop' : ''}`} key={col} onDragOver={e => { if (!canEdit) return; e.preventDefault(); setOver(col); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }} onDrop={e => { const taskId = e.dataTransfer.getData('text/plain'); setOver(null); setDragging(null); if (taskId) onMove(taskId, col); }}>
      <div className="kanban-column-title"><span>{col}</span><span>{colItems.length}</span></div>{colItems.map(card)}{canEdit && col !== 'Done' && <button className="zy-add-card" onClick={() => onTask(project.name)}><Plus size={11}/> Add</button>}</div>; })}</div>}
    {view === 'list' && <div className="task-page-list">{visible.map(t => <div key={t.id} className={`task-page-row ${statusOf(t) === 'Done' ? 'task-done' : ''}`}><button className="task-check" onClick={() => canEdit && onMove(String(t.id), statusOf(t) === 'Done' ? 'To do' : 'Done')} aria-label={statusOf(t) === 'Done' ? 'Reopen task' : 'Complete task'}>{statusOf(t) === 'Done' && <Check size={12}/>}</button><span onClick={() => onOpenTask(t)}><strong>{t.title}</strong><small>{statusOf(t)}{t.assignee ? ` · ${t.assignee.name}` : ''}</small></span><span className={`priority priority-${t.priority.toLowerCase()}`}/><time className={isOverdue(t) ? 'zy-overdue' : ''}>{shortDate(t.date)}</time></div>)}{!visible.length && <p className="welcome-sub zy-pad">No tasks match.</p>}</div>}
    {view === 'timeline' && <Timeline tasks={visible} onOpen={onOpenTask}/>}
    {view === 'calendar' && <TaskCalendar tasks={visible} onOpen={onOpenTask} canEdit={canEdit}/>}
    {view === 'activity' && <ActivityFeed items={activity}/>}
    {items.length === 0 && view === 'board' && <p className="welcome-sub">No tasks in this project yet. Add one, or import a CSV from Notion, Trello, Linear or Asana.</p>}
    {importing && <Suspense fallback={null}><ImportDialog projectId={String(project.id)} projectName={project.name} onClose={() => setImporting(false)}/></Suspense>}</>;
}

/**
 * Month calendar: tasks sit on their due date. Drag a task to another day to reschedule it
 * (or open it and change the date, which also works from the keyboard).
 */
export function TaskCalendar({ tasks, onOpen, canEdit, showProject = false }: { tasks: Task[]; onOpen: (t: Task) => void; canEdit: boolean; showProject?: boolean }) {
  const today = localDate();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [year, mon] = month.split('-').map(Number);
  const first = new Date(year, mon - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first weeks
  const daysInMonth = new Date(year, mon, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const days = Array.from({ length: cells }, (_, i) => localDate(new Date(year, mon - 1, 1 - lead + i)));
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) if (isDate(t.date)) map.set(t.date, [...(map.get(t.date) || []), t]);
    return map;
  }, [tasks]);
  const inMonth = tasks.filter(t => t.date?.startsWith(month)).length;
  const undated = tasks.filter(t => !isDate(t.date) && statusOf(t) !== 'Done');
  const shift = (delta: number) => setMonth(localDate(new Date(year, mon - 1 + delta, 1)).slice(0, 7));
  const reschedule = async (id: string, date: string) => {
    const task = tasks.find(t => String(t.id) === id);
    if (!task || task.date === date) return;
    setError('');
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: { date } }); window.dispatchEvent(new CustomEvent('zynckle:workspace-changed')); }
    catch (e) { setError(errorMessage(e, 'The task could not be rescheduled')); }
  };
  const drag = (t: Task) => (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; };
  const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(first);
  return <div className="zy-calendar">
    <div className="zy-cal-head">
      <div className="zy-cal-nav"><button className="icon-button" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={15}/></button><h3 aria-live="polite">{label}</h3><button className="icon-button" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={15}/></button>
        {month !== today.slice(0, 7) && <button className="text-button" onClick={() => setMonth(today.slice(0, 7))}>Today</button>}</div>
      <span className="zy-muted-note">{inMonth} task{inMonth === 1 ? '' : 's'} due this month{canEdit ? ' · drag to reschedule' : ''}</span>
    </div>
    {error && <p className="zy-inline-error" role="alert">{error}</p>}
    <div className="zy-cal-scroll"><div className="zy-cal-grid" role="grid" aria-label={`Tasks in ${label}`}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="zy-cal-dow" role="columnheader">{d}</div>)}
      {days.map(day => {
        const list = byDay.get(day) || [];
        return <div key={day} role="gridcell" aria-label={`${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} task${list.length === 1 ? '' : 's'}`}
          className={`zy-cal-day ${day.startsWith(month) ? '' : 'outside'} ${day === today ? 'today' : ''} ${over === day ? 'zy-drop' : ''}`}
          onDragOver={e => { if (!canEdit) return; e.preventDefault(); setOver(day); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
          onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) reschedule(id, day); }}>
          <span className="zy-cal-num">{Number(day.slice(8))}</span>
          {list.slice(0, 4).map(t => <button key={t.id} draggable={canEdit} onDragStart={drag(t)}
            className={`zy-cal-task zy-priority-${t.priority.toLowerCase()} ${statusOf(t) === 'Done' ? 'done' : isOverdue(t) ? 'late' : ''}`} onClick={() => onOpen(t)} title={`${t.title}${showProject ? ` · ${t.project}` : ''} · ${statusOf(t)}`}>
            <span>{t.title}</span></button>)}
          {list.length > 4 && <button className="zy-cal-more" onClick={() => onOpen(list[4])}>+{list.length - 4} more</button>}
        </div>;
      })}
    </div></div>
    {undated.length > 0 && <div className="zy-tl-undated"><div className="eyebrow">UNSCHEDULED · {undated.length}{canEdit ? ' · drag onto a day' : ''}</div>{undated.map(t => <button key={t.id} draggable={canEdit} onDragStart={drag(t)} onClick={() => onOpen(t)}>{t.title}<small>{statusOf(t)}</small></button>)}</div>}
  </div>;
}

/** Day-ruler timeline: each dated task becomes a bar from its creation to its due date. */
function Timeline({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const DAY = 86_400_000;
  const toDay = (v: string) => Math.floor(Date.parse(`${v.slice(0, 10)}T12:00:00`) / DAY);
  const today = toDay(localDate());
  const dated = tasks.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  const undated = tasks.filter(t => !/^\d{4}-\d{2}-\d{2}$/.test(t.date));
  const start = Math.min(today - 3, ...dated.map(t => toDay(t.date) - 2));
  const end = Math.max(today + 17, ...dated.map(t => toDay(t.date) + 2));
  const span = Math.min(56, end - start + 1);
  const days = Array.from({ length: span }, (_, i) => new Date((start + i) * DAY));
  const col = (day: number) => Math.max(1, Math.min(span, day - start + 1));
  return <div className="zy-timeline">
    <div className="zy-tl-scroll"><div className="zy-tl-grid" style={{ gridTemplateColumns: `repeat(${span}, minmax(30px, 1fr))` }}>
      {days.map((d, i) => <div key={i} className={`zy-tl-day ${start + i === today ? 'today' : ''} ${[0, 6].includes(d.getUTCDay()) ? 'weekend' : ''}`} style={{ gridColumn: i + 1 }}><span>{d.getUTCDate() === 1 || i === 0 ? new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(d) : ''}</span><strong>{d.getUTCDate()}</strong></div>)}
      {dated.map((t, row) => {
        const due = toDay(t.date);
        const from = Math.max(start, Math.min(due, t.createdAt ? toDay(localDate(t.createdAt)) : due));
        return <button key={t.id} className={`zy-tl-bar ${statusOf(t) === 'Done' ? 'done' : due < today ? 'late' : ''} zy-priority-${t.priority.toLowerCase()}`} style={{ gridColumn: `${col(from)} / ${col(due) + 1}`, gridRow: row + 2 }} onClick={() => onOpen(t)} title={`${t.title} · due ${t.date}`}><span>{t.title}</span></button>;
      })}
      <i className="zy-tl-now" style={{ gridColumn: col(today), gridRow: `1 / ${dated.length + 3}` }} aria-hidden="true"/>
    </div></div>
    {!dated.length && <p className="inline-empty">Give tasks a due date to place them on the timeline.</p>}
    {undated.length > 0 && <div className="zy-tl-undated"><div className="eyebrow">UNSCHEDULED · {undated.length}</div>{undated.map(t => <button key={t.id} onClick={() => onOpen(t)}>{t.title}<small>{statusOf(t)}</small></button>)}</div>}
  </div>;
}

export function ActivityFeed({ items, compact = false }: { items: ActivityItem[] | null; compact?: boolean }) {
  if (items === null) return <div className="zy-skeleton-rows small"><i/><i/><i/></div>;
  if (!items.length) return <p className="inline-empty">No activity yet. Changes from your team will appear here as they happen.</p>;
  return <ol className={`zy-activity ${compact ? 'compact' : ''}`}>{items.map(a => <li key={a.id}><span className="avatar avatar-self">{a.actor.avatar}</span><p><strong>{a.actor.name}</strong> {a.verb} {a.summary && <em>{a.summary}</em>}</p><time>{timeAgo(a.createdAt)}</time></li>)}</ol>;
}

export function Tasks({ tasks, search, onToggle, onDelete, onOpen, onNew, accountId, canEdit, onSeedWorkspace }: { tasks: Task[]; search: string; onToggle: (id: string | number) => void; onDelete: (id: string | number) => void; onOpen: (task: Task) => void; onNew: () => void; accountId?: string; canEdit: boolean; onSeedWorkspace?: () => void }) {
  const [scope, setScope] = useState<'mine' | 'all'>(() => (localStorage.getItem('zynckle-task-scope') as 'mine' | 'all') || 'all');
  const [state, setState] = useState<'open' | 'done' | 'all'>('open');
  const [sort, setSort] = useState<'due' | 'priority' | 'recent'>('due');
  const [layout, setLayout] = useState<'list' | 'calendar'>(() => localStorage.getItem('zynckle-task-layout') === 'calendar' ? 'calendar' : 'list');
  useEffect(() => { localStorage.setItem('zynckle-task-scope', scope); }, [scope]);
  useEffect(() => { localStorage.setItem('zynckle-task-layout', layout); }, [layout]);
  const rank: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
  const visible = tasks.filter(t => `${t.title} ${t.project}`.toLowerCase().includes(search.trim().toLowerCase()) && (scope === 'all' || t.assigneeId === accountId) && (state === 'all' || (state === 'done' ? statusOf(t) === 'Done' : statusOf(t) !== 'Done')))
    .sort((a, b) => sort === 'priority' ? (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) : sort === 'recent' ? String(b.createdAt || '').localeCompare(String(a.createdAt || '')) : (/^\d/.test(a.date) ? a.date : '9999').localeCompare(/^\d/.test(b.date) ? b.date : '9999'));
  const open = visible.filter(t => !t.done && statusOf(t) !== 'Done').length;
  return <><section className="welcome-row subpage-welcome"><div><div className="eyebrow">A CLEAR NEXT STEP</div><h1>Your tasks, <em>in focus.</em></h1><p className="welcome-sub">Small steps make room for the bigger things.</p></div>{canEdit && <div style={{ display: 'flex', gap: '10px' }}>{onSeedWorkspace && !tasks.length && <button className="button-secondary" onClick={onSeedWorkspace}><Sparkles size={16}/> Seed starter data</button>}<button className="button-primary" onClick={onNew}><Plus size={16}/> New task</button></div>}</section>
    <div className="section-heading"><div><div className="eyebrow">{open} OPEN · {visible.length - open} COMPLETE</div><h2>{scope === 'mine' ? 'Assigned to me' : 'Today & coming up'}</h2></div>
      <div className="zy-filter-row"><div className="zy-segmented small"><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Everyone</button><button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>Mine</button></div>
        <div className="zy-segmented small"><button className={state === 'open' ? 'active' : ''} onClick={() => setState('open')}>Open</button><button className={state === 'done' ? 'active' : ''} onClick={() => setState('done')}>Done</button><button className={state === 'all' ? 'active' : ''} onClick={() => setState('all')}>All</button></div>
        <div className="zy-segmented small" role="tablist" aria-label="Layout"><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><List size={12}/> List</button><button className={layout === 'calendar' ? 'active' : ''} onClick={() => setLayout('calendar')}><CalendarDays size={12}/> Calendar</button></div>
        <select className="zy-select-sm" value={sort} onChange={e => setSort(e.target.value as 'due')} aria-label="Sort tasks"><option value="due">By due date</option><option value="priority">By priority</option><option value="recent">Recently added</option></select></div></div>
    {layout === 'calendar' && visible.length > 0 && <TaskCalendar tasks={visible} onOpen={onOpen} canEdit={canEdit} showProject/>}
    <div className="task-page-list" hidden={layout === 'calendar' && visible.length > 0}>{visible.map(t => <div key={t.id} className={`task-page-row ${t.done ? 'task-done' : ''}`}><button className="task-check" onClick={() => onToggle(t.id)} aria-label={t.done ? 'Reopen task' : 'Complete task'} disabled={!canEdit}>{t.done && <Check size={12}/>}</button><span onClick={() => onOpen(t)}><strong>{t.title}</strong><small>{t.project} · {statusOf(t)}{t.assignee ? ` · ${t.assignee.name}` : ''}</small></span><span className={`priority priority-${t.priority.toLowerCase()}`} title={`${t.priority} priority`}/><time className={isOverdue(t) ? 'zy-overdue' : ''}>{shortDate(t.date)}</time><button className="text-button" onClick={() => onOpen(t)}><MessageSquare size={12}/>{t.commentCount ? ` ${t.commentCount}` : ''}</button>{canEdit && <button className="icon-button danger" onClick={() => onDelete(t.id)} aria-label={`Delete ${t.title}`} title="Delete task"><Trash2 size={14}/></button>}</div>)}
      {!visible.length && <div className="empty-state"><Check size={23}/><h3>{search ? 'No tasks match your search' : scope === 'mine' ? 'Nothing assigned to you' : 'A little breathing room'}</h3><p>{search ? 'Try another title or project.' : 'Tasks from your projects will show up here.'}</p>{!search && canEdit && <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}><button className="button-primary" onClick={onNew}><Plus size={15}/> Add a task</button>{onSeedWorkspace && <button className="button-secondary" onClick={onSeedWorkspace}><Sparkles size={15}/> Load Starter Projects & Tasks</button>}</div>}</div>}</div></>;
}

type Comment = { id: string; author: string; body: string; createdAt: string; mine?: boolean };

/** Slide-over task editor with comments; replaces separate edit/comment modals. */
export function TaskDrawer({ task, onClose, onSave, onDelete, canEdit }: { task: Task; onClose: () => void; onSave: (id: string | number, values: Record<string, unknown>) => Promise<boolean>; onDelete: (id: string | number) => void; canEdit: boolean }) {
  const members = useMembers();
  const [values, setValues] = useState({ title: task.title, description: task.description || '', status: statusOf(task), priority: task.priority, date: /^\d{4}-\d{2}-\d{2}$/.test(task.date) ? task.date : '', assigneeId: task.assigneeId || '' });
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = values.title !== task.title || values.description !== (task.description || '') || values.status !== statusOf(task) || values.priority !== task.priority || values.date !== (/^\d{4}-\d{2}-\d{2}$/.test(task.date) ? task.date : '') || values.assigneeId !== (task.assigneeId || '');
  useEffect(() => { api<Comment[]>(`/api/tasks/${task.id}/comments`).then(setComments).catch(() => setComments([])); }, [task.id]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  useRealtimeEvent('comment.added', (data: { taskId: string; comment: Comment }) => { if (data.taskId === task.id) setComments(list => list && !list.some(c => c.id === data.comment.id) ? [...list, data.comment] : list); });
  const save = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); const ok = await onSave(task.id, { ...values, title: values.title.trim(), date: values.date || 'No date', assigneeId: values.assigneeId || null }); setSaving(false); if (ok) onClose(); };
  const comment = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try { const c = await api<Comment>(`/api/tasks/${task.id}/comments`, { body: { body } }); setComments(list => [...(list || []).filter(x => x.id !== c.id), c]); setBody(''); }
    catch (x) { setError(errorMessage(x, 'Could not post comment')); }
  };
  const removeComment = async (c: Comment) => { try { await api(`/api/comments/${c.id}`, { method: 'DELETE' }); setComments(list => (list || []).filter(x => x.id !== c.id)); } catch (x) { setError(errorMessage(x)); } };
  return <div className="assistant-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><aside className="assistant-panel zy-task-drawer" role="dialog" aria-modal="true" aria-label="Task details">
    <header><span><Check size={16}/> {task.project}</span><div className="zy-head-actions"><NavLink className="icon-button" to={`/ai?project=${task.projectId || ''}&prompt=${encodeURIComponent(`Help me with the task "${task.title}": what are the next steps, risks and anything related in the workspace?`)}`} onClick={onClose} aria-label="Ask Zynckle AI about this task" title="Ask AI about this task"><Sparkles size={15}/></NavLink>{canEdit && <button className="icon-button danger" onClick={() => { onDelete(task.id); onClose(); }} aria-label="Delete task" title="Delete task"><Trash2 size={15}/></button>}<button className="icon-button" onClick={onClose} aria-label="Close task"><X size={17}/></button></div></header>
    <div className="zy-drawer-body">
      <form onSubmit={save} className="zy-task-form">
        <textarea className="zy-task-title" value={values.title} onChange={e => setValues(v => ({ ...v, title: e.target.value }))} rows={2} maxLength={160} required aria-label="Task title" readOnly={!canEdit}/>
        <div className="zy-props">
          <label><span>Status</span><select value={values.status} onChange={e => setValues(v => ({ ...v, status: e.target.value }))} disabled={!canEdit}>{COLUMNS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label><span>Priority</span><select value={values.priority} onChange={e => setValues(v => ({ ...v, priority: e.target.value }))} disabled={!canEdit}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
          <label><span><User size={11}/> Assignee</span><select value={values.assigneeId} onChange={e => setValues(v => ({ ...v, assigneeId: e.target.value }))} disabled={!canEdit}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label><span><Calendar size={11}/> Due date</span><input type="date" value={values.date} onChange={e => setValues(v => ({ ...v, date: e.target.value }))} disabled={!canEdit}/></label>
        </div>
        <label className="zy-field">Description<textarea rows={5} value={values.description} onChange={e => setValues(v => ({ ...v, description: e.target.value }))} maxLength={5000} placeholder="Add context or a definition of done" readOnly={!canEdit}/></label>
        {canEdit && <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Close</button><button className="button-primary" disabled={!dirty || saving || !values.title.trim()}><Save size={14}/> {saving ? 'Saving…' : 'Save changes'}</button></div>}
      </form>
      <section className="zy-task-comments"><div className="eyebrow">DISCUSSION · {comments?.length ?? '—'}</div>
        <div className="comment-list">{comments?.map(c => <article key={c.id}><strong>{c.author}</strong><small>{timeAgo(c.createdAt)}</small>{c.mine && <button className="tiny-icon danger" onClick={() => removeComment(c)} aria-label="Delete comment"><Trash2 size={11}/></button>}<p>{c.body}</p></article>)}{comments?.length === 0 && <p className="welcome-sub">No comments yet. Use @name to mention a teammate.</p>}</div>
        {error && <p className="auth-error">{error}</p>}
        {canEdit && <form onSubmit={comment} className="zy-comment-form"><textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write a comment… @name to mention" maxLength={5000} rows={3} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) comment(e); }} aria-label="New comment"/><button className="button-primary" disabled={!body.trim()}><ArrowRight size={13}/> Comment</button></form>}
      </section>
    </div>
  </aside></div>;
}
