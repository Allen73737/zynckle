import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AlarmClock, CalendarClock, FilePlus2, LoaderCircle, RefreshCw, Sparkles, Square, TrendingDown, UserRound } from 'lucide-react';
import Markdown from './Markdown';
import { api, errorMessage, streamAI } from './lib/api';

type BriefTask = { id: string; title: string; project: string; projectId: string; status: string; priority: string; due: string | null; daysLate: number };
type Health = { id: string; name: string; progress: number; openTasks: number; overdue: number; idleDays: number; health: 'on-track' | 'watch' | 'at-risk' };
type Insights = { today: string; counts: { open: number; overdue: number; dueSoon: number; mine: number; stalled: number }; overdue: BriefTask[]; dueSoon: BriefTask[]; mine: BriefTask[]; projects: Health[] };

type Kind = 'daily' | 'weekly';
/** Monday of the week containing `day` (YYYY-MM-DD), so a weekly report is cached once per week. */
const weekOf = (day: string) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const cacheKey = (kind: Kind, day: string) => kind === 'daily' ? `zynckle-brief-${day}` : `zynckle-weekly-${weekOf(day)}`;
const readCache = (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const HEALTH_LABEL = { 'on-track': 'On track', watch: 'Watch', 'at-risk': 'At risk' } as const;

/**
 * Dashboard card: deterministic health signals (instant, from /api/insights) plus an
 * AI-written brief that narrates them, or a weekly team report. Each is cached in this browser
 * for its day or week, and the weekly report can be saved as a workspace document.
 */
export default function DailyBrief({ canEdit = true, notify }: { canEdit?: boolean; notify?: (message: string) => void }) {
  const [kind, setKind] = useState<Kind>('daily');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [insights, setInsights] = useState<Insights | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [brief, setBrief] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api<Insights>('/api/insights').then(data => {
      if (!data?.counts) return;
      setInsights(data);
      setBrief(readCache(cacheKey('daily', data.today)));
    }).catch(() => {});
    api<{ available: boolean }>('/api/ai/status').then(s => setAiAvailable(Boolean(s?.available))).catch(() => {});
    return () => abort.current?.abort();
  }, []);

  const write = async () => {
    if (!insights || writing) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setWriting(true); setError(''); setBrief('');
    let text = '';
    try {
      const prompt = kind === 'daily' ? 'Write my daily brief for today.' : 'Write the team report for the last seven days.';
      await streamAI({ mode: kind === 'daily' ? 'brief' : 'weekly', rag: 'off', actions: false, messages: [{ role: 'user', content: prompt }] }, {
        signal: controller.signal,
        onDelta: delta => { text += delta; setBrief(text); },
      });
      try { localStorage.setItem(cacheKey(kind, insights.today), text); } catch { /* storage unavailable */ }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e, 'The brief could not be written'));
    } finally { setWriting(false); }
  };

  const switchKind = (next: Kind) => {
    if (next === kind || !insights) return;
    abort.current?.abort();
    setKind(next); setError(''); setSavedNote(''); setBrief(readCache(cacheKey(next, insights.today)));
  };

  /** Keep the weekly report: saved as a workspace document everyone can find and pin. */
  const saveReport = async () => {
    if (!insights || !brief || saving) return;
    setSaving(true);
    try {
      const week = new Date(`${weekOf(insights.today)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const { markdownToHtml } = await import('./Markdown');
      await api('/api/documents', { body: { title: `Weekly report · week of ${week}`, content: markdownToHtml(brief), type: 'rich-text' } });
      window.dispatchEvent(new CustomEvent('zynckle:workspace-changed'));
      setSavedNote('Saved to Documents.');
      notify?.('Weekly report saved to Documents');
    } catch (e) { setError(errorMessage(e, 'The report could not be saved')); }
    finally { setSaving(false); }
  };

  if (!insights) return null;
  const { counts } = insights;
  const attention = [...insights.overdue, ...insights.dueSoon].slice(0, 5);
  const watched = insights.projects.filter(p => p.health !== 'on-track').slice(0, 4);

  const daily = kind === 'daily';
  return <section className="zy-brief" aria-label={daily ? 'Daily brief' : 'Weekly report'}>
    <div className="zy-brief-tabs" role="tablist" aria-label="Report type">
      <button role="tab" aria-selected={daily} className={daily ? 'active' : ''} onClick={() => switchKind('daily')}>Daily brief</button>
      <button role="tab" aria-selected={!daily} className={!daily ? 'active' : ''} onClick={() => switchKind('weekly')}>Weekly report</button>
    </div>
    <header>
      <div><div className="eyebrow">{daily ? 'DAILY BRIEF' : 'WEEKLY REPORT · WEEK OF'} · {new Date(`${daily ? insights.today : weekOf(insights.today)}T12:00:00`).toLocaleDateString(undefined, daily ? { weekday: 'long', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })}</div>
        <h2>{counts.overdue ? `${counts.overdue} overdue, ${counts.dueSoon} due soon` : counts.dueSoon ? `${counts.dueSoon} due in the next 3 days` : 'Nothing urgent today'}</h2></div>
      <div className="zy-brief-actions">
        {!daily && brief && !writing && canEdit && <button className="button-secondary" onClick={saveReport} disabled={saving}>{saving ? <LoaderCircle className="spin" size={14}/> : <FilePlus2 size={14}/>} Save as document</button>}
        {aiAvailable && (writing
          ? <button className="button-secondary" onClick={() => abort.current?.abort()}><Square size={13}/> Stop</button>
          : <button className="button-primary" onClick={write}>{brief ? <RefreshCw size={14}/> : <Sparkles size={14}/>} {daily ? (brief ? 'Rewrite brief' : 'Write my brief') : (brief ? 'Rewrite report' : 'Write weekly report')}</button>)}
      </div>
    </header>
    <div className="zy-brief-stats">
      <span className={counts.overdue ? 'alert' : ''}><AlarmClock size={14}/><b>{counts.overdue}</b> overdue</span>
      <span><CalendarClock size={14}/><b>{counts.dueSoon}</b> due soon</span>
      <span><UserRound size={14}/><b>{counts.mine}</b> on your plate</span>
      <span className={counts.stalled ? 'warn' : ''}><TrendingDown size={14}/><b>{counts.stalled}</b> stalled</span>
    </div>
    <div className="zy-brief-body">
      <div className="zy-brief-text">
        {brief ? <Markdown source={brief} streaming={writing}/> : writing ? <div className="zy-typing-row"><div className="zy-typing"><i/><i/><i/></div><small>{daily ? 'Reading your workspace…' : 'Reading the last seven days…'}</small></div>
          : <p className="zy-muted-note">{!aiAvailable ? 'Configure an AI provider to get a written brief. The signals on the right are always live.' : daily ? 'Get a short, specific summary of what needs you today — written from your real tasks, deadlines and activity.' : 'A team report for the last seven days: what shipped, what started, and what is at risk. Save it to Documents to share it.'}</p>}
        {error && <p className="zy-inline-error" role="alert">{error}</p>}
        {savedNote && <p className="zy-muted-note" role="status">{savedNote} <NavLink to="/documents">Open Documents</NavLink></p>}
      </div>
      <aside>
        {attention.length > 0 && <><div className="eyebrow">NEEDS ATTENTION</div><ul>{attention.map(t => <li key={t.id}><NavLink to={`/projects/${t.projectId}?task=${t.id}`}><strong>{t.title}</strong><small>{t.project} · {t.daysLate ? `${t.daysLate}d late` : `due ${t.due}`}</small></NavLink></li>)}</ul></>}
        {watched.length > 0 && <><div className="eyebrow">PROJECT HEALTH</div><ul>{watched.map(p => <li key={p.id}><NavLink to={`/projects/${p.id}`}><strong>{p.name}</strong><small><i className={`zy-health ${p.health}`}/>{HEALTH_LABEL[p.health]} · {p.progress}% · {p.overdue ? `${p.overdue} overdue` : `idle ${p.idleDays}d`}</small></NavLink></li>)}</ul></>}
        {!attention.length && !watched.length && <p className="zy-muted-note">All projects are on track. {writing && <LoaderCircle className="spin" size={12}/>}</p>}
      </aside>
    </div>
  </section>;
}
