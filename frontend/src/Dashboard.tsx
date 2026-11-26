import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, Code2, FileCode2, FolderKanban, HardDrive, Plus, Sparkles, Users, X, Workflow, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api, formatBytes, localDate, timeAgo } from './lib/api';
import { useRealtimeEvent } from './lib/realtime';
import { ActivityFeed, type ActivityItem, type Project, type Task } from './ProjectViews';
import DailyBrief from './DailyBrief';

type Doc = { id: string; title: string; body: string; updated: string };
type RecentFile = { id: string; name: string; sizeBytes: number; createdAt: string };

export default function Dashboard({
  projects,
  tasks,
  docs,
  onToggleTask,
  onNew,
  search,
  accountName,
  accountId,
  teamCount,
  loaded,
  canEdit,
  onAskAI,
  onSeedWorkspace
}: {
  projects: Project[];
  tasks: Task[];
  docs: Doc[];
  onToggleTask: (id: string | number) => void;
  onNew: () => void;
  search: string;
  accountName: string;
  accountId?: string;
  teamCount: number;
  loaded: boolean;
  canEdit: boolean;
  onAskAI: () => void;
  onSeedWorkspace?: () => void;
}) {
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem('zynckle-intro-dismissed') !== 'yes');
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [files, setFiles] = useState<RecentFile[] | null>(null);
  const [taskTab, setTaskTab] = useState<'mine' | 'all' | 'urgent'>('mine');

  useEffect(() => {
    api<ActivityItem[]>('/api/activity?limit=100').then(setActivity).catch(() => setActivity([]));
    api<RecentFile[]>('/api/files').then(list => setFiles([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5))).catch(() => setFiles([]));
  }, []);

  useRealtimeEvent('activity', (item: ActivityItem) => setActivity(list => list ? [item, ...list].slice(0, 100) : list));

  const query = search.trim().toLowerCase();
  const visibleProjects = projects.filter(p => `${p.name} ${p.description || ''}`.toLowerCase().includes(query));
  const openTasks = tasks.filter(t => !t.done && t.status !== 'Done');
  const completedTasks = tasks.filter(t => t.done || t.status === 'Done');
  const mine = openTasks.filter(t => t.assigneeId === accountId);
  const urgentTasks = openTasks.filter(t => t.priority === 'High' || t.priority === 'Urgent');
  const overdueTasks = openTasks.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date < localDate());
  const dueTodayTasks = openTasks.filter(t => t.date === localDate());

  // Filter tasks displayed in the action rail based on selected tab
  const activeRailTasks = useMemo(() => {
    let source = openTasks;
    if (taskTab === 'mine') source = mine.length ? mine : openTasks;
    else if (taskTab === 'urgent') source = urgentTasks.length ? urgentTasks : openTasks;
    return source.filter(t => `${t.title} ${t.project || ''}`.toLowerCase().includes(query));
  }, [taskTab, mine, openTasks, urgentTasks, query]);

  const upcoming = useMemo(() =>
    openTasks
      .filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4),
    [tasks]
  );

  const avgProgress = useMemo(() => {
    if (!projects.length) return 0;
    return Math.round(projects.reduce((acc, p) => acc + (p.progress || 0), 0) / projects.length);
  }, [projects]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(now).toUpperCase();
  const firstName = accountName.trim().split(/\s+/)[0] || 'there';
  const recentDocs = [...docs].sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 5);
  const isNew = loaded && !projects.length && !docs.length;

  return (
    <div className="dashboard-root">
      {/* Hero Welcome Header & Action Matrix */}
      <section className="dashboard-hero">
        <div className="hero-left">
          <div className="hero-eyebrow-row">
            <span className="eyebrow">{dateLabel}</span>
            <span className="hero-live-badge"><span className="pulse-dot"/> Live Workspace</span>
          </div>
          <h1 className="hero-title">
            {greeting}, <em>{firstName}</em>.
          </h1>
          <p className="welcome-sub">
            {overdueTasks.length > 0 ? (
              <span className="text-attention">
                <ShieldAlert size={16} /> {overdueTasks.length} task{overdueTasks.length === 1 ? ' is' : 's are'} past due.
                {dueTodayTasks.length > 0 && ` Also ${dueTodayTasks.length} scheduled for today.`}
              </span>
            ) : dueTodayTasks.length > 0 ? (
              <span>You have {dueTodayTasks.length} task{dueTodayTasks.length === 1 ? '' : 's'} scheduled for today. Ready when you are.</span>
            ) : (
              <span>Everything is running smoothly across your projects, documents, and real-time team threads.</span>
            )}
          </p>
        </div>

        <div className="hero-actions">
          {canEdit && (
            <button className="button-primary hero-btn" onClick={onNew}>
              <Plus size={16} /> New project
            </button>
          )}
          <button className="button-secondary hero-btn" onClick={onAskAI}>
            <Sparkles size={16} /> Ask Zynckle AI
          </button>
        </div>
      </section>

      {/* Quick Access Action Bar */}
      <nav className="dashboard-quickbar" aria-label="Quick launch tools">
        <NavLink to="/documents" className="quickbar-pill">
          <BookOpen size={15} /> <span>Documents</span>
        </NavLink>
        <NavLink to="/ai/architecture" className="quickbar-pill">
          <Workflow size={15} /> <span>Architecture</span>
        </NavLink>
        <NavLink to="/code" className="quickbar-pill">
          <Code2 size={15} /> <span>Code</span>
        </NavLink>
        <NavLink to="/latex" className="quickbar-pill">
          <FileCode2 size={15} /> <span>LaTeX Studio</span>
        </NavLink>
        <NavLink to="/drive" className="quickbar-pill">
          <HardDrive size={15} /> <span>Drive</span>
        </NavLink>
        <NavLink to="/team" className="quickbar-pill">
          <Users size={15} /> <span>Team ({teamCount})</span>
        </NavLink>
      </nav>

      {/* Optional Welcome Banner */}
      {showIntro && (
        <section className="intro-strip">
          <div className="intro-mark">
            <Sparkles size={20} />
          </div>
          <div className="intro-copy">
            <strong>One workspace. Everything connected.</strong>
            <span>
              Plan, collaborate, document, organize and create with live real-time sync. Press <kbd>Ctrl K</kbd> to jump anywhere.
            </span>
          </div>
          <NavLink to="/documents" className="intro-cta">
            Start with a document <ArrowRight size={14} />
          </NavLink>
          <button
            className="intro-close"
            aria-label="Dismiss welcome"
            onClick={() => {
              localStorage.setItem('zynckle-intro-dismissed', 'yes');
              setShowIntro(false);
            }}
          >
            <X size={16} />
          </button>
        </section>
      )}

      {/* Starter Template Seed Banner */}
      {canEdit && projects.length === 0 && onSeedWorkspace && (
        <section className="starter-seed-card">
          <div className="starter-seed-info">
            <Sparkles size={24} className="starter-seed-icon" />
            <div>
              <h3>Explore with Preloaded Starter Workspace</h3>
              <p>Load real sample projects, tasks across kanban stages, and architecture docs to test and interact with all features immediately.</p>
            </div>
          </div>
          <button className="button-primary starter-seed-btn" onClick={onSeedWorkspace}>
            <Plus size={16} /> Load Starter Projects & Tasks
          </button>
        </section>
      )}

      {/* Getting Started Guide for New Workspaces */}
      {isNew && (
        <section className="zy-onboarding">
          <div className="eyebrow">GETTING STARTED · ZERO TO ONE</div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Create a project</strong>
                <small>Give your work a board with columns, deadlines and assignees.</small>
              </div>
              {canEdit && (
                <button className="text-button" onClick={onNew}>
                  Create <ArrowRight size={13} />
                </button>
              )}
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Invite your team</strong>
                <small>Roles are verified on the server: Owners, Admins, Members, Viewers.</small>
              </div>
              <NavLink className="text-button" to="/team">
                Invite <ArrowRight size={13} />
              </NavLink>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Realtime documents</strong>
                <small>Rich collaborative editing over Yjs with revision history and comments.</small>
              </div>
              <NavLink className="text-button" to="/documents">
                Write <ArrowRight size={13} />
              </NavLink>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Design with AI</strong>
                <small>Generate system architecture, ER diagrams, and interactive React Flow maps.</small>
              </div>
              <NavLink className="text-button" to="/ai/architecture">
                Design <ArrowRight size={13} />
              </NavLink>
            </li>
          </ol>
        </section>
      )}

      {loaded && projects.length > 0 && <DailyBrief canEdit={canEdit}/>}

      {/* Four Balanced Key Metric Cards */}
      <section className="overview-bento-grid">
        {/* Card 1: Projects */}
        <div className="bento-metric-card">
          <div className="metric-header">
            <span className="overview-icon"><FolderKanban size={18} /></span>
            <span className="metric-tag">{avgProgress}% avg done</span>
          </div>
          <div className="metric-main">
            <strong>{loaded ? String(projects.length).padStart(2, '0') : '—'}</strong>
            <span>Active Projects</span>
          </div>
          <div className="metric-progress-track">
            <div className="metric-progress-fill" style={{ width: `${Math.max(6, avgProgress)}%` }} />
          </div>
          <div className="metric-footer">
            <NavLink to="/projects" className="metric-link">View all projects <ArrowRight size={12} /></NavLink>
          </div>
        </div>

        {/* Card 2: Tasks */}
        <div className="bento-metric-card">
          <div className="metric-header">
            <span className="overview-icon"><Check size={18} /></span>
            <span className={`metric-tag ${overdueTasks.length ? 'tag-alert' : 'tag-neutral'}`}>
              {overdueTasks.length ? `${overdueTasks.length} overdue` : 'On track'}
            </span>
          </div>
          <div className="metric-main">
            <strong>{loaded ? String(openTasks.length).padStart(2, '0') : '—'}</strong>
            <span>Open Tasks</span>
          </div>
          <div className="metric-meta-row">
            <span>{mine.length} for you</span>
            <span className="meta-dot" />
            <span>{completedTasks.length} completed</span>
          </div>
          <div className="metric-footer">
            <NavLink to="/tasks" className="metric-link">Manage tasks <ArrowRight size={12} /></NavLink>
          </div>
        </div>

        {/* Card 3: Team */}
        <div className="bento-metric-card">
          <div className="metric-header">
            <span className="overview-icon"><Users size={18} /></span>
            <span className="metric-tag tag-live"><span className="pulse-dot mini" /> Online</span>
          </div>
          <div className="metric-main">
            <strong>{String(teamCount).padStart(2, '0')}</strong>
            <span>Team Members</span>
          </div>
          <div className="metric-meta-row">
            <span>{teamCount === 1 ? 'Solo creator' : 'Collaborative hub'}</span>
          </div>
          <div className="metric-footer">
            <NavLink to="/team" className="metric-link">Team directory <ArrowRight size={12} /></NavLink>
          </div>
        </div>

        {/* Card 4: Documents & Drive */}
        <div className="bento-metric-card">
          <div className="metric-header">
            <span className="overview-icon"><BookOpen size={18} /></span>
            <span className="metric-tag">{docs.length} docs</span>
          </div>
          <div className="metric-main">
            <strong>{String(docs.length + (files?.length || 0)).padStart(2, '0')}</strong>
            <span>Workspace Assets</span>
          </div>
          <div className="metric-meta-row">
            <span>{files?.length || 0} files in Drive</span>
            <span className="meta-dot" />
            <span>Encrypted store</span>
          </div>
          <div className="metric-footer">
            <NavLink to="/documents" className="metric-link">Browse docs <ArrowRight size={12} /></NavLink>
          </div>
        </div>
      </section>

      {/* 14-Day Workspace Activity Pulse */}
      <Pulse activity={activity} />

      {/* Main Responsive Two-Column Layout */}
      <section className="dashboard-content-split">
        {/* Left Column (Primary Operations) */}
        <div className="split-primary-col">
          {/* Projects Portfolio Section */}
          <div className="dashboard-panel">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">PORTFOLIO · RECENT ACTIVITY</div>
                <h2>Projects in motion</h2>
              </div>
              <NavLink to="/projects" className="text-button">
                All projects <ArrowRight size={14} />
              </NavLink>
            </div>

            <div className="project-list">
              {!loaded ? (
                <div className="zy-skeleton-rows">
                  <i /><i /><i />
                </div>
              ) : visibleProjects.length ? (
                visibleProjects.slice(0, 5).map(p => (
                  <NavLink key={p.id} to={`/projects/${p.id}`} className="project-row">
                    <div className={`project-art ${p.color}`}>
                      <span>{p.name.slice(0, 1)}</span>
                      <i className="art-orbit" />
                      <i className="art-dot" />
                    </div>
                    <div className="project-info">
                      <div className="project-title-line">
                        <h3>{p.name}</h3>
                        <span className={`status status-${p.status.toLowerCase().replace(/ /g, '-')}`}>
                          <i />{p.status}
                        </span>
                      </div>
                      <p>{p.description || 'A focused project, ready to build and ship.'}</p>
                      <div className="project-meta">
                        <span>{p.taskCount ?? tasks.filter(t => t.projectId === p.id).length} tasks</span>
                        <span className="meta-divider" />
                        <span className="tiny-progress">
                          <i style={{ width: `${p.progress || 0}%` }} />
                        </span>
                        <span>{p.progress || 0}%</span>
                        <span className="meta-divider" />
                        <span>{p.due && p.due !== 'Not set' ? `Due ${p.due}` : 'No deadline'}</span>
                      </div>
                    </div>
                    <ArrowRight size={16} className="dashboard-project-arrow" />
                  </NavLink>
                ))
              ) : (
                <div className="empty-state">
                  <FolderKanban size={26} />
                  <h3>{query ? 'No matching projects' : 'Your first project starts here'}</h3>
                  <p>{query ? 'Try another search term.' : 'Give your next project a dedicated home with tasks, boards, and deadlines.'}</p>
                  {!query && canEdit && (
                    <button className="button-primary" onClick={onNew}>
                      <Plus size={15} /> Create a project
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Split Content Hub: Documents & Drive Files */}
          <div className="dashboard-split-hub">
            {/* Documents Sub-Card */}
            <div className="dashboard-panel hub-card">
              <div className="section-heading compact">
                <div>
                  <div className="eyebrow">LIVE KNOWLEDGE</div>
                  <h2>Documents</h2>
                </div>
                <NavLink to="/documents" className="text-button">
                  Browse <ArrowRight size={13} />
                </NavLink>
              </div>
              <div className="zy-mini-list">
                {recentDocs.map(d => (
                  <NavLink key={d.id} to={`/documents?doc=${d.id}`} className="hub-list-item">
                    <div className="hub-item-icon"><BookOpen size={16} /></div>
                    <div className="hub-item-body">
                      <strong>{d.title}</strong>
                      <small>Edited {timeAgo(d.updated)}</small>
                    </div>
                    <ArrowRight size={14} className="hub-arrow" />
                  </NavLink>
                ))}
                {loaded && !recentDocs.length && (
                  <p className="inline-empty">No documents yet. Create one anytime.</p>
                )}
              </div>
            </div>

            {/* Drive Files Sub-Card */}
            <div className="dashboard-panel hub-card">
              <div className="section-heading compact">
                <div>
                  <div className="eyebrow">CLOUD STORAGE</div>
                  <h2>Drive Assets</h2>
                </div>
                <NavLink to="/drive" className="text-button">
                  Open Drive <ArrowRight size={13} />
                </NavLink>
              </div>
              <div className="zy-mini-list">
                {files?.map(f => (
                  <NavLink key={f.id} to={`/drive?file=${f.id}`} className="hub-list-item">
                    <div className="hub-item-icon"><HardDrive size={16} /></div>
                    <div className="hub-item-body">
                      <strong>{f.name}</strong>
                      <small>{formatBytes(f.sizeBytes)} · {timeAgo(f.createdAt)}</small>
                    </div>
                    <ArrowRight size={14} className="hub-arrow" />
                  </NavLink>
                ))}
                {files?.length === 0 && (
                  <p className="inline-empty">No files uploaded yet. Drag & drop into Drive.</p>
                )}
                {files === null && (
                  <div className="zy-skeleton-rows small"><i /><i /></div>
                )}
              </div>
            </div>
          </div>

          {/* Real-time Team Activity Timeline */}
          <div className="dashboard-panel">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">EVENT FEED · IN REALTIME</div>
                <h2>Team activity</h2>
              </div>
              <NavLink to="/team" className="text-button">
                Team page <ArrowRight size={14} />
              </NavLink>
            </div>
            <ActivityFeed items={activity ? activity.slice(0, 8) : null} compact />
          </div>
        </div>

        {/* Right Column (Focus Action Rail) */}
        <aside className="split-action-rail">
          {/* Action Queue & Task Checklist */}
          <div className="rail-panel">
            <div className="rail-heading-with-tabs">
              <div>
                <div className="eyebrow">ACTION QUEUE</div>
                <h3>Focus Tasks <span>{activeRailTasks.length}</span></h3>
              </div>
              <NavLink to="/tasks" aria-label="Open task board" className="rail-view-all">
                <ArrowRight size={15} />
              </NavLink>
            </div>

            {/* Tab Filter for Tasks */}
            <div className="task-filter-pills" role="tablist">
              <button
                role="tab"
                aria-selected={taskTab === 'mine'}
                className={`filter-pill ${taskTab === 'mine' ? 'active' : ''}`}
                onClick={() => setTaskTab('mine')}
              >
                Assigned ({mine.length})
              </button>
              <button
                role="tab"
                aria-selected={taskTab === 'all'}
                className={`filter-pill ${taskTab === 'all' ? 'active' : ''}`}
                onClick={() => setTaskTab('all')}
              >
                All ({openTasks.length})
              </button>
              <button
                role="tab"
                aria-selected={taskTab === 'urgent'}
                className={`filter-pill ${taskTab === 'urgent' ? 'active' : ''}`}
                onClick={() => setTaskTab('urgent')}
              >
                Urgent ({urgentTasks.length})
              </button>
            </div>

            <div className="task-list">
              {activeRailTasks.slice(0, 6).map(t => (
                <button
                  className="task-item"
                  key={t.id}
                  onClick={() => canEdit && onToggleTask(t.id)}
                  title="Click to toggle done"
                >
                  <span className="task-check" />
                  <span className="task-text">
                    <strong>{t.title}</strong>
                    <small>{t.project} {t.date && t.date !== 'No date' ? `· Due ${t.date}` : ''}</small>
                  </span>
                  <span
                    className={`priority priority-${t.priority.toLowerCase()}`}
                    title={`${t.priority} priority`}
                  />
                </button>
              ))}
              {loaded && !activeRailTasks.length && (
                <div className="inline-empty text-center py-4">
                  <CheckCircle2 size={24} className="text-muted mb-1 mx-auto" />
                  <p>All caught up in this view!</p>
                </div>
              )}
            </div>

            <div className="rail-foot-link">
              <NavLink className="subtle-button" to="/tasks">
                Open full Kanban board <ArrowRight size={14} />
              </NavLink>
            </div>
          </div>

          {/* Upcoming Deadlines Radar */}
          <div className="rail-panel">
            <div className="rail-heading">
              <div>
                <div className="eyebrow">DEADLINE RADAR</div>
                <h3>Upcoming milestones</h3>
              </div>
            </div>

            {upcoming.length ? (
              <div className="upcoming-list">
                {upcoming.map(t => {
                  const isLate = t.date < localDate();
                  const isToday = t.date === localDate();
                  const dateObj = new Date(`${t.date}T00:00:00`);
                  return (
                    <NavLink to={`/projects/${t.projectId}?task=${t.id}`} className="upcoming-item" key={t.id}>
                      <div className={`date-block ${isLate ? 'date-late' : isToday ? 'date-today' : ''}`}>
                        <strong>{dateObj.getDate()}</strong>
                        <span>{new Intl.DateTimeFormat('en', { month: 'short' }).format(dateObj).toUpperCase()}</span>
                      </div>
                      <div className="upcoming-content">
                        <strong>{t.title}</strong>
                        <small>
                          {t.project}
                          {isLate ? <span className="badge-late">Overdue</span> : isToday ? <span className="badge-today">Today</span> : ''}
                        </small>
                      </div>
                    </NavLink>
                  );
                })}
              </div>
            ) : (
              <p className="inline-empty">No upcoming deadlines scheduled.</p>
            )}
          </div>

          {/* Zynckle AI Smart Assist Card */}
          <div className="rail-ai-card">
            <div className="ai-card-head">
              <span className="ai-note-icon"><Sparkles size={18} /></span>
              <div>
                <strong>Zynckle AI Assistant</strong>
                <small>Connected & ready · Ctrl+J</small>
              </div>
            </div>
            <p className="ai-card-body">
              Context-aware intelligence across your documents, projects, and architecture designs.
            </p>
            <button className="button-primary w-full" onClick={onAskAI}>
              <Sparkles size={14} /> Open AI Assistant
            </button>
          </div>
        </aside>
      </section>
    </div>
  );
}

/** Fourteen days of workspace activity drawn as a smooth rhythmic pulse curve. */
function Pulse({ activity }: { activity: ActivityItem[] | null }) {
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 13 + i);
    return d;
  });
  const counts = days.map(d =>
    (activity || []).filter(a => {
      const t = new Date(a.createdAt);
      return t >= d && t.getTime() < d.getTime() + 86_400_000;
    }).length
  );
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const w = 680;
  const h = 48;
  const points = counts.map((c, i) => [(i / 13) * w, h - 4 - (c / max) * (h - 12)]);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const busiest = counts.indexOf(Math.max(...counts));

  if (activity === null) return null;

  return (
    <section className="zy-pulse-card" aria-label={`Workspace activity: ${total} changes in 14 days`}>
      <div className="pulse-info">
        <div className="eyebrow">ACTIVITY RHYTHM · 14-DAY PULSE</div>
        <div className="pulse-value-row">
          <strong>{total}</strong>
          <span>
            {total
              ? `events · peak on ${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(days[busiest])}`
              : 'events — live changes will visualize here'}
          </span>
        </div>
      </div>
      <div className="pulse-graph-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-hidden="true">
          <defs>
            <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#pulseGradient)" />
          <path d={line} className="zy-pulse-line" />
          {points.map(([x, y], i) => counts[i] > 0 && (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i === 13 ? 3.5 : 2}
              className={i === 13 ? 'now' : ''}
            >
              <title>{`${days[i].toDateString()}: ${counts[i]} changes`}</title>
            </circle>
          ))}
        </svg>
      </div>
    </section>
  );
}
