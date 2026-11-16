import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, CalendarClock, CheckCheck, FileText, FolderKanban, MessageSquare, Settings, Share2, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, timeAgo } from './lib/api';
import { useRealtimeEvent } from './lib/realtime';

type Notification = { id: string; kind: string; title: string; body: string; read: boolean; createdAt: string; link?: string; workspace?: string; actor?: string | null };
const icons: Record<string, typeof Bell> = { task: CheckCheck, mention: AtSign, comment: MessageSquare, project: FolderKanban, file: Share2, deadline: CalendarClock, team: Users, invite: UserPlus };

export default function NotificationsPanel({ onClose, onUnreadChange }: { token: string; onClose: () => void; onUnreadChange: (count: number) => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'mention'>('all');
  const navigate = useNavigate();
  const update = (next: Notification[]) => { setItems(next); onUnreadChange(next.filter(item => !item.read).length); };
  useEffect(() => { api<Notification[]>('/api/notifications').then(update).catch(e => setError(e.message || 'Notifications could not be loaded')).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  useRealtimeEvent('notification', (n: Notification) => setItems(list => { const next = [n, ...list.filter(x => x.id !== n.id)]; onUnreadChange(next.filter(x => !x.read).length); return next; }));

  const markRead = async (item: Notification, read = true) => {
    try { await api(`/api/notifications/${item.id}/read`, { method: 'POST', body: { read } }); update(items.map(current => current.id === item.id ? { ...current, read } : current)); }
    catch { setError('This notification could not be updated.'); }
  };
  const openItem = async (item: Notification) => {
    if (!item.read) await markRead(item);
    if (item.link) { onClose(); if (item.link.startsWith('/team?invite=')) window.location.assign(item.link); else navigate(item.link); }
  };
  const markAll = async () => { try { await api('/api/notifications/read-all', { method: 'POST' }); update(items.map(item => ({ ...item, read: true }))); } catch { setError('Notifications could not be updated.'); } };
  const remove = async (item: Notification) => { try { await api(`/api/notifications/${item.id}`, { method: 'DELETE' }); update(items.filter(x => x.id !== item.id)); } catch { setError('Notification could not be removed.'); } };
  const clearRead = async () => { try { await api('/api/notifications', { method: 'DELETE' }); update(items.filter(x => !x.read)); } catch { setError('Notifications could not be cleared.'); } };
  const visible = items.filter(item => filter === 'all' || (filter === 'unread' ? !item.read : item.kind === 'mention'));

  return <div className="notification-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><aside className="notification-panel" role="dialog" aria-label="Notifications">
    <header><span><Bell size={16}/> Notifications</span><div>{items.some(item => !item.read) && <button className="text-button" onClick={markAll}><CheckCheck size={14}/> Mark all read</button>}<button className="icon-button" aria-label="Notification settings" title="Notification settings" onClick={() => { onClose(); navigate('/settings#notifications'); }}><Settings size={15}/></button><button className="icon-button" aria-label="Close notifications" onClick={onClose}><X size={17}/></button></div></header>
    <div className="zy-tabs small" role="tablist">{(['all', 'unread', 'mention'] as const).map(f => <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'unread' ? `Unread · ${items.filter(i => !i.read).length}` : 'Mentions'}</button>)}</div>
    {error && <p className="auth-error">{error}</p>}
    {loading ? <div className="zy-skeleton-rows"><i/><i/><i/></div> : visible.length ? <div className="notification-list">{visible.map(item => { const Icon = icons[item.kind] || FileText; return <div key={item.id} className={`notification-item zy-notification ${item.read ? 'read' : 'unread'}`}>
      <button className="zy-notification-open" onClick={() => openItem(item)}><i/><span className="zy-notification-icon"><Icon size={13}/></span><span><strong>{item.title}</strong><small>{item.body}</small><time>{timeAgo(item.createdAt)}{item.workspace ? ` · ${item.workspace}` : ''}</time></span></button>
      <span className="zy-row-actions"><button className="tiny-icon" aria-label={item.read ? 'Mark unread' : 'Mark read'} title={item.read ? 'Mark unread' : 'Mark read'} onClick={() => markRead(item, !item.read)}><CheckCheck size={12}/></button><button className="tiny-icon" aria-label="Remove notification" title="Remove" onClick={() => remove(item)}><Trash2 size={12}/></button></span>
    </div>; })}{items.some(i => i.read) && <button className="text-button zy-clear" onClick={clearRead}>Clear read notifications</button>}</div>
      : <div className="notification-empty"><Bell size={22}/><strong>{filter === 'all' ? 'All caught up' : 'Nothing here'}</strong><span>Assignments, mentions, comments and shares will appear here instantly.</span></div>}
  </aside></div>;
}
