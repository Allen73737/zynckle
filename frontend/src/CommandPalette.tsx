import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, BookOpen, Check, Code2, CornerDownLeft, FileCode2, FileText, FolderKanban, HardDrive, LayoutDashboard, LoaderCircle, Moon, Plus, Search, Settings, Sparkles, User, Users, Workflow } from 'lucide-react';
import { api } from './lib/api';

type Result = { type: string; id: string; title: string; subtitle?: string; link: string };
const typeIcons: Record<string, typeof Search> = { project: FolderKanban, task: Check, document: BookOpen, latex: FileCode2, file: HardDrive, code: Code2, 'code-file': FileCode2, preview: Activity, person: User };

/** ⌘K / Ctrl+K: jump anywhere, run actions, and search everything you can see. */
export default function CommandPalette({ onClose, actions }: { onClose: () => void; actions: { newProject: () => void; newTask: () => void; toggleTheme: () => void; askAI: () => void } }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const go = (path: string) => { onClose(); navigate(path); };
  const commands = useMemo(() => [
    { id: 'new-project', title: 'Create a project', icon: Plus, run: () => { onClose(); actions.newProject(); }, keywords: 'new add' },
    { id: 'new-task', title: 'Add a task', icon: Plus, run: () => { onClose(); actions.newTask(); }, keywords: 'new todo' },
    { id: 'scratchpad', title: 'Open Quick Scratchpad (Ctrl+E)', icon: FileText, run: () => { onClose(); window.dispatchEvent(new CustomEvent('zynckle:toggle-scratchpad')); }, keywords: 'notes memo scratch pad' },
    { id: 'ask', title: 'Ask Zynckle AI', icon: Sparkles, run: () => { onClose(); actions.askAI(); }, keywords: 'assistant chat help' },
    { id: 'latex-decompile', title: 'Decompile PDF to LaTeX', icon: FileCode2, run: () => go('/latex'), keywords: 'pdf convert decompile latex' },
    { id: 'overview', title: 'Go to Overview', icon: LayoutDashboard, run: () => go('/'), keywords: 'dashboard home' },
    { id: 'projects', title: 'Go to Projects', icon: FolderKanban, run: () => go('/projects'), keywords: '' },
    { id: 'tasks', title: 'Go to My tasks', icon: Check, run: () => go('/tasks'), keywords: 'todo' },
    { id: 'docs', title: 'Go to Documents', icon: BookOpen, run: () => go('/documents'), keywords: 'write editor' },
    { id: 'latex', title: 'Go to LaTeX studio', icon: FileCode2, run: () => go('/latex'), keywords: 'tex pdf' },
    { id: 'code', title: 'Go to Code', icon: Code2, run: () => go('/code'), keywords: 'repository source' },
    { id: 'drive', title: 'Go to Drive', icon: HardDrive, run: () => go('/drive'), keywords: 'files upload' },
    { id: 'previews', title: 'Go to Website previews', icon: Activity, run: () => go('/previews'), keywords: 'site' },
    { id: 'ai', title: 'Open AI assistant', icon: Sparkles, run: () => go('/ai'), keywords: 'chat' },
    { id: 'arch', title: 'Design an architecture', icon: Workflow, run: () => go('/ai/architecture'), keywords: 'system diagram' },
    { id: 'workshop', title: 'Generate documentation', icon: FileText, run: () => go('/ai/workshop'), keywords: 'readme docs planner' },
    { id: 'team', title: 'Go to Team', icon: Users, run: () => go('/team'), keywords: 'invite members' },
    { id: 'settings', title: 'Open Settings', icon: Settings, run: () => go('/settings'), keywords: 'profile account' },
    { id: 'theme', title: 'Toggle light / dark theme', icon: Moon, run: () => { actions.toggleTheme(); onClose(); }, keywords: 'appearance dark mode' },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const matched = commands.filter(c => !q || `${c.title} ${c.keywords}`.toLowerCase().includes(q)).slice(0, q ? 6 : 9);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }).then(r => setResults(r.results)).catch(() => {}).finally(() => setLoading(false));
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q]);

  const items = [
    ...matched.map(c => ({ key: c.id, title: c.title, subtitle: '', icon: c.icon, run: c.run, group: 'Actions' })),
    ...results.map(r => ({ key: `${r.type}-${r.id}`, title: r.title, subtitle: r.subtitle || '', icon: typeIcons[r.type] || Search, run: () => go(r.link), group: 'Workspace' })),
  ];
  useEffect(() => { setIndex(0); }, [q, results.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[index]?.run(); }
    else if (e.key === 'Escape') onClose();
  };

  return <div className="zy-palette-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="zy-palette" role="dialog" aria-modal="true" aria-label="Command menu">
      <label className="zy-palette-input"><Search size={16}/><input ref={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search projects, tasks, docs, files, code… or type a command" aria-label="Search or run a command" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[index] ? `pi-${items[index].key}` : undefined}/>{loading && <LoaderCircle size={14} className="spin"/>}<kbd>ESC</kbd></label>
      <div className="zy-palette-list" id="palette-list" role="listbox">
        {items.map((item, i) => <div key={item.key}>
          {(i === 0 || items[i - 1].group !== item.group) && <div className="eyebrow zy-palette-group">{item.group.toUpperCase()}</div>}
          <button id={`pi-${item.key}`} role="option" aria-selected={i === index} className={i === index ? 'active' : ''} onMouseEnter={() => setIndex(i)} onClick={item.run}><item.icon size={15}/><span><strong>{item.title}</strong>{item.subtitle && <small>{item.subtitle}</small>}</span>{i === index ? <CornerDownLeft size={13}/> : <ArrowRight size={13}/>}</button>
        </div>)}
        {!items.length && !loading && <div className="zy-palette-empty">No results for “{query}”.</div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span></footer>
    </div>
  </div>;
}
