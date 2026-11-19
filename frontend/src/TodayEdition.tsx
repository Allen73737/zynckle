import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Feather,
  LoaderCircle,
  Plus,
  ShieldAlert,
  Sparkles,
  Square,
  Users,
  Zap
} from 'lucide-react';
import { api, errorMessage, streamAI, timeAgo } from './lib/api';
import { statusOf, type ActivityItem, type Project, type Task } from './ProjectViews';

const Markdown = lazy(() => import('./Markdown'));
const rank: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

type TaskFilter = 'all' | 'dueToday' | 'overdue' | 'urgent' | 'done';

export default function TodayEdition({
  tasks,
  projects,
  accountId,
  accountName,
  workspace,
  onToggle,
  onOpenTask,
  onCapture,
  canEdit,
  onTaskCreated,
  onSeedWorkspace
}: {
  tasks: Task[];
  projects: Project[];
  accountId?: string;
  accountName: string;
  workspace: string;
  onToggle: (id: string | number) => void;
  onOpenTask: (t: Task) => void;
  onCapture: () => void;
  canEdit: boolean;
  onTaskCreated?: (t: Task) => void;
  onSeedWorkspace?: () => void;
}) {
  const [scope, setScope] = useState<'mine' | 'all'>(() => (localStorage.getItem('zynckle-edition-scope') as 'mine' | 'all') || 'mine');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [note, setNote] = useState('');
  const [writing, setWriting] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Inline Task Creator State
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProject, setNewProject] = useState(() => projects[0]?.name || 'General');
  const [newPriority, setNewPriority] = useState<'Urgent' | 'High' | 'Normal' | 'Low'>('Normal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { localStorage.setItem('zynckle-edition-scope', scope); }, [scope]);
  useEffect(() => {
    api<ActivityItem[]>('/api/activity?limit=40').then(setActivity).catch(() => setActivity([]));
    api<{ available: boolean }>('/api/ai/status').then(s => setAiAvailable(s.available)).catch(() => {});
  }, []);

  useEffect(() => {
    if (projects.length > 0 && !projects.some(p => p.name === newProject)) {
      setNewProject(projects[0].name);
    }
  }, [projects, newProject]);

  // Global Keyboard shortcut 'n' to trigger inline task creator
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !(e.target as HTMLElement)?.isContentEditable) {
          e.preventDefault();
          setIsCreating(true);
        }
      } else if (e.key === 'Escape' && isCreating) {
        setIsCreating(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCreating]);

  useEffect(() => {
    if (isCreating) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCreating]);

  const today = iso(new Date());
  const now = new Date();

  // Tasks in scope
  const scopedTasks = useMemo(() => {
    return tasks.filter(t => scope === 'all' || t.assigneeId === accountId);
  }, [tasks, scope, accountId]);

  const openTasks = useMemo(() => scopedTasks.filter(t => statusOf(t) !== 'Done'), [scopedTasks]);
  const datedTasks = useMemo(() => scopedTasks.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date)), [scopedTasks]);
  
  const overdue = useMemo(() => {
    return openTasks.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date < today).sort((a, b) => a.date.localeCompare(b.date));
  }, [openTasks, today]);

  const dueToday = useMemo(() => {
    return openTasks.filter(t => t.date === today).sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  }, [openTasks, today]);

  const urgentTasks = useMemo(() => {
    return openTasks.filter(t => t.priority === 'Urgent' || t.priority === 'High').sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  }, [openTasks]);

  const inReview = useMemo(() => openTasks.filter(t => statusOf(t) === 'In review'), [openTasks]);

  const completedToday = useMemo(() => {
    return scopedTasks.filter(t => {
      if (statusOf(t) !== 'Done') return false;
      const updatedStr = String((t as Task & { updatedAt?: string }).updatedAt || '').slice(0, 10);
      return t.date === today || updatedStr === today;
    });
  }, [scopedTasks, today]);

  const weekAgo = iso(dayOffset(-7));
  const doneThisWeek = useMemo(() => {
    return scopedTasks.filter(t => {
      if (statusOf(t) !== 'Done') return false;
      const updatedStr = String((t as Task & { updatedAt?: string }).updatedAt || '').slice(0, 10);
      return updatedStr >= weekAgo || t.date >= weekAgo;
    }).length;
  }, [scopedTasks, weekAgo]);

  // Lead Focus Task
  const lead = [...overdue, ...dueToday, ...urgentTasks].sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))[0] || openTasks[0];
  const leadKicker = !lead
    ? ''
    : /^\d{4}/.test(lead.date) && lead.date < today
    ? `OVERDUE · ${daysBetween(lead.date, today)} DAY${daysBetween(lead.date, today) === 1 ? '' : 'S'} LATE`
    : lead.date === today
    ? 'DUE TODAY'
    : `${lead.priority.toUpperCase()} PRIORITY`;

  // 7-day Horizon
  const horizon = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = dayOffset(i + 1);
      const key = iso(d);
      return {
        key,
        label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(d),
        day: d.getDate(),
        items: datedTasks.filter(t => statusOf(t) !== 'Done' && t.date === key)
      };
    });
  }, [datedTasks]);

  // Today Progress Metrics
  const todayPool = useMemo(() => {
    const map = new Map<string | number, Task>();
    [...dueToday, ...overdue, ...completedToday].forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [dueToday, overdue, completedToday]);

  const completedCount = completedToday.length;
  const totalTodayCount = todayPool.length || dueToday.length + completedCount;
  const completionPercentage = totalTodayCount > 0 ? Math.round((completedCount / totalTodayCount) * 100) : 100;

  // Filtered Task Display
  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'dueToday':
        return dueToday;
      case 'overdue':
        return overdue;
      case 'urgent':
        return urgentTasks;
      case 'done':
        return completedToday;
      case 'all':
      default: {
        // All active tasks for today: overdue first, then today's tasks, then any high priority
        const combined = new Map<string | number, Task>();
        overdue.forEach(t => combined.set(t.id, t));
        dueToday.forEach(t => combined.set(t.id, t));
        urgentTasks.forEach(t => combined.set(t.id, t));
        completedToday.forEach(t => combined.set(t.id, t));
        if (combined.size === 0) {
          openTasks.slice(0, 8).forEach(t => combined.set(t.id, t));
        }
        return Array.from(combined.values());
      }
    }
  }, [filter, dueToday, overdue, urgentTasks, completedToday, openTasks]);

  const overnight = (activity || []).filter(a => Date.now() - Date.parse(a.createdAt) < 18 * 3600_000 && a.actor.id !== accountId);
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateFormatted = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now).toUpperCase();

  const writeNote = async () => {
    setNote(''); setNoteError(''); setWriting(true);
    abort.current = new AbortController();
    const brief = [
      `Write today's executive daily brief for ${accountName.split(' ')[0]}: three to five short, direct sentences in modern crisp prose.`,
      'Prioritise what matters most today, flag any risks, and suggest one concrete first move. Use only these facts:',
      `Overdue: ${overdue.map(t => `${t.title} (${t.project}, due ${t.date})`).join('; ') || 'none'}`,
      `Due today: ${dueToday.map(t => `${t.title} (${t.priority})`).join('; ') || 'none'}`,
      `Awaiting review: ${inReview.map(t => t.title).join('; ') || 'none'}`,
      `Next 7 days: ${horizon.flatMap(h => h.items.map(t => `${t.title} on ${h.label}`)).join('; ') || 'nothing scheduled'}`,
      `Projects: ${projects.map(p => `${p.name} ${p.progress}%`).join(', ') || 'none'}`,
    ].join('\n');
    try {
      await streamAI({ messages: [{ role: 'user', content: brief }], mode: 'general' }, { signal: abort.current.signal, onDelta: d => setNote(n => n + d) });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNoteError(errorMessage(e));
    } finally {
      setWriting(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    try {
      let targetProj = projects.find(p => p.name === newProject) || projects[0];
      if (!targetProj) {
        targetProj = await api<Project>('/api/projects', {
          body: { name: newProject || 'General', description: 'Workspace project' }
        });
      }
      const saved = await api<Task>(`/api/projects/${targetProj.id}/tasks`, {
        body: {
          title: trimmed,
          priority: newPriority,
          date: today,
          status: 'To do',
          assigneeId: scope === 'mine' ? accountId : undefined
        }
      });
      onTaskCreated?.(saved);
      setNewTitle('');
      setIsCreating(false);
    } catch (err) {
      console.error('Failed to create task', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dashboard-root today-edition-root">
      {/* Uniform Hero Header */}
      <section className="dashboard-hero">
        <div className="hero-left">
          <div className="hero-eyebrow-row">
            <span className="eyebrow">{dateFormatted}</span>
            <span className="hero-live-badge"><span className="pulse-dot" /> {workspace}</span>
          </div>
          <h1 className="hero-title">
            The Daily <em>Agenda</em>.
          </h1>
          <p className="welcome-sub">
            {overdue.length > 0 ? (
              <span className="text-attention">
                <ShieldAlert size={16} /> {overdue.length} task{overdue.length === 1 ? ' is' : 's are'} past due.
                {dueToday.length > 0 && ` Also ${dueToday.length} scheduled for today.`}
              </span>
            ) : dueToday.length > 0 ? (
              <span>{greeting}, {accountName.split(' ')[0]}. You have {dueToday.length} task{dueToday.length === 1 ? '' : 's'} scheduled for today.</span>
            ) : (
              <span>{greeting}, {accountName.split(' ')[0]}. Your desk is clear today. All deliverables and milestones are on track.</span>
            )}
          </p>
        </div>

        <div className="hero-actions">
          <div className="zy-segmented">
            <button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>My desk</button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Whole workspace</button>
          </div>
          {canEdit && (
            <button className="button-primary hero-btn" onClick={onCapture}>
              <Zap size={16} /> Quick capture <kbd className="zy-kbd">C</kbd>
            </button>
          )}
          <button
            className="button-secondary hero-btn"
            onClick={writeNote}
            disabled={writing || !aiAvailable}
            title={aiAvailable ? 'Generate an AI summary of today’s priorities' : 'AI provider not configured'}
          >
            {writing ? <LoaderCircle size={16} className="spin" /> : <Feather size={16} />}
            <span>{writing ? 'Briefing…' : note ? 'Rewrite brief' : 'AI Daily brief'}</span>
          </button>
        </div>
      </section>

      {/* Uniform Metrics Grid */}
      <section className="dashboard-metrics metrics-grid">
        <div className="metric-card" onClick={() => setFilter('dueToday')} style={{ cursor: 'pointer' }}>
          <span className="metric-eyebrow">DUE TODAY</span>
          <div className="metric-value-row">
            <span className="metric-num">{dueToday.length}</span>
            <Clock size={20} className="metric-icon" />
          </div>
          <span className="metric-sub">Scheduled for today</span>
        </div>

        <div
          className={`metric-card ${overdue.length > 0 ? 'metric-card-attention' : ''}`}
          onClick={() => setFilter('overdue')}
          style={{ cursor: 'pointer' }}
        >
          <span className="metric-eyebrow">OVERDUE</span>
          <div className="metric-value-row">
            <span className="metric-num">{overdue.length}</span>
            <ShieldAlert size={20} className="metric-icon" />
          </div>
          <span className="metric-sub">{overdue.length === 0 ? 'All deadlines met' : 'Needs attention'}</span>
        </div>

        <div className="metric-card">
          <span className="metric-eyebrow">IN REVIEW</span>
          <div className="metric-value-row">
            <span className="metric-num">{inReview.length}</span>
            <Calendar size={20} className="metric-icon" />
          </div>
          <span className="metric-sub">Awaiting verification</span>
        </div>

        <div className="metric-card" onClick={() => setFilter('done')} style={{ cursor: 'pointer' }}>
          <span className="metric-eyebrow">SHIPPED THIS WEEK</span>
          <div className="metric-value-row">
            <span className="metric-num">{doneThisWeek}</span>
            <CheckCircle2 size={20} className="metric-icon" />
          </div>
          <span className="metric-sub">Completed milestones</span>
        </div>
      </section>

      {/* Uniform Content Grid */}
      <div className="content-grid">
        {/* Left Primary Column */}
        <div className="main-col">
          {/* Daily Completion Progress Bar */}
          <section className="dashboard-panel today-progress-panel">
            <div className="today-progress-stats">
              <div className="today-progress-headline">
                <CheckCircle2 size={18} className="today-progress-icon" />
                <span className="today-progress-label">Today's Execution Velocity</span>
              </div>
              <span className="today-progress-ratio">
                <strong>{completedCount}</strong> of <strong>{totalTodayCount}</strong> tasks complete ({completionPercentage}%)
              </span>
            </div>
            <div className="today-progress-track">
              <div
                className="today-progress-fill"
                style={{ width: `${Math.max(4, completionPercentage)}%` }}
              />
            </div>
          </section>

          {/* Top Priority Hero Card */}
          {lead ? (
            <div className="hero-project-card">
              <div className="hero-project-top">
                <span className="hero-tag-kicker">{leadKicker}</span>
                <span className={`project-pill ${lead.priority.toLowerCase()}`}>{lead.priority}</span>
              </div>
              <h2 className="hero-project-name" onClick={() => onOpenTask(lead)} style={{ cursor: 'pointer' }}>
                {lead.title}
              </h2>
              <p className="hero-project-desc">
                {lead.description?.trim()
                  ? lead.description
                  : `Filed under ${lead.project}. ${lead.assignee ? `Assigned to ${lead.assignee.name}.` : 'Currently unassigned.'}`}
              </p>
              <div className="hero-project-foot">
                <div className="hero-project-actions">
                  <button className="button-primary" onClick={() => onOpenTask(lead)}>
                    Open task drawer <ArrowRight size={14} />
                  </button>
                  {canEdit && (
                    <button className="button-secondary" onClick={() => onToggle(lead.id)}>
                      <Check size={14} /> Mark done
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="hero-project-card">
              <span className="hero-tag-kicker">FOCUS</span>
              <h2 className="hero-project-name">A clean desk.</h2>
              <p className="hero-project-desc">
                {scope === 'mine'
                  ? 'Nothing is assigned to you right now. Switch to the whole workspace or capture new tasks.'
                  : 'No open tasks found in this workspace.'}
              </p>
              <div className="hero-project-actions">
                {canEdit && (
                  <button className="button-primary" onClick={onCapture}>
                    <Zap size={14} /> Quick capture a task <kbd className="zy-kbd">C</kbd>
                  </button>
                )}
                {onSeedWorkspace && tasks.length === 0 && (
                  <button className="button-secondary" onClick={onSeedWorkspace}>
                    <Sparkles size={14} /> Seed starter tasks
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Notion-Style Today's Tasks Interactive Panel */}
          <section className="dashboard-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h3 className="panel-title">Tasks for Today</h3>
                <span className="badge-count">{filteredTasks.length}</span>
              </div>
              <NavLink to="/tasks" className="panel-action-link">
                View all tasks <ArrowRight size={13} />
              </NavLink>
            </div>

            {/* Filter Pills */}
            <div className="today-filter-pills">
              <button
                className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All <span>{dueToday.length + overdue.length}</span>
              </button>
              <button
                className={`filter-pill ${filter === 'dueToday' ? 'active' : ''}`}
                onClick={() => setFilter('dueToday')}
              >
                Due Today <span>{dueToday.length}</span>
              </button>
              {overdue.length > 0 && (
                <button
                  className={`filter-pill filter-pill-attention ${filter === 'overdue' ? 'active' : ''}`}
                  onClick={() => setFilter('overdue')}
                >
                  Overdue <span>{overdue.length}</span>
                </button>
              )}
              <button
                className={`filter-pill ${filter === 'urgent' ? 'active' : ''}`}
                onClick={() => setFilter('urgent')}
              >
                High Priority <span>{urgentTasks.length}</span>
              </button>
              <button
                className={`filter-pill ${filter === 'done' ? 'active' : ''}`}
                onClick={() => setFilter('done')}
              >
                Completed <span>{completedToday.length}</span>
              </button>
            </div>

            {/* Notion-Style Inline Task Creator */}
            {canEdit && (
              <div className="today-inline-creator">
                {!isCreating ? (
                  <button
                    className="today-add-task-btn"
                    onClick={() => setIsCreating(true)}
                    type="button"
                  >
                    <Plus size={16} />
                    <span>Add a task for today…</span>
                    <kbd className="zy-kbd">N</kbd>
                  </button>
                ) : (
                  <form className="today-inline-form" onSubmit={handleCreateTask}>
                    <input
                      ref={inputRef}
                      type="text"
                      className="today-inline-input"
                      placeholder="What needs to be accomplished today? (Press Enter to save)"
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                    />
                    <div className="today-inline-controls">
                      <div className="today-inline-selectors">
                        <select
                          className="today-inline-select"
                          value={newProject}
                          onChange={e => setNewProject(e.target.value)}
                        >
                          {projects.map(p => (
                            <option key={p.id} value={p.name}>{p.name}</option>
                          ))}
                          {projects.length === 0 && <option value="General">General</option>}
                        </select>

                        <div className="today-priority-pills">
                          {(['Urgent', 'High', 'Normal', 'Low'] as const).map(p => (
                            <button
                              key={p}
                              type="button"
                              className={`today-priority-pill priority-${p.toLowerCase()} ${newPriority === p ? 'active' : ''}`}
                              onClick={() => setNewPriority(p)}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="today-inline-actions">
                        <button
                          type="button"
                          className="button-secondary btn-sm"
                          onClick={() => { setIsCreating(false); setNewTitle(''); }}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="button-primary btn-sm"
                          disabled={!newTitle.trim() || isSubmitting}
                        >
                          {isSubmitting ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                          <span>Add Task</span>
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Task List */}
            {filteredTasks.length > 0 ? (
              <div className="task-action-list">
                {filteredTasks.map(t => {
                  const isDone = statusOf(t) === 'Done';
                  const isLate = /^\d{4}/.test(t.date) && t.date < today && !isDone;
                  return (
                    <div
                      key={t.id}
                      className={`task-action-row ${isDone ? 'task-done' : ''} ${isLate ? 'task-late' : ''}`}
                    >
                      <button
                        className={`task-checkbox ${isDone ? 'checked' : ''}`}
                        onClick={() => onToggle(t.id)}
                        aria-label={isDone ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`}
                        title={isDone ? 'Mark incomplete' : 'Mark done'}
                      >
                        {isDone && <Check size={13} className="check-icon" />}
                      </button>
                      <div className="task-action-content" onClick={() => onOpenTask(t)} style={{ cursor: 'pointer' }}>
                        <span className="task-action-title">{t.title}</span>
                        <div className="task-action-meta">
                          <span className="task-meta-project">{t.project}</span>
                          {isLate ? (
                            <span className="task-meta-overdue">
                              {daysBetween(t.date, today)}d overdue
                            </span>
                          ) : t.date === today ? (
                            <span className="task-meta-due-today">Due today</span>
                          ) : null}
                          {t.assignee && scope === 'all' && (
                            <span className="task-meta-assignee">· {t.assignee.name}</span>
                          )}
                          <span className={`task-meta-priority priority-${t.priority.toLowerCase()}`}>
                            {t.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="panel-empty-state">
                <p>
                  {filter === 'done'
                    ? 'No tasks completed today yet. Check off items as you finish!'
                    : filter === 'overdue'
                    ? 'Outstanding! Zero overdue tasks.'
                    : 'No tasks matching this filter.'}
                </p>
                {canEdit && (
                  <button className="text-button" onClick={() => setIsCreating(true)}>
                    <Plus size={14} /> Add a task for today
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Running Late Section (if any overdue and not currently on overdue filter) */}
          {overdue.length > 0 && filter !== 'overdue' && (
            <section className="dashboard-panel panel-overdue">
              <div className="panel-header">
                <div className="panel-title-wrap">
                  <h3 className="panel-title text-attention"><ShieldAlert size={16} /> Overdue Tasks</h3>
                  <span className="badge-count badge-attention">{overdue.length}</span>
                </div>
              </div>
              <div className="task-action-list">
                {overdue.slice(0, 6).map(t => (
                  <div key={t.id} className="task-action-row task-late">
                    <button
                      className="task-checkbox"
                      onClick={() => onToggle(t.id)}
                      aria-label={`Mark ${t.title} complete`}
                      title="Mark done"
                    >
                      <Check size={13} className="check-icon" />
                    </button>
                    <div className="task-action-content" onClick={() => onOpenTask(t)} style={{ cursor: 'pointer' }}>
                      <span className="task-action-title">{t.title}</span>
                      <div className="task-action-meta">
                        <span className="task-meta-project">{t.project}</span>
                        <span className="task-meta-overdue">{daysBetween(t.date, today)}d overdue</span>
                        <span className={`task-meta-priority priority-${t.priority.toLowerCase()}`}>
                          {t.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 7-Day Horizon Week Ahead */}
          <section className="dashboard-panel">
            <div className="panel-header">
              <h3 className="panel-title">The Week Ahead</h3>
            </div>
            <div className="today-horizon-grid">
              {horizon.map(h => (
                <div key={h.key} className={`horizon-day-col ${h.items.length ? 'has-items' : ''}`}>
                  <span className="horizon-weekday">{h.label}</span>
                  <strong className="horizon-date-num">{h.day}</strong>
                  {h.items.length > 0 ? (
                    <div className="horizon-items-list">
                      {h.items.slice(0, 2).map(t => (
                        <button key={t.id} className="horizon-item-pill" onClick={() => onOpenTask(t)} title={t.title}>
                          {t.title}
                        </button>
                      ))}
                      {h.items.length > 2 && (
                        <span className="horizon-more-tag">+{h.items.length - 2}</span>
                      )}
                    </div>
                  ) : (
                    <span className="horizon-free-dot" title="No tasks scheduled" />
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Secondary Rail */}
        <aside className="side-rail">
          {/* AI Executive Daily Brief Card */}
          <div className="rail-panel">
            <div className="rail-panel-head">
              <span className="rail-panel-title">
                <Sparkles size={16} /> Executive Daily Brief
              </span>
              {writing ? (
                <button className="tiny-icon" onClick={() => abort.current?.abort()} title="Stop generation">
                  <Square size={13} />
                </button>
              ) : (
                <button
                  className="tiny-icon"
                  onClick={writeNote}
                  disabled={!aiAvailable}
                  title="Regenerate note"
                >
                  <Feather size={13} />
                </button>
              )}
            </div>

            <div className="rail-panel-body">
              {note ? (
                <div className="today-brief-content">
                  <Suspense fallback={<p>{note}</p>}>
                    <Markdown source={note} streaming={writing} />
                  </Suspense>
                </div>
              ) : (
                <div className="today-brief-placeholder">
                  <p>
                    {aiAvailable
                      ? 'Click the button below to generate a concise, AI-powered summary of what needs your immediate attention today.'
                      : 'An AI executive briefing appears here once an AI provider key is configured.'}
                  </p>
                  {aiAvailable && (
                    <button className="button-secondary hero-btn" onClick={writeNote} disabled={writing}>
                      <Feather size={14} /> Generate briefing
                    </button>
                  )}
                </div>
              )}
              {noteError && <p className="auth-error">{noteError}</p>}
            </div>
          </div>

          {/* Overnight Teammate Changes */}
          <div className="rail-panel">
            <div className="rail-panel-head">
              <span className="rail-panel-title">
                <Users size={16} /> Team Updates
              </span>
              <NavLink to="/team" className="panel-action-link">
                View all <ArrowRight size={12} />
              </NavLink>
            </div>
            <div className="rail-panel-body">
              {activity === null ? (
                <div className="zy-skeleton-rows small"><i /><i /></div>
              ) : overnight.length > 0 ? (
                <div className="today-activity-list">
                  {overnight.slice(0, 6).map(a => (
                    <div key={a.id} className="today-activity-item">
                      <div className="activity-actor-avatar">
                        {a.actor.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="activity-item-content">
                        <p><strong>{a.actor.name}</strong> {a.verb} {a.summary && <em>“{a.summary}”</em>}</p>
                        <time>{timeAgo(a.createdAt)}</time>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="zy-ed-quiet">No changes recorded from teammates in the last 18 hours.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
