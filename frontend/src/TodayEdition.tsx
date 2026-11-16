import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowRight, Calendar, Check, CheckCircle2, Clock, Feather, LoaderCircle, ShieldAlert, Sparkles, Square, Users, Zap } from 'lucide-react';
import { api, errorMessage, streamAI, timeAgo } from './lib/api';
import { statusOf, type ActivityItem, type Project, type Task } from './ProjectViews';

const Markdown = lazy(() => import('./Markdown'));
const rank: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

export default function TodayEdition({
  tasks,
  projects,
  accountId,
  accountName,
  workspace,
  onToggle,
  onOpenTask,
  onCapture,
  canEdit
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
}) {
  const [scope, setScope] = useState<'mine' | 'all'>(() => (localStorage.getItem('zynckle-edition-scope') as 'mine' | 'all') || 'mine');
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [note, setNote] = useState('');
  const [writing, setWriting] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { localStorage.setItem('zynckle-edition-scope', scope); }, [scope]);
  useEffect(() => {
    api<ActivityItem[]>('/api/activity?limit=40').then(setActivity).catch(() => setActivity([]));
    api<{ available: boolean }>('/api/ai/status').then(s => setAiAvailable(s.available)).catch(() => {});
  }, []);

  const today = iso(new Date());
  const now = new Date();
  const open = useMemo(() => tasks.filter(t => statusOf(t) !== 'Done' && (scope === 'all' || t.assigneeId === accountId)), [tasks, scope, accountId]);
  const dated = open.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date));
  const overdue = dated.filter(t => t.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const dueToday = dated.filter(t => t.date === today).sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  const inReview = open.filter(t => statusOf(t) === 'In review');
  const weekAgo = iso(dayOffset(-7));
  const doneThisWeek = tasks.filter(t => statusOf(t) === 'Done' && (scope === 'all' || t.assigneeId === accountId) && String((t as Task & { updatedAt?: string }).updatedAt || '').slice(0, 10) >= weekAgo).length;

  const lead = [...overdue, ...dueToday, ...open.filter(t => t.priority === 'Urgent' || t.priority === 'High')].sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))[0] || open[0];
  const leadKicker = !lead ? '' : /^\d{4}/.test(lead.date) && lead.date < today ? `OVERDUE · ${daysBetween(lead.date, today)} DAY${daysBetween(lead.date, today) === 1 ? '' : 'S'} LATE` : lead.date === today ? 'DUE TODAY' : `${lead.priority.toUpperCase()} PRIORITY`;

  const horizon = Array.from({ length: 7 }, (_, i) => {
    const d = dayOffset(i + 1);
    const key = iso(d);
    return { key, label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(d), day: d.getDate(), items: dated.filter(t => t.date === key) };
  });

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
        <div className="metric-card">
          <span className="metric-eyebrow">DUE TODAY</span>
          <div className="metric-value-row">
            <span className="metric-num">{dueToday.length}</span>
            <Clock size={20} className="metric-icon" />
          </div>
          <span className="metric-sub">Scheduled for today</span>
        </div>

        <div className={`metric-card ${overdue.length > 0 ? 'metric-card-attention' : ''}`}>
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

        <div className="metric-card">
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
              {canEdit && (
                <button className="button-primary" onClick={onCapture}>
                  <Zap size={14} /> Quick capture a task <kbd className="zy-kbd">C</kbd>
                </button>
              )}
            </div>
          )}

          {/* Today's Tasks List Panel */}
          <section className="dashboard-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h3 className="panel-title">Tasks for Today</h3>
                <span className="badge-count">{dueToday.length}</span>
              </div>
              <NavLink to="/tasks" className="panel-action-link">
                View all tasks <ArrowRight size={13} />
              </NavLink>
            </div>

            {dueToday.length > 0 ? (
              <div className="task-action-list">
                {dueToday.map(t => (
                  <div key={t.id} className="task-action-row">
                    <button
                      className="task-checkbox"
                      onClick={() => onToggle(t.id)}
                      aria-label={`Mark ${t.title} complete`}
                      title="Mark done"
                    >
                      <Check size={13} />
                    </button>
                    <div className="task-action-content" onClick={() => onOpenTask(t)} style={{ cursor: 'pointer' }}>
                      <span className="task-action-title">{t.title}</span>
                      <div className="task-action-meta">
                        <span className="task-meta-project">{t.project}</span>
                        {t.assignee && scope === 'all' && (
                          <span className="task-meta-assignee">· {t.assignee.name}</span>
                        )}
                        <span className={`task-meta-priority priority-${t.priority.toLowerCase()}`}>
                          {t.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-empty-state">
                <p>No tasks specifically scheduled for today.</p>
                {canEdit && (
                  <button className="text-button" onClick={onCapture}>
                    <Zap size={13} /> Quick capture for today
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Running Late Section (if any overdue) */}
          {overdue.length > 0 && (
            <section className="dashboard-panel panel-overdue">
              <div className="panel-header">
                <div className="panel-title-wrap">
                  <h3 className="panel-title text-attention"><ShieldAlert size={16} /> Overdue Tasks</h3>
                  <span className="badge-count badge-attention">{overdue.length}</span>
                </div>
              </div>
              <div className="task-action-list">
                {overdue.slice(0, 6).map(t => (
                  <div key={t.id} className="task-action-row">
                    <button
                      className="task-checkbox"
                      onClick={() => onToggle(t.id)}
                      aria-label={`Mark ${t.title} complete`}
                      title="Mark done"
                    >
                      <Check size={13} />
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
