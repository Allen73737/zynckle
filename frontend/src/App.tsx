import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Newspaper, Keyboard, Activity, ArrowRight, Bell, BookOpen, Check, ChevronDown, Code2, Command, FileCode2, FolderKanban, HardDrive, Info, LayoutDashboard, LogOut, Menu, Moon, MoreHorizontal, PenLine, Plus, Search, Settings, Sparkles, Square, Sun, Users, X, Save } from 'lucide-react';
import Dashboard from './Dashboard';
import AuthGate from './AuthScreens';
import NotificationsPanel from './NotificationsPanel';
import CommandPalette from './CommandPalette';
import QuickCapture from './QuickCapture';
import ScratchpadDrawer from './components/ScratchpadDrawer';
import { Projects, ProjectDetail, Tasks, TaskDrawer, type Project, type Task } from './ProjectViews';
import type { Account } from './SettingsStudio';
import { api, errorMessage, formatBytes, streamAI } from './lib/api';
import { useRealtime, useRealtimeEvent, sendPresence } from './lib/realtime';
import './studio.css';
import './signature.css';

const DocumentsStudio = lazy(() => import('./DocumentsStudio'));
const DriveStudio = lazy(() => import('./DriveStudio'));
const PreviewStudio = lazy(() => import('./PreviewStudio'));
const AIWorkshop = lazy(() => import('./AIWorkshop'));
const AIStudio = lazy(() => import('./AIStudio'));
const KnowledgeStudio = lazy(() => import('./KnowledgeStudio'));
const ArchitectureStudio = lazy(() => import('./ArchitectureStudio'));
const CodeStudio = lazy(() => import('./CodeStudio'));
const LatexStudio = lazy(() => import('./LatexStudio'));
const TeamStudio = lazy(() => import('./TeamStudio'));
const SettingsStudio = lazy(() => import('./SettingsStudio'));
const AboutStudio = lazy(() => import('./AboutStudio'));
const Markdown = lazy(() => import('./Markdown'));
const TodayEdition = lazy(() => import('./TodayEdition'));

type Doc = { id: string; title: string; body: string; updated: string };
type ThemeChoice = 'light' | 'dark' | 'system';
const nav = [
  { label: 'Overview', icon: LayoutDashboard, to: '/' }, { label: 'Today', icon: Newspaper, to: '/today' }, { label: 'Projects', icon: FolderKanban, to: '/projects' },
  { label: 'My tasks', icon: Check, to: '/tasks' }, { label: 'Documents', icon: BookOpen, to: '/documents' },
  { label: 'Zynckle AI', icon: Sparkles, to: '/ai' }, { label: 'LaTeX studio', icon: FileCode2, to: '/latex' }, { label: 'Code', icon: Code2, to: '/code' }, { label: 'Drive', icon: HardDrive, to: '/drive' }, { label: 'Website previews', icon: Activity, to: '/previews' }, { label: 'Team', icon: Users, to: '/team' },
  { label: 'About', icon: Info, to: '/about' },
];
const crumbFor = (path: string) => ({ '': 'Overview', today: 'The Daily Edition', projects: 'Projects', project: 'Projects', tasks: 'My tasks', task: 'My tasks', documents: 'Documents', doc: 'Documents', docs: 'Documents', ai: 'Zynckle AI', architecture: 'AI Architecture', workshop: 'AI Workshop', latex: 'LaTeX studio', 'latex-studio': 'LaTeX studio', code: 'Code', drive: 'Drive', files: 'Drive', previews: 'Website previews', preview: 'Website previews', team: 'Team', settings: 'Settings', about: 'About Zynckle' } as Record<string, string>)[path.split('/')[1] || ''] || 'Workspace';
const normaliseTask = (t: Task): Task => ({ ...t, date: t.date || t.due || 'No date', done: t.done || t.status === 'Done', priority: t.priority || 'Normal' });

function PageLoader() { return <div className="zy-page-loader" aria-label="Loading"><i/><i/><i/></div>; }

