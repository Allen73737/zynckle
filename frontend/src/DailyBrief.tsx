import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AlarmClock, CalendarClock, LoaderCircle, RefreshCw, Sparkles, Square, TrendingDown, UserRound } from 'lucide-react';
import Markdown from './Markdown';
import { api, errorMessage, streamAI } from './lib/api';

type BriefTask = { id: string; title: string; project: string; projectId: string; status: string; priority: string; due: string | null; daysLate: number };
type Health = { id: string; name: string; progress: number; openTasks: number; overdue: number; idleDays: number; health: 'on-track' | 'watch' | 'at-risk' };
type Insights = { today: string; counts: { open: number; overdue: number; dueSoon: number; mine: number; stalled: number }; overdue: BriefTask[]; dueSoon: BriefTask[]; mine: BriefTask[]; projects: Health[] };

const cacheKey = (day: string) => `zynckle-brief-${day}`;
const HEALTH_LABEL = { 'on-track': 'On track', watch: 'Watch', 'at-risk': 'At risk' } as const;

/**
 * Dashboard card: deterministic health signals (instant, from /api/insights) plus an
 * AI-written brief that narrates them. The brief is cached for the day in this browser.
 */
export default function DailyBrief() {
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
      try { setBrief(localStorage.getItem(cacheKey(data.today)) || ''); } catch { /* storage unavailable */ }
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
      await streamAI({ mode: 'brief', rag: 'off', actions: false, messages: [{ role: 'user', content: 'Write my daily brief for today.' }] }, {
        signal: controller.signal,
        onDelta: delta => { text += delta; setBrief(text); },
      });
      try { localStorage.setItem(cacheKey(insights.today), text); } catch { /* storage unavailable */ }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e, 'The brief could not be written'));
    } finally { setWriting(false); }
  };

  if (!insights) return null;
  const { counts } = insights;
  const attention = [...insights.overdue, ...insights.dueSoon].slice(0, 5);
  const watched = insights.projects.filter(p => p.health !== 'on-track').slice(0, 4);

  return <section className="zy-brief" aria-label="Daily brief">
    <header>
      <div><div className="eyebrow">DAILY BRIEF · {new Date(`${insights.today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        <h2>{counts.overdue ? `${counts.overdue} overdue, ${counts.dueSoon} due soon` : counts.dueSoon ? `${counts.dueSoon} due in the next 3 days` : 'Nothing urgent today'}</h2></div>
      {aiAvailable && (writing
        ? <button className="button-secondary" onClick={() => abort.current?.abort()}><Square size={13}/> Stop</button>
        : <button className="button-primary" onClick={write}>{brief ? <RefreshCw size={14}/> : <Sparkles size={14}/>} {brief ? 'Rewrite brief' : 'Write my brief'}</button>)}
    </header>
    <div className="zy-brief-stats">
      <span className={counts.overdue ? 'alert' : ''}><AlarmClock size={14}/><b>{counts.overdue}</b> overdue</span>
      <span><CalendarClock size={14}/><b>{counts.dueSoon}</b> due soon</span>
      <span><UserRound size={14}/><b>{counts.mine}</b> on your plate</span>
      <span className={counts.stalled ? 'warn' : ''}><TrendingDown size={14}/><b>{counts.stalled}</b> stalled</span>
    </div>
    <div className="zy-brief-body">
      <div className="zy-brief-text">
        {brief ? <Markdown source={brief} streaming={writing}/> : writing ? <div className="zy-typing-row"><div className="zy-typing"><i/><i/><i/></div><small>Reading your workspace…</small></div>
          : <p className="zy-muted-note">{aiAvailable ? 'Get a short, specific summary of what needs you today — written from your real tasks, deadlines and activity.' : 'Configure an AI provider to get a written brief. The signals on the right are always live.'}</p>}
        {error && <p className="zy-inline-error" role="alert">{error}</p>}
      </div>
      <aside>
        {attention.length > 0 && <><div className="eyebrow">NEEDS ATTENTION</div><ul>{attention.map(t => <li key={t.id}><NavLink to={`/projects/${t.projectId}?task=${t.id}`}><strong>{t.title}</strong><small>{t.project} · {t.daysLate ? `${t.daysLate}d late` : `due ${t.due}`}</small></NavLink></li>)}</ul></>}
        {watched.length > 0 && <><div className="eyebrow">PROJECT HEALTH</div><ul>{watched.map(p => <li key={p.id}><NavLink to={`/projects/${p.id}`}><strong>{p.name}</strong><small><i className={`zy-health ${p.health}`}/>{HEALTH_LABEL[p.health]} · {p.progress}% · {p.overdue ? `${p.overdue} overdue` : `idle ${p.idleDays}d`}</small></NavLink></li>)}</ul></>}
        {!attention.length && !watched.length && <p className="zy-muted-note">All projects are on track. {writing && <LoaderCircle className="spin" size={12}/>}</p>}
      </aside>
    </div>
  </section>;
}
