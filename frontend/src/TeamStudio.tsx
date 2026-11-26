import { useEffect, useState } from 'react';
import { Copy, Crown, LogOut, Plus, Trash2, Users } from 'lucide-react';
import { api, errorMessage, timeAgo, type Member } from './lib/api';
import type { Presence } from './lib/realtime';
import { ActivityFeed, type ActivityItem } from './ProjectViews';

type TeamData = { members: (Member & { role: string; joinedAt?: string })[]; invites: { id: string; email: string; role: string; inviteUrl: string; expiresAt: string; invitedBy?: string }[]; role: string; ownerId: string; currentUserId: string };

export default function TeamStudio({ notify, presence, onWorkspaceChanged }: { token: string; notify: (s: string) => void; presence: Presence[]; onWorkspaceChanged: () => void }) {
  const [data, setData] = useState<TeamData>({ members: [], invites: [], role: 'MEMBER', ownerId: '', currentUserId: '' });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [lastInvite, setLastInvite] = useState('');
  const load = () => api<TeamData>('/api/team').then(setData).catch(e => setError(errorMessage(e, 'Could not load workspace members')));
  const admin = ['OWNER', 'ADMIN'].includes(data.role);

  useEffect(() => {
    const inviteToken = new URLSearchParams(location.search).get('invite');
    if (inviteToken) {
      api<{ workspace: { name: string } }>('/api/team/invitations/accept', { body: { token: inviteToken } })
        .then(r => { history.replaceState({}, '', location.pathname); notify(`You joined ${r.workspace.name}`); onWorkspaceChanged(); })
        .catch(e => { history.replaceState({}, '', location.pathname); setError(errorMessage(e)); load(); });
    } else load();
    api<ActivityItem[]>('/api/activity?limit=40').then(setActivity).catch(() => setActivity([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const d = await api<{ inviteUrl: string }>('/api/team/invitations', { body: { email, role } });
      const link = location.origin + d.inviteUrl;
      setLastInvite(link);
      await navigator.clipboard.writeText(link).catch(() => {});
      setEmail(''); await load(); notify('Invite link copied. Share it with your teammate.');
    } catch (ex) { setError(errorMessage(ex, 'Invite could not be created')); }
    finally { setBusy(false); }
  };
  const changeRole = (id: string, next: string) => api(`/api/team/members/${id}`, { method: 'PATCH', body: { role: next } }).then(() => { load(); notify('Role updated'); }).catch(e => setError(errorMessage(e, 'Role could not be updated')));
  const remove = (m: Member) => { if (!window.confirm(`Remove ${m.name} from the workspace? They lose access immediately.`)) return; api(`/api/team/members/${m.id}`, { method: 'DELETE' }).then(() => { load(); notify(`${m.name} removed`); }).catch(e => setError(errorMessage(e, 'Member could not be removed'))); };
  const transfer = (m: Member) => { if (!window.confirm(`Make ${m.name} the owner of this workspace? You will become an admin.`)) return; api('/api/workspace/transfer', { body: { userId: m.id } }).then(() => { notify(`${m.name} is now the owner`); onWorkspaceChanged(); }).catch(e => setError(errorMessage(e))); };
  const leave = () => { if (!window.confirm('Leave this workspace? You will need a new invite to return.')) return; api('/api/workspace/leave', { method: 'POST' }).then(() => onWorkspaceChanged()).catch(e => setError(errorMessage(e))); };
  const online = new Set(presence.map(p => p.id));

  return <><section className="welcome-row subpage-welcome"><div><div className="eyebrow">PEOPLE & PERMISSIONS</div><h1>Good work, <em>together.</em></h1><p className="welcome-sub">Roles are enforced by the server: owners and admins manage people, members edit, viewers read. Invite links are shared manually — email delivery is not configured.</p></div>
    {data.ownerId !== data.currentUserId && data.currentUserId && <button className="button-secondary" onClick={leave}><LogOut size={14}/> Leave workspace</button>}</section>
    {admin && <form className="team-invite" onSubmit={invite}><label>Teammate email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@example.com"/></label><label>Role<select value={role} onChange={e => setRole(e.target.value)}>{data.role === 'OWNER' && <option value="ADMIN">Admin</option>}<option value="MEMBER">Member</option><option value="VIEWER">Viewer</option></select></label><button className="button-primary" disabled={busy}><Plus size={15}/> Create invite</button></form>}
    {lastInvite && <div className="zy-banner"><Copy size={14}/><div><strong>Invite link ready</strong><small className="zy-mono">{lastInvite}</small></div><button className="text-button" onClick={() => { navigator.clipboard.writeText(lastInvite); notify('Copied'); }}>Copy again</button></div>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {data.members.length === 1 && data.invites.length === 0 && <div className="zy-empty-hint" role="note"><Users size={18}/><div><strong>It’s just you here for now</strong><small>{admin ? 'Invite a teammate above. They get a link to join, and you can change their role at any time.' : 'Ask an owner or admin to invite your teammates.'}</small></div></div>}
    <div className="team-sections"><section><div className="eyebrow">WORKSPACE MEMBERS · {data.members.length} · {presence.length} ONLINE</div>{data.members.map(m => <div className="team-row" key={m.id}><span className="zy-avatar-wrap"><span className="avatar avatar-self">{m.avatar || m.name.slice(0, 2).toUpperCase()}</span>{online.has(m.id) && <i className="zy-online" title="Online now"/>}</span><span><strong>{m.name}{m.id === data.currentUserId ? ' (you)' : ''}</strong><small>{m.email}{m.title ? ` · ${m.title}` : ''}{online.has(m.id) ? ` · on ${presence.find(p => p.id === m.id)?.location || '/'}` : m.joinedAt ? ` · joined ${timeAgo(m.joinedAt)}` : ''}</small></span>
      {m.role === 'OWNER' ? <em><Crown size={9}/> OWNER</em> : admin && m.id !== data.currentUserId && !(data.role === 'ADMIN' && m.role === 'ADMIN') ? <div className="team-controls"><select aria-label={`Role for ${m.name}`} value={m.role} onChange={e => changeRole(m.id, e.target.value)}>{data.role === 'OWNER' && <option>ADMIN</option>}<option>MEMBER</option><option>VIEWER</option></select>{data.role === 'OWNER' && <button className="text-button" onClick={() => transfer(m)} title="Transfer ownership"><Crown size={12}/></button>}<button className="text-button danger" onClick={() => remove(m)}>Remove</button></div> : <em>{m.role}</em>}</div>)}</section>
      <section>{admin && <><div className="eyebrow">PENDING INVITES · {data.invites.length}</div>{data.invites.map(i => <div className="team-row" key={i.id}><Users size={17}/><span><strong>{i.email}</strong><small>{i.role.toLowerCase()} · expires {timeAgo(i.expiresAt).replace(' ago', '') === 'just now' ? 'soon' : new Date(i.expiresAt).toLocaleDateString()}{i.invitedBy ? ` · by ${i.invitedBy}` : ''}</small></span><button className="text-button" onClick={() => { navigator.clipboard.writeText(location.origin + i.inviteUrl); notify('Invite link copied'); }}>Copy link</button><button className="icon-button" aria-label="Revoke invite" title="Revoke invite" onClick={() => api(`/api/team/invitations/${i.id}`, { method: 'DELETE' }).then(load)}><Trash2 size={15}/></button></div>)}{!data.invites.length && <p className="inline-empty">No pending invites.</p>}</>}
        <div className="eyebrow zy-gap-top">WORKSPACE ACTIVITY</div><ActivityFeed items={activity} compact/></section></div></>;
}