export default function App() {
  const [sidebarExpanded, setSidebarExpanded] = useState(() => localStorage.getItem('zynckle-sidebar-expanded') !== 'false');
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => (localStorage.getItem('zynckle-theme-choice') as ThemeChoice) || 'dark');
  const [resolvedTheme, setResolvedTheme] = useState('dark');
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [taskModal, setTaskModal] = useState(false);
  const [taskProject, setTaskProject] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [workspace, setWorkspace] = useState('Studio');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role: string; current: boolean; members?: number }[]>([]);
  const [account, setAccount] = useState<Account>({ name: 'Workspace member', email: '', role: 'MEMBER' });
  const [teamCount, setTeamCount] = useState(1);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [modal, setModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [apiStatus, setApiStatus] = useState('Checking connection');
  const [loaded, setLoaded] = useState(false);
  const [storage, setStorage] = useState<{ usedBytes: number; quotaBytes: number; driver: string } | null>(null);
  const [token, setToken] = useState(() => localStorage.getItem('zynckle-token') || '');
  const location = useLocation();
  const navigate = useNavigate();
  const toastTimer = useRef(0);
  const { status: liveStatus, presence } = useRealtime(token);
  const canEdit = account.role !== 'VIEWER';
  const isAdmin = ['OWNER', 'ADMIN'].includes(account.role);

  // Theme Engine: Light, Dark, or System mode with full monochrome styling
  const applyTheme = useCallback((choice: ThemeChoice) => {
    setThemeChoice(choice);
    localStorage.setItem('zynckle-theme-choice', choice);
    const resolved = choice === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : choice;
    setResolvedTheme(resolved);
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff');
  }, []);

  useEffect(() => {
    const saved = (localStorage.getItem('zynckle-theme-choice') as ThemeChoice) || 'dark';
    applyTheme(saved);
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (localStorage.getItem('zynckle-theme-choice') === 'system') applyTheme('system');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [applyTheme]);

  const chooseTheme = (choice: ThemeChoice) => {
    applyTheme(choice);
    if (token) api('/api/auth/preferences', { method: 'PATCH', body: { theme: choice } }).catch(() => {});
  };
  const toggleTheme = () => chooseTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  const toggleSidebar = () => {
    setSidebarExpanded(e => {
      const next = !e;
      localStorage.setItem('zynckle-sidebar-expanded', String(next));
      return next;
    });
  };

  const notify = useCallback((message: string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 3200); }, []);
  const clearSession = useCallback(() => { for (const key of ['zynckle-token', 'zynckle-projects', 'zynckle-tasks', 'zynckle-documents', 'zynckle-code-files']) localStorage.removeItem(key); setProjects([]); setTasks([]); setDocs([]); setLoaded(false); setToken(''); }, []);
  useEffect(() => { const expired = () => { clearSession(); }; window.addEventListener('zynckle:session-expired', expired); return () => window.removeEventListener('zynckle:session-expired', expired); }, [clearSession]);
  // Other modules (e.g. applied AI action plans) announce changes so lists stay current.
  useEffect(() => { const changed = () => { loadWorkspaceRef.current(); }; window.addEventListener('zynckle:workspace-changed', changed); return () => window.removeEventListener('zynckle:workspace-changed', changed); }, []);

  const loadWorkspace = useCallback(async () => {
    if (!token) { setApiStatus('API ready · sign in to sync'); return; }
    try {
      await api('/api/health');
      const me = await api<Account & { workspace: { id: string; name: string } | null; preferences?: { theme?: ThemeChoice } }>('/api/auth/me');
      setAccount(me); setWorkspace(me.workspace?.name || 'Studio'); setWorkspaceId(me.workspace?.id || '');
      if (me.preferences?.theme && !localStorage.getItem('zynckle-theme-set')) { applyTheme(me.preferences.theme); localStorage.setItem('zynckle-theme-set', 'yes'); }
      const [projectData, taskData, docData, teamData, workspaceData, notes] = await Promise.all([
        api<Project[]>('/api/projects'), api<Task[]>('/api/tasks'), api<{ id: string; title: string; content: string; updated: string; type: string }[]>('/api/documents'),
        api<{ members: unknown[] }>('/api/team').catch(() => ({ members: [] })), api<typeof workspaces>('/api/workspaces').catch(() => []), api<{ read: boolean }[]>('/api/notifications?unread=1').catch(() => []),
      ]);
      setProjects(projectData); setTasks(taskData.map(normaliseTask));
      setDocs(docData.filter(d => d.type !== 'latex').map(d => ({ id: d.id, title: d.title, body: d.content, updated: d.updated })));
      setTeamCount(teamData.members?.length || 1); setWorkspaces(workspaceData); setUnreadCount(notes.length);
      setApiStatus('Connected to workspace API'); setLoaded(true);
      api<{ usedBytes: number; quotaBytes: number; driver: string }>('/api/storage/usage').then(setStorage).catch(() => {});
    } catch (error) { setApiStatus(errorMessage(error).includes('unreachable') ? 'API offline · start the backend' : 'Workspace data could not be loaded'); }
  }, [token]);
  const loadWorkspaceRef = useRef(loadWorkspace);
  loadWorkspaceRef.current = loadWorkspace;
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  // Live updates from teammates.
  useRealtimeEvent('task.changed', (task: Task) => setTasks(list => list.some(t => t.id === task.id) ? list.map(t => t.id === task.id ? normaliseTask(task) : t) : [normaliseTask(task), ...list]));
  useRealtimeEvent('task.deleted', ({ id }: { id: string }) => setTasks(list => list.filter(t => t.id !== id)));
  useRealtimeEvent('project.changed', (project: Project) => setProjects(list => project.archived ? list.filter(p => p.id !== project.id) : list.some(p => p.id === project.id) ? list.map(p => p.id === project.id ? project : p) : [project, ...list]));
  useRealtimeEvent('project.deleted', ({ id }: { id: string }) => { setProjects(list => list.filter(p => p.id !== id)); setTasks(list => list.filter(t => t.projectId !== id)); });
  useRealtimeEvent('notification', (n: { title: string }) => { setUnreadCount(c => c + 1); if (!notificationsOpen) notify(n.title); });

  useEffect(() => { sendPresence(location.pathname); if (window.innerWidth <= 768) setSidebarExpanded(false); setProfileMenu(false); }, [location.pathname]);
  useEffect(() => {
    const onToggleScratch = () => setScratchpadOpen(o => !o);
    window.addEventListener('zynckle:toggle-scratchpad', onToggleScratch);
    return () => window.removeEventListener('zynckle:toggle-scratchpad', onToggleScratch);
  }, []);

  useEffect(() => {
    // Global keyboard layer. Single keys only fire when you are not typing.
    let chord = 0;
    const routes: Record<string, string> = { d: '/', y: '/today', p: '/projects', t: '/tasks', o: '/documents', a: '/ai', l: '/latex', c: '/code', f: '/drive', w: '/previews', m: '/team', s: '/settings', i: '/about' };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAiOpen(o => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setScratchpadOpen(o => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); return; }
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || document.querySelector('.modal-backdrop, .zy-palette-backdrop, .assistant-backdrop')) return;
      const key = e.key.toLowerCase();
      if (Date.now() - chord < 1200 && routes[key]) { e.preventDefault(); chord = 0; navigate(routes[key]); return; }
      chord = 0;
      if (key === 'g') chord = Date.now();
      else if (key === 'c') { e.preventDefault(); setCaptureOpen(true); }
      else if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); }
      else if (key === '/') { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const authDone = (value: string) => { localStorage.setItem('zynckle-token', value); setToken(value); if (!['/', ''].includes(location.pathname) && /^\/(signin|reset-password|verify-email)/.test(location.pathname)) navigate('/'); notify('You’re signed in'); };
  const signOut = () => { api('/api/auth/logout', { method: 'POST' }).catch(() => {}); clearSession(); navigate('/'); };

  const addProject = async (name: string, description: string, due: string) => {
    try { const saved = await api<Project>('/api/projects', { body: { name, description, due: due || undefined } }); setProjects(p => [saved, ...p.filter(x => x.id !== saved.id)]); setModal(false); notify('Project created'); navigate(`/projects/${saved.id}`); }
    catch (error) { notify(errorMessage(error, 'Project could not be created')); }
  };
  const updateTask = async (id: string | number, values: Record<string, unknown>) => {
    try { const d = await api<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: values }); setTasks(items => items.map(t => t.id === id ? normaliseTask(d) : t)); notify('Task updated'); return true; }
    catch (error) { notify(errorMessage(error, 'Task could not be updated')); return false; }
  };
  const moveTask = async (id: string, status: string) => {
    const before = tasks;
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status, done: status === 'Done' } : t)); // optimistic
    try { const d = await api<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: { status } }); setTasks(ts => ts.map(t => t.id === id ? normaliseTask(d) : t)); }
    catch (error) { setTasks(before); notify(errorMessage(error, 'Task could not be moved')); }
  };
  const toggleTask = (id: string | number) => { const task = tasks.find(t => t.id === id); if (task) moveTask(String(id), task.done ? 'To do' : 'Done'); };
  const createTask = async (title: string, projectName: string, details: { date: string; priority: string; description: string; assigneeId: string; status: string }) => {
    let p = projects.find(x => x.name === projectName);
    if (!p) {
      try {
        p = await api<Project>('/api/projects', { body: { name: projectName || 'General', description: 'Workspace project' } });
        setProjects(list => [p!, ...list.filter(x => x.id !== p!.id)]);
      } catch (err) {
        notify(errorMessage(err, 'Project could not be created'));
        return;
      }
    }
    try {
      const saved = await api<Task>(`/api/projects/${p.id}/tasks`, { body: { title, ...details, assigneeId: details.assigneeId || undefined } });
      setTasks(items => [normaliseTask(saved), ...items.filter(t => t.id !== saved.id)]);
      setTaskModal(false);
      setTaskProject('');
      notify('Task added');
    } catch (error) {
      notify(errorMessage(error, 'Task could not be created'));
    }
  };
  const deleteTask = async (id: string | number) => {
    if (!window.confirm('Delete this task and its comments?')) return;
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); setTasks(items => items.filter(t => t.id !== id)); notify('Task deleted'); }
    catch (error) { notify(errorMessage(error, 'Task could not be deleted')); }
  };
  const deleteProject = async (id: string | number) => {
    if (!window.confirm('Delete this project, its tasks and task comments? This cannot be undone.')) return;
    try { await api(`/api/projects/${id}`, { method: 'DELETE' }); setProjects(items => items.filter(p => p.id !== id)); setTasks(items => items.filter(t => t.projectId !== id)); notify('Project and its tasks deleted'); if (location.pathname.startsWith('/projects/')) navigate('/projects'); }
    catch (error) { notify(errorMessage(error, 'Project could not be deleted')); }
  };
  const updateProject = async (id: string | number, values: { name: string; description: string; due: string; status: string }) => {
    try { const saved = await api<Project>(`/api/projects/${id}`, { method: 'PATCH', body: { ...values, due: values.due === 'Not set' ? null : values.due } }); setProjects(items => items.map(p => p.id === id ? saved : p)); setTasks(items => items.map(t => t.projectId === id ? { ...t, project: saved.name } : t)); setEditingProject(null); notify('Project updated'); }
    catch (error) { notify(errorMessage(error, 'Project could not be updated')); }
  };
  const switchWorkspace = async (id: string) => { try { await api(`/api/workspaces/${id}/activate`, { method: 'POST' }); window.location.assign('/'); } catch (error) { notify(errorMessage(error, 'Workspace could not be switched')); } };
  const createWorkspace = async () => { const name = window.prompt('Name your new workspace'); if (!name?.trim()) return; try { await api('/api/workspaces', { body: { name: name.trim() } }); window.location.assign('/'); } catch (error) { notify(errorMessage(error, 'Workspace could not be created')); } };

  const seedStarterWorkspace = async () => {
    try {
      notify('Initializing starter workspace…');
      const p1 = await api<Project>('/api/projects', {
        body: {
          name: 'Zynckle Platform Core',
          description: 'Full-stack SaaS workspace, real-time sync engine, and design system.',
          due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        }
      });
      const p2 = await api<Project>('/api/projects', {
        body: {
          name: 'Client Experience & Design System',
          description: 'High-contrast monochrome UI, micro-animations, and responsive layouts.',
          due: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        }
      });
      const todayIso = new Date().toISOString().slice(0, 10);
      const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const sampleTasks = [
        { projectId: p1.id, title: 'Inline expandable side-drawer navigation', priority: 'Urgent', status: 'Done', date: todayIso, description: 'Smooth expand & collapse with zero intrusive backdrops on desktop.' },
        { projectId: p1.id, title: 'Monochrome Dark/Light theme toggle with OS sync', priority: 'High', status: 'Done', date: todayIso, description: 'Pure pitch black and stark white monochrome palettes.' },
        { projectId: p1.id, title: 'Uniform modern SaaS layout across Today & Settings', priority: 'High', status: 'In review', date: todayIso, description: 'Clean metric cards, responsive grids, and legible typography.' },
        { projectId: p2.id, title: 'Security review and session token validation', priority: 'Normal', status: 'In progress', date: tomorrowIso, description: 'Scrypt password hashing, rate limiting, and CORS enforcement.' },
        { projectId: p2.id, title: 'LaTeX Studio compilation & math equation rendering', priority: 'Normal', status: 'To do', date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), description: 'KaTeX integration and real-time PDF preview.' },
      ];
      for (const t of sampleTasks) {
        await api<Task>(`/api/projects/${t.projectId}/tasks`, { body: t });
      }
      await api('/api/documents', {
        body: {
          title: 'Workspace Architecture & Design System',
          content: '<h1>Workspace Architecture & Design System</h1><p>Welcome to your Zynckle workspace. Every tool—projects, tasks, docs, code, and drive—is connected in real time.</p><h3>Key Features</h3><ul><li><strong>Persistent Inline Drawer</strong>: Expands and collapses in place.</li><li><strong>Monochrome Themes</strong>: High-contrast Dark and Light modes.</li><li><strong>Collaborative Documents</strong>: Real-time markdown with revision history.</li></ul>',
          type: 'rich-text'
        }
      });
      await api('/api/documents', {
        body: {
          title: 'Zynckle Technical Paper (LaTeX)',
          content: '\\documentclass[11pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\title{Zynckle Architecture: Unified High-Assurance Workspaces}\n\\author{Engineering Team}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Abstract}\nThis paper introduces the Zynckle architecture: an integrated monochrome environment combining reactive real-time coordination, mathematical document compilation, and sandboxed previewing.\n\n\\section{Core Principles}\nWe adhere to pure monochrome design semantics:\n\\begin{equation}\n  \\mathcal{U} = \\{ \\text{Pitch Black}, \\text{Stark White}, \\text{Neutral Zinc} \\}\n\\end{equation}\n\n\\section{Mathematical Models}\nThe throughput of local state replication scales with:\n\\begin{equation}\n  T(N) = \\sum_{i=1}^N \\frac{\\lambda_i}{\\Delta t_i} \\approx \\mathcal{O}(1)\n\\end{equation}\n\n\\section{Conclusion}\nZynckle delivers immediate utility across all modalities without dead ends.\n\n\\end{document}\n',
          type: 'latex'
        }
      });
      await api('/api/previews', {
        body: {
          url: 'https://example.com',
          title: 'Example Production Site',
          description: 'Verified live deployment preview for multi-viewport inspection.',
          kind: 'url'
        }
      }).catch(() => {});
      await loadWorkspace();
      notify('Starter workspace successfully loaded!');
    } catch (err) {
      notify(errorMessage(err, 'Could not seed workspace'));
    }
  };

  if (!token) return <AuthGate onSuccess={authDone} theme={resolvedTheme} onTheme={toggleTheme}/>;
  const usedShare = storage ? Math.max(2, Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)) : 0;
  const othersOnline = presence.filter(p => p.id !== account.id);

  return <div className={`app-shell ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
    {/* Unified Expanding Side Drawer (Expands inline from side rail) */}
    <aside className="side-drawer" aria-label="Navigation drawer">
      <div className="drawer-header">
        {sidebarExpanded ? (
          <>
            <NavLink to="/" className="drawer-brand" aria-label="Zynckle home">
              <span className="brand-mark">z</span>
              <span>zynckle</span>
            </NavLink>
            <button
              className="drawer-collapse-btn"
              onClick={toggleSidebar}
              aria-label="Collapse navigation drawer (Ctrl+B)"
              title="Collapse navigation drawer (Ctrl+B)"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </>
        ) : (
          <button
            className="drawer-hamburger-btn"
            onClick={toggleSidebar}
            aria-label="Expand navigation drawer (Ctrl+B)"
            title="Expand navigation drawer (Ctrl+B)"
          >
            <Menu size={22} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="drawer-workspace">
        <button className="workspace-switch" onClick={() => setWorkspaceMenu(!workspaceMenu)} aria-expanded={workspaceMenu}>
          <span className="workspace-avatar">{workspace.slice(0, 1)}</span>
          <span className="workspace-name">{workspace}<small>{account.role.toLowerCase()} · {teamCount} member{teamCount === 1 ? '' : 's'}</small></span>
          <ChevronDown size={15} className="muted"/>
        </button>
        {workspaceMenu && (
          <div className="workspace-menu" onMouseLeave={() => setWorkspaceMenu(false)}>
            {workspaces.map(w => (
              <button key={w.id} onClick={() => { setWorkspaceMenu(false); if (!w.current) switchWorkspace(w.id); }}>
                <span className="workspace-avatar small">{w.name[0]}</span>
                {w.name}{w.current && <Check size={14}/>}
              </button>
            ))}
            <button className="menu-add" onClick={() => { setWorkspaceMenu(false); createWorkspace(); }}><Plus size={14}/>New workspace</button>
            <NavLink to="/settings#workspace" className="menu-add" onClick={() => setWorkspaceMenu(false)}><Settings size={14}/>Workspace settings</NavLink>
          </div>
        )}
      </div>

      <nav className="drawer-nav" aria-label="Primary apps">
        {nav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `drawer-nav-item ${isActive ? 'active' : ''}`}
            title={item.label}
          >
            <item.icon size={20} className="drawer-nav-icon" strokeWidth={1.8} />
            <span className="drawer-nav-label">{item.label}</span>
            {item.to === '/tasks' && tasks.filter(t => !t.done && t.assigneeId === account.id).length > 0 && (
              <>
                <span className="drawer-nav-badge">{tasks.filter(t => !t.done && t.assigneeId === account.id).length}</span>
                <span className="drawer-badge-dot" />
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="drawer-projects">
        <div className="nav-label project-label">
          YOUR PROJECTS {canEdit && <button className="tiny-icon" onClick={() => setModal(true)} aria-label="Add project"><Plus size={14}/></button>}
        </div>
        <div className="side-projects">
          {projects.slice(0, 5).map(p => (
            <NavLink key={p.id} to={`/projects/${p.id}`} className="side-project">
              <i className={`project-dot ${p.color}`} />
              <span>{p.name}</span>
            </NavLink>
          ))}
          {loaded && !projects.length && <span className="storage-note zy-side-empty">No projects yet</span>}
        </div>
      </div>

      <div className="drawer-bottom">
        {sidebarExpanded ? (
          <div className="sidebar-bottom">
            <div className="storage-label">
              <span>Workspace storage</span>
              <span>{storage ? formatBytes(storage.usedBytes) : '—'}</span>
            </div>
            <div className="storage-track"><span style={{ width: `${usedShare}%` }}/></div>
            <div className="storage-note">
              {storage ? `of ${formatBytes(storage.quotaBytes)} · ${storage.driver === 's3' ? 'cloud object storage' : 'local disk'}` : 'Checking storage'}
            </div>
            <div className="drawer-bottom-row" style={{ marginTop: '8px' }}>
              {canEdit && (
                <button className="drawer-icon-btn" onClick={() => setCaptureOpen(true)} title="Quick Capture Task (C)">
                  <Plus size={19} strokeWidth={2} />
                </button>
              )}
              <button className="drawer-icon-btn" onClick={() => setPaletteOpen(true)} title="Command Search (Ctrl+K)">
                <Search size={18} />
              </button>
              <button className="drawer-icon-btn" onClick={() => setScratchpadOpen(true)} title="Quick Scratchpad (Ctrl+E)">
                <PenLine size={18} />
              </button>
              <button className="drawer-icon-btn" onClick={toggleTheme} title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}>
                {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <NavLink to="/settings" className="drawer-icon-btn" title="Settings">
                <Settings size={18} />
              </NavLink>
            </div>
            <div className="profile" style={{ marginTop: '10px' }}>
              <div className="avatar avatar-self">{account.name.slice(0, 2).toUpperCase()}</div>
              <div className="profile-name">
                {account.name}
                <small>{account.email || 'Workspace member'}</small>
              </div>
              <div className="zy-menu-wrap">
                <button className="icon-button" aria-label="Account menu" aria-expanded={profileMenu} onClick={() => setProfileMenu(m => !m)}>
                  <MoreHorizontal size={18}/>
                </button>
                {profileMenu && (
                  <div className="zy-dropdown up right" onMouseLeave={() => setProfileMenu(false)}>
                    <NavLink to="/settings#profile"><Settings size={13}/> Profile & settings</NavLink>
                    <button onClick={() => { setProfileMenu(false); setPaletteOpen(true); }}><Command size={13}/> Command menu <kbd>Ctrl K</kbd></button>
                    <button onClick={() => { setProfileMenu(false); setShortcutsOpen(true); }}><Keyboard size={13}/> Keyboard shortcuts <kbd>?</kbd></button>
                    <button className="danger" onClick={signOut}><LogOut size={13}/> Sign out</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="drawer-bottom-row" style={{ flexDirection: 'column', gap: '8px' }}>
            {canEdit && (
              <button className="drawer-icon-btn" onClick={() => setCaptureOpen(true)} title="Quick Capture Task (C)">
                <Plus size={20} strokeWidth={2} />
              </button>
            )}
            <button className="drawer-icon-btn" onClick={() => setPaletteOpen(true)} title="Command Search (Ctrl+K)">
              <Search size={19} />
            </button>
            <button className="drawer-icon-btn" onClick={() => setScratchpadOpen(true)} title="Quick Scratchpad (Ctrl+E)">
              <PenLine size={19} />
            </button>
            <button className="drawer-icon-btn" onClick={toggleTheme} title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}>
              {resolvedTheme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <NavLink to="/settings" className="drawer-icon-btn" title="Settings">
              <Settings size={19} />
            </NavLink>
            <NavLink to="/settings#profile" className="dock-avatar" title={`Signed in as ${account.name}`}>
              {account.name.slice(0, 2).toUpperCase()}
            </NavLink>
          </div>
        )}
      </div>
    </aside>

    {sidebarExpanded && (
      <div className="mobile-drawer-backdrop zy-mobile-only" onClick={toggleSidebar} aria-label="Close navigation" />
    )}

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-left">
          {!sidebarExpanded && (
            <>
              <button
                className="icon-button hamburger-button topbar-hamburger"
                onClick={toggleSidebar}
                aria-label="Toggle navigation drawer"
                title="Toggle drawer (Ctrl+B)"
              >
                <Menu size={20}/>
              </button>
              <NavLink to="/" className="topbar-brand" aria-label="Zynckle home">
                <span className="brand-mark">z</span>
                <span className="brand-text">zynckle</span>
              </NavLink>
            </>
          )}
          <div className="crumb">
            <span>{workspace}</span>
            <span className="crumb-slash">/</span>
            <span className="crumb-current">{crumbFor(location.pathname)}</span>
          </div>
        </div>
        <div className="topbar-actions">
          {canEdit && (
            <button className="button-primary topbar-new-btn zy-desktop-only" onClick={() => setCaptureOpen(true)} title="Quick create task (C)">
              <Plus size={15}/><span>Task</span>
            </button>
          )}
          {othersOnline.length > 0 && (
            <div className="zy-presence" title={othersOnline.map(p => p.name).join(', ') + ' online'}>
              {othersOnline.slice(0, 4).map(p => <i key={p.id}>{p.avatar}</i>)}
              {othersOnline.length > 4 && <i>+{othersOnline.length - 4}</i>}
            </div>
          )}
          <label className="search-trigger">
            <Search size={15}/>
            <input id="global-search" aria-label="Filter this page" value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter this page…"/>
            <button type="button" className="zy-kbd-button" onClick={() => setPaletteOpen(true)} aria-label="Open command menu">
              <kbd><Command size={11}/> K</kbd>
            </button>
          </label>
          <button className="icon-button zy-mobile-only" aria-label="Search" onClick={() => setPaletteOpen(true)}><Search size={17}/></button>
          <button className="icon-button theme-toggle-btn" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}>
            {resolvedTheme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}
          </button>
          <button className="icon-button notification-button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onClick={() => setNotificationsOpen(true)}>
            <Bell size={17}/>{unreadCount > 0 && <i/>}
          </button>
          <NavLink to="/settings#profile" className="avatar avatar-top" aria-label="Your profile">{account.name.slice(0, 2).toUpperCase()}</NavLink>
        </div>
      </header>
      <div className="page-content" key={location.pathname.split('/').slice(0, 2).join('/')}><Suspense fallback={<PageLoader/>}><Routes>
        <Route path="/" element={<Dashboard projects={projects} tasks={tasks} docs={docs} onToggleTask={toggleTask} onNew={() => setModal(true)} search={search} accountName={account.name} accountId={account.id} teamCount={teamCount} loaded={loaded} canEdit={canEdit} onAskAI={() => setAiOpen(true)} onSeedWorkspace={seedStarterWorkspace}/>}/>
        <Route path="/today" element={<TodayEdition tasks={tasks} projects={projects} accountId={account.id} accountName={account.name} workspace={workspace} onToggle={toggleTask} onOpenTask={setOpenTask} onCapture={() => setCaptureOpen(true)} canEdit={canEdit} onTaskCreated={t => setTasks(items => [normaliseTask(t), ...items.filter(x => x.id !== t.id)])} onSeedWorkspace={seedStarterWorkspace}/>}/>
        <Route path="/projects" element={<Projects projects={projects} onNew={() => setModal(true)} onDelete={deleteProject} search={search} canEdit={canEdit} onSeedWorkspace={seedStarterWorkspace}/>}/>
        <Route path="/project" element={<Navigate to="/projects" replace/>}/>
        <Route path="/projects/:id" element={<ProjectDetail projects={projects} tasks={tasks} onEdit={setEditingProject} onTask={name => { setTaskProject(name); setTaskModal(true); }} onMove={moveTask} onOpenTask={setOpenTask} onProjectChange={p => setProjects(list => list.map(x => x.id === p.id ? p : x))} onDelete={deleteProject} canEdit={canEdit} accountId={account.id}/>}/>
        <Route path="/tasks" element={<Tasks tasks={tasks} search={search} onToggle={toggleTask} onDelete={deleteTask} onOpen={setOpenTask} onNew={() => { setTaskProject(''); setTaskModal(true); }} accountId={account.id} canEdit={canEdit} onSeedWorkspace={seedStarterWorkspace}/>}/>
        <Route path="/task" element={<Navigate to="/tasks" replace/>}/>
        <Route path="/documents" element={<DocumentsStudio docs={docs} search={search} onSave={setDocs} notify={notify} token={token} account={account} canEdit={canEdit} isAdmin={isAdmin} projects={projects}/>}/>
        <Route path="/documents/:id" element={<DocumentsStudio docs={docs} search={search} onSave={setDocs} notify={notify} token={token} account={account} canEdit={canEdit} isAdmin={isAdmin} projects={projects}/>}/>
        <Route path="/doc" element={<Navigate to="/documents" replace/>}/>
        <Route path="/docs" element={<Navigate to="/documents" replace/>}/>
        <Route path="/document" element={<Navigate to="/documents" replace/>}/>
        <Route path="/ai" element={<AIStudio projects={projects} tasks={tasks} canEdit={canEdit} notify={notify} onDocumentSaved={doc => setDocs(items => [{ id: doc.id, title: doc.title, body: doc.content, updated: doc.updated }, ...items])}/>}/>
        <Route path="/ai/knowledge" element={<KnowledgeStudio notify={notify}/>}/>
        <Route path="/knowledge" element={<Navigate to="/ai/knowledge" replace/>}/>
        <Route path="/ai/architecture" element={<ArchitectureStudio projects={projects} notify={notify} canEdit={canEdit}/>}/>
        <Route path="/architecture" element={<Navigate to="/ai/architecture" replace/>}/>
        <Route path="/ai/workshop" element={<AIWorkshop token={token} projects={projects} tasks={tasks} notify={notify} onDocumentSaved={doc => setDocs(items => [{ id: doc.id, title: doc.title, body: doc.content, updated: doc.updated }, ...items.filter(d => d.id !== doc.id)])} onTasksCreated={created => setTasks(items => [...created.map(t => normaliseTask(t as Task)), ...items])}/>}/>
        <Route path="/workshop" element={<Navigate to="/ai/workshop" replace/>}/>
        <Route path="/latex" element={<LatexStudio notify={notify} canEdit={canEdit}/>}/>
        <Route path="/latex/:id" element={<LatexStudio notify={notify} canEdit={canEdit}/>}/>
        <Route path="/latex-studio" element={<Navigate to="/latex" replace/>}/>
        <Route path="/previews" element={<PreviewStudio notify={notify} token={token} projects={projects} canEdit={canEdit} isAdmin={isAdmin} accountId={account.id}/>}/>
        <Route path="/previews/:id" element={<PreviewStudio notify={notify} token={token} projects={projects} canEdit={canEdit} isAdmin={isAdmin} accountId={account.id}/>}/>
        <Route path="/preview" element={<Navigate to="/previews" replace/>}/>
        <Route path="/preview/*" element={<Navigate to="/previews" replace/>}/>
        <Route path="/drive" element={<DriveStudio token={token} notify={notify} canEdit={canEdit} isAdmin={isAdmin} accountId={account.id} onUsage={setStorage}/>}/>
        <Route path="/files" element={<Navigate to="/drive" replace/>}/>
        <Route path="/drive/folder/:id" element={<DriveStudio token={token} notify={notify} canEdit={canEdit} isAdmin={isAdmin} accountId={account.id} onUsage={setStorage}/>}/>
        <Route path="/code" element={<CodeStudio notify={notify} canEdit={canEdit} projects={projects}/>}/>
        <Route path="/code/:id" element={<CodeStudio notify={notify} canEdit={canEdit} projects={projects}/>}/>
        <Route path="/team" element={<TeamStudio token={token} notify={notify} presence={presence} onWorkspaceChanged={() => window.location.assign('/team')}/>}/>
        <Route path="/settings" element={<SettingsStudio token={token} account={account} workspace={workspace} workspaceId={workspaceId} workspaceCount={workspaces.length} theme={themeChoice} onThemeChoice={chooseTheme} onAccount={setAccount} onWorkspace={name => { setWorkspace(name); setWorkspaces(items => items.map(item => item.current ? { ...item, name } : item)); }} onSignOut={signOut} notify={notify}/>}/>
        <Route path="/about" element={<AboutStudio notify={notify}/>}/>
        <Route path="/verify-email" element={<VerifyEmail onDone={() => { loadWorkspace(); navigate('/settings#profile'); }}/>}/>
        <Route path="*" element={<NotFound/>}/>
      </Routes></Suspense>
      <footer className="page-footer"><span>© 2026 Zynckle Studio</span><span className="api-status"><i className={apiStatus.startsWith('Connected') ? 'online' : ''}/>{apiStatus}</span><span className="api-status" title="Realtime updates"><i className={liveStatus === 'live' ? 'online' : ''}/>{liveStatus === 'live' ? 'Live sync on' : liveStatus === 'connecting' ? 'Connecting live sync' : 'Live sync offline · retrying'}</span><button className="footer-help" onClick={() => setPaletteOpen(true)}><Command size={13}/> Ctrl K</button><NavLink to="/about" className="footer-help"><Info size={13}/> About &amp; 20 Topics</NavLink><NavLink to="/ai" className="footer-help"><Sparkles size={13}/> AI tools</NavLink></footer></div></main>
    {openTask && <TaskDrawer key={openTask.id} task={tasks.find(t => t.id === openTask.id) || openTask} onClose={() => setOpenTask(null)} onSave={updateTask} onDelete={deleteTask} canEdit={canEdit}/>}
    {editingProject && <EditProjectModal project={editingProject} onClose={() => setEditingProject(null)} onSave={updateProject}/>}
    {notificationsOpen && <NotificationsPanel token={token} onClose={() => setNotificationsOpen(false)} onUnreadChange={setUnreadCount}/>}
    {modal && <ProjectModal onClose={() => setModal(false)} onCreate={addProject}/>}
    {aiOpen && <AssistantPanel projects={projects} onClose={() => setAiOpen(false)}/>}
    {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} actions={{ newProject: () => setModal(true), newTask: () => setCaptureOpen(true), toggleTheme, askAI: () => setAiOpen(true) }}/>}
    {captureOpen && <QuickCapture projects={projects} defaultProjectId={location.pathname.startsWith('/projects/') ? location.pathname.split('/')[2] : undefined} onClose={() => setCaptureOpen(false)} onCreated={task => { setTasks(items => [normaliseTask(task), ...items.filter(t => t.id !== task.id)]); notify(`Added “${task.title}”`); }}/>}
    {scratchpadOpen && <ScratchpadDrawer onClose={() => setScratchpadOpen(false)} notify={notify} onNavigate={navigate} />}
    {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)}/>}
    {taskModal && <TaskModal projects={projects} project={taskProject} onClose={() => { setTaskModal(false); setTaskProject(''); }} onCreate={createTask}/>}
    {!aiOpen && !location.pathname.startsWith('/ai') && <button onClick={() => setAiOpen(true)} className="ai-fab" aria-label="Ask Zynckle AI (Ctrl+J)" title="Ask Zynckle AI (Ctrl+J)"><Sparkles size={17}/><span>Ask AI</span></button>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

const SHORTCUTS: [string, [string, string[]][]][] = [
  ['Anywhere', [['Command menu & search', ['Ctrl', 'K']], ['Quick Scratchpad HUD', ['Ctrl', 'E']], ['Quick capture a task', ['C']], ['Ask Zynckle AI', ['Ctrl', 'J']], ['Search', ['/']], ['This sheet', ['?']]]],
  ['Go to', [['Overview', ['G', 'D']], ['The Daily Edition', ['G', 'Y']], ['Projects', ['G', 'P']], ['My tasks', ['G', 'T']], ['Documents', ['G', 'O']], ['Zynckle AI', ['G', 'A']], ['Code', ['G', 'C']], ['Drive', ['G', 'F']], ['Team', ['G', 'M']], ['Settings', ['G', 'S']]]],
  ['Writing', [['Save a revision (LaTeX)', ['Ctrl', 'S']], ['Compile PDF', ['Ctrl', 'Enter']], ['Bold · Italic · Underline', ['Ctrl', 'B / I / U']], ['Leave focus mode', ['Esc']]]],
];

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="modal zy-shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
    <div className="modal-head"><div><div className="eyebrow">MOVE AT THE SPEED OF THOUGHT</div><h2 id="shortcuts-title">Keyboard shortcuts</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
    <div className="zy-shortcut-grid">{SHORTCUTS.map(([group, items]) => <div key={group}><div className="eyebrow">{group.toUpperCase()}</div>{items.map(([label, keys]) => <div key={label} className="zy-shortcut"><span>{label}</span><span>{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span></div>)}</div>)}</div>
  </section></div>;
}

function NotFound() {
  return <div className="empty-state zy-gap-top"><Square size={23}/><h3>This page doesn’t exist</h3><p>The link may be outdated, or the item was moved to another workspace.</p><NavLink className="button-secondary" to="/">Back to overview</NavLink></div>;
}

function VerifyEmail({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState('Verifying your email…');
  useEffect(() => { const token = new URLSearchParams(location.search).get('token'); api<{ email: string }>('/api/auth/verify', { body: { token } }).then(r => { setState(`${r.email} is verified.`); setTimeout(onDone, 1200); }).catch(e => setState(errorMessage(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="empty-state zy-gap-top"><Check size={23}/><h3>{state}</h3></div>;
}

function TaskModal({ projects, project: initialProject, onClose, onCreate }: { projects: Project[]; project: string; onClose: () => void; onCreate: (title: string, project: string, details: { date: string; priority: string; description: string; assigneeId: string; status: string }) => void }) {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState(initialProject || projects[0]?.name || 'General');
  const [date, setDate] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState('To do');
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => setProject(initialProject || projects[0]?.name || 'General'), [initialProject, projects]);
  useEffect(() => { api<{ members: { id: string; name: string }[] }>('/api/team').then(d => setMembers(d.members)).catch(() => {}); }, []);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={e => { e.preventDefault(); if (title.trim()) onCreate(title.trim(), project.trim() || 'General', { date: date || 'No date', priority, description, assigneeId, status }); }}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">MAKE THE NEXT MOVE</div>
            <h2>Add a task</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button>
        </div>
        <label>Task title<input autoFocus required value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={160}/></label>
        {projects.length > 0 ? (
          <label>Project<select value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option key={p.id}>{p.name}</option>)}</select></label>
        ) : (
          <label>Project name<input value={project} onChange={e => setProject(e.target.value)} placeholder="e.g. General" maxLength={80} required/></label>
        )}
        <div className="task-form-pair">
          <label>Due date<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
          <label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        </div>
        <div className="task-form-pair">
          <label>Assignee<select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Column<select value={status} onChange={e => setStatus(e.target.value)}><option>Backlog</option><option>To do</option><option>In progress</option><option>In review</option></select></label>
        </div>
        <label>Description <span className="optional">OPTIONAL</span><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} placeholder="Add context or a definition of done"/></label>
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
          <button className="button-primary" disabled={!title.trim()}><Plus size={15}/> Add task</button>
        </div>
      </form>
    </div>
  );
}

function EditProjectModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (id: string | number, values: { name: string; description: string; due: string; status: string }) => void }) {
  const [name, setName] = useState(project.name); const [description, setDescription] = useState(project.description); const [due, setDue] = useState(project.due === 'Not set' ? '' : project.due); const [status, setStatus] = useState(project.status);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="modal" onSubmit={e => { e.preventDefault(); onSave(project.id, { name: name.trim(), description: description.trim(), due: due || 'Not set', status }); }}><div className="modal-head"><div><div className="eyebrow">PROJECT DETAILS</div><h2>Edit project</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div><label>Project name<input autoFocus value={name} onChange={e => setName(e.target.value)} required maxLength={100}/></label><label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000}/></label><div className="task-form-pair"><label>Deadline<input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(due) ? due : ''} onChange={e => setDue(e.target.value)}/></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option>Planning</option><option>In progress</option><option>In review</option><option>On hold</option><option>Completed</option></select></label></div><div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={!name.trim()}><Save size={14}/> Save changes</button></div></form></div>;
}

function ProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (n: string, d: string, due: string) => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [due, setDue] = useState('');
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="modal" onSubmit={e => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), description.trim(), due); }}><div className="modal-head"><div><div className="eyebrow">A NEW BEGINNING</div><h2>Create a project</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div><p>Give the next idea a place of its own.</p><label>Project name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. A more thoughtful launch" required maxLength={100}/></label><label>A few words about it <span className="optional">OPTIONAL</span><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What are you hoping to make?" rows={3} maxLength={2000}/></label><label>Deadline <span className="optional">OPTIONAL</span><input type="date" value={due} onChange={e => setDue(e.target.value)}/></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button-primary" disabled={!name.trim()}><Plus size={15}/> Create project</button></div></form></div>;
}

/** Quick assistant drawer: streams answers, optionally grounded in the current project. */
function AssistantPanel({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const location = useLocation();
  const currentProject = projects.find(p => location.pathname === `/projects/${p.id}`);
  const [useContext, setUseContext] = useState(Boolean(currentProject));
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { api<{ available: boolean }>('/api/ai/status').then(s => setAvailable(s.available)).catch(() => setAvailable(false)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    const next = [...messages, { role: 'user' as const, content: input.trim() }];
    setMessages([...next, { role: 'assistant', content: '' }]); setInput(''); setError(''); setBusy(true);
    abort.current = new AbortController();
    try {
      await streamAI({ messages: next, mode: 'general', context: useContext && currentProject ? { projectId: currentProject.id } : {} }, { signal: abort.current.signal, onDelta: d => setMessages(m => m.map((x, i) => i === m.length - 1 ? { ...x, content: x.content + d } : x)) });
    } catch (ex) { if ((ex as Error).name !== 'AbortError') { setError(errorMessage(ex, 'AI request failed')); setMessages(m => m.filter((x, i) => !(i === m.length - 1 && !x.content))); } }
    finally { setBusy(false); }
  };
  return <div className="assistant-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><aside className="assistant-panel" role="dialog" aria-label="Zynckle assistant"><header><span><Sparkles size={16}/> Zynckle assistant</span><div className="zy-head-actions"><NavLink to="/ai" className="text-button" onClick={onClose}>Full studio <ArrowRight size={12}/></NavLink><button className="icon-button" onClick={onClose} aria-label="Close assistant"><X size={17}/></button></div></header>
    <p className="assistant-context">{currentProject ? <label className="zy-check inline"><input type="checkbox" checked={useContext} onChange={e => setUseContext(e.target.checked)}/> Use “{currentProject.name}” as context</label> : 'General workspace help · provider key stays on the backend'}</p>
    <div className="assistant-messages">{messages.length === 0 && <div className="doc-empty"><Sparkles/><h2>Think it through.</h2><p>{available === false ? 'No AI provider is configured on the backend yet. Add GROQ_API_KEY to .env and restart the API.' : 'Ask for planning help, explanations, or a first draft.'}</p></div>}
      {messages.map((m, i) => <article className={'chat-' + m.role} key={i}><small>{m.role === 'user' ? 'YOU' : 'ZYNCKLE'}</small>{m.role === 'assistant' ? (m.content ? <Suspense fallback={<p>{m.content}</p>}><Markdown source={m.content} streaming={busy && i === messages.length - 1}/></Suspense> : <div className="zy-typing"><i/><i/><i/></div>) : <p>{m.content}</p>}</article>)}
      {error && <p className="auth-error">{error}</p>}<div ref={end}/></div>
    <form className="assistant-form" onSubmit={send}><textarea aria-label="Message the assistant" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="What are you working through?" rows={3}/>
      {busy ? <button type="button" className="button-secondary" onClick={() => abort.current?.abort()}><Square size={12}/> Stop</button> : <button className="button-primary" disabled={!input.trim() || available === false}>Send <ArrowRight size={14}/></button>}</form></aside></div>;
}
