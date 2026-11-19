import { useEffect, useState } from 'react';
import { Bell, Bot, HardDrive, Info, KeyRound, Laptop, Monitor, Moon, Palette, Plug, Save, Shield, Sun, Trash2, User, Users, MailCheck, ScrollText, ArrowRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api, errorMessage, formatBytes, timeAgo } from './lib/api';
import { ActivityFeed, type ActivityItem } from './ProjectViews';
import { PLATFORM_TOPICS } from './AboutStudio';

export type Account = { id?: string; name: string; email: string; role: string; title?: string; bio?: string; emailVerified?: boolean; hasPassword?: boolean; notificationPrefs?: Record<string, boolean>; preferences?: Record<string, unknown> };
type Session = { id: string; createdAt: string; lastSeenAt: string; userAgent: string; ip: string; current: boolean };
type Integration = { id: string; name: string; status: string; detail: string; env: string[] };
type Provider = { id: string; label: string; configured: boolean; defaultModel: string; models: string[] };

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User }, { id: 'security', label: 'Security', icon: Shield }, { id: 'workspace', label: 'Workspace', icon: Users },
  { id: 'appearance', label: 'Appearance', icon: Palette }, { id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'ai', label: 'AI providers', icon: Bot },
  { id: 'storage', label: 'Storage', icon: HardDrive }, { id: 'integrations', label: 'Integrations', icon: Plug }, { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'about', label: 'About Zynckle', icon: Info }, { id: 'danger', label: 'Delete account', icon: Trash2 },
];
const NOTIFY_LABELS: Record<string, string> = { task: 'Task assignments & completions', mention: 'Mentions', comment: 'Comments on things I follow', project: 'Project updates', file: 'Files & documents shared with me', deadline: 'Deadline reminders', team: 'Team changes', invite: 'Workspace invitations' };
const device = (ua: string) => `${/Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Device'} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'}`;

export default function SettingsStudio({ account, workspace, workspaceId, workspaceCount, theme, onThemeChoice, onAccount, onWorkspace, onSignOut, notify }: {
  token: string; account: Account; workspace: string; workspaceId: string; workspaceCount: number; theme: string; onThemeChoice: (t: 'light' | 'dark' | 'system') => void;
  onAccount: (v: Account) => void; onWorkspace: (v: string) => void; onSignOut: () => void; notify: (s: string) => void;
}) {
  const [section, setSection] = useState(() => location.hash.slice(1) || 'profile');
  const [profile, setProfile] = useState({ name: account.name, email: account.email, title: account.title || '', bio: account.bio || '' });
  const [workspaceName, setWorkspaceName] = useState(workspace);
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(account.notificationPrefs || {});
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [aiPref, setAiPref] = useState({ provider: String(account.preferences?.aiProvider || ''), model: String(account.preferences?.aiModel || '') });
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number; fileCount: number; byType: Record<string, number>; driver: string; maxUploadBytes: number } | null>(null);
  const [audit, setAudit] = useState<ActivityItem[] | null>(null);
  const [verifyLink, setVerifyLink] = useState('');
  const admin = ['OWNER', 'ADMIN'].includes(account.role);

  useEffect(() => { setProfile({ name: account.name, email: account.email, title: account.title || '', bio: account.bio || '' }); setWorkspaceName(workspace); setPrefs(account.notificationPrefs || {}); }, [account, workspace]);
  useEffect(() => { const onHash = () => setSection(location.hash.slice(1) || 'profile'); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => {
    setError('');
    if (section === 'security' && !sessions) api<Session[]>('/api/auth/sessions').then(setSessions).catch(() => setSessions([]));
    if (section === 'integrations' && !integrations.length) api<Integration[]>('/api/integrations').then(setIntegrations).catch(() => {});
    if (section === 'ai' && !providers.length) api<{ providers: Provider[] }>('/api/ai/status').then(s => setProviders(s.providers)).catch(() => {});
    if (section === 'storage' && !usage) api<typeof usage>('/api/storage/usage').then(setUsage).catch(() => {});
    if (section === 'audit' && !audit && admin) api<ActivityItem[]>('/api/audit').then(setAudit).catch(() => setAudit([]));
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id: string) => { history.replaceState({}, '', `#${id}`); setSection(id); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };

  const saveProfile = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const d = await api<Account & { verifyUrl?: string }>('/api/auth/profile', { method: 'PATCH', body: profile }); onAccount({ ...account, ...d }); if (d.verifyUrl) setVerifyLink(d.verifyUrl); notify('Profile updated'); }); };
  const resendVerification = () => run(async () => { const d = await api<{ verifyUrl?: string; verified?: boolean }>('/api/auth/verify/resend', { method: 'POST' }); if (d.verified) notify('Email already verified'); else { if (d.verifyUrl) setVerifyLink(d.verifyUrl); notify('Verification link created'); } });
  const saveWorkspace = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const d = await api<{ name: string }>('/api/workspace', { method: 'PATCH', body: { name: workspaceName } }); onWorkspace(d.name); notify('Workspace name updated'); }); };
  const changePassword = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await api('/api/auth/password', { method: 'PATCH', body: { currentPassword: passwords.current, newPassword: passwords.next } }); setPasswords({ current: '', next: '' }); setSessions(null); notify('Password changed; other sessions were signed out'); }); };
  const revoke = (s: Session) => run(async () => { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }); setSessions(list => list?.filter(x => x.id !== s.id) || null); notify('Session signed out'); });
  const revokeOthers = () => run(async () => { const r = await api<{ revoked: number }>('/api/auth/sessions/revoke-others', { method: 'POST' }); setSessions(list => list?.filter(x => x.current) || null); notify(`${r.revoked} other session${r.revoked === 1 ? '' : 's'} signed out`); });
  const togglePref = (key: string, value: boolean) => { const next = { ...prefs, [key]: value }; setPrefs(next); api('/api/auth/notification-prefs', { method: 'PATCH', body: { [key]: value } }).then(() => onAccount({ ...account, notificationPrefs: next })).catch(e => setError(errorMessage(e))); };
  const saveAi = () => run(async () => { await api('/api/auth/preferences', { method: 'PATCH', body: { aiProvider: aiPref.provider, aiModel: aiPref.model } }); onAccount({ ...account, preferences: { ...account.preferences, aiProvider: aiPref.provider, aiModel: aiPref.model } }); notify('AI preference saved'); });
  const deleteWorkspace = () => { if (account.role !== 'OWNER') return setError('Only the workspace owner can delete it'); if (workspaceCount < 2) return setError('Create another workspace before deleting your only workspace'); if (!window.confirm(`Delete workspace ${workspace} and all of its saved content? This cannot be undone.`)) return; run(async () => { await api(`/api/workspaces/${workspaceId}`, { method: 'DELETE' }); window.location.assign('/'); }); };
  const deleteAccount = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await api('/api/auth/account', { method: 'DELETE', body: { password: deletePassword } }); notify('Account deleted'); window.setTimeout(onSignOut, 350); }); };
  const provider = providers.find(p => p.id === aiPref.provider) || providers.find(p => p.configured);

  return <><section className="welcome-row subpage-welcome"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Make it <em>yours.</em></h1><p className="welcome-sub">Manage your profile, security, workspace, appearance and connected services.</p></div></section>
    <div className="zy-settings">
      <nav className="zy-settings-nav" aria-label="Settings sections">{SECTIONS.filter(s => s.id !== 'audit' || admin).map(s => <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => go(s.id)}><s.icon size={14}/>{s.label}</button>)}</nav>
      <div className="zy-settings-body">
        {error && <p className="auth-error" role="alert">{error}</p>}
        {section === 'profile' && <section className="settings-card"><div className="eyebrow">PROFILE</div><h2>Your details</h2>
          {!account.emailVerified && <div className="zy-banner"><MailCheck size={14}/><div><strong>Verify your email address</strong><small>Email delivery is not configured, so the verification link is written to the API log{verifyLink ? ' — or use the development link below' : ''}.</small></div><button className="text-button" onClick={resendVerification} disabled={busy}>Create link</button></div>}
          {verifyLink && <a className="zy-dev-link" href={verifyLink}>Development link: verify {account.email} →</a>}
          <form onSubmit={saveProfile}><label>Display name<input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} maxLength={100} required/></label><label>Email address<input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} required/></label><label>Role or title<input value={profile.title} onChange={e => setProfile(p => ({ ...p, title: e.target.value }))} maxLength={80} placeholder="e.g. Product designer"/></label><label>Short bio<textarea value={profile.bio} onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} maxLength={400} rows={3} className="zy-textarea"/></label><button className="button-primary" disabled={busy}><Save size={14}/> Save profile</button></form></section>}

        {section === 'security' && <><section className="settings-card"><div className="eyebrow">SECURITY</div><h2>Change password</h2><form onSubmit={changePassword}>{account.hasPassword !== false && <label>Current password<input type="password" value={passwords.current} onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))} autoComplete="current-password" required/></label>}<label>New password<input type="password" value={passwords.next} onChange={e => setPasswords(p => ({ ...p, next: e.target.value }))} autoComplete="new-password" minLength={10} maxLength={200} required/></label><div className="settings-caption">At least 10 characters including a number or symbol. Changing it signs out your other sessions.</div><button className="button-secondary" disabled={busy}><KeyRound size={14}/> Update password</button></form></section>
          <section className="settings-card"><div className="eyebrow">ACTIVE SESSIONS</div><h2>Where you’re signed in</h2>{sessions === null ? <div className="zy-skeleton-rows small"><i/><i/></div> : <div className="zy-session-list">{sessions.map(s => <div key={s.id} className="zy-session"><Laptop size={16}/><span><strong>{device(s.userAgent)}{s.current && <em> · this device</em>}</strong><small>Active {timeAgo(s.lastSeenAt)} · signed in {new Date(s.createdAt).toLocaleDateString()}{s.ip ? ` · ${s.ip.replace('::ffff:', '')}` : ''}</small></span>{!s.current && <button className="text-button danger" onClick={() => revoke(s)}>Sign out</button>}</div>)}</div>}
            {sessions && sessions.length > 1 && <button className="button-secondary" onClick={revokeOthers} disabled={busy}>Sign out all other sessions</button>}</section></>}

        {section === 'workspace' && <><section className="settings-card"><div className="eyebrow">WORKSPACE</div><h2>{workspace}</h2><form onSubmit={saveWorkspace}><label>Workspace name<input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} maxLength={80} required disabled={!admin}/></label><div className="settings-caption">Your role: {account.role.toLowerCase()}. Owners and admins can rename this workspace. Manage people and ownership from Team.</div><button className="button-primary" disabled={!admin || busy}><Save size={14}/> Save workspace</button></form></section>
          <section className="settings-card settings-danger"><div className="eyebrow">WORKSPACE OWNERSHIP</div><h2>Delete this workspace</h2><p>This removes all projects, tasks, documents, files, code and previews in the current workspace. Remove its members or transfer ownership first. You need another workspace to keep using Zynckle.</p><button className="button-secondary danger" onClick={deleteWorkspace} disabled={account.role !== 'OWNER' || workspaceCount < 2 || busy}><Trash2 size={14}/> Delete {workspace}</button></section></>}

        {section === 'appearance' && <section className="settings-card"><div className="eyebrow">APPEARANCE</div><h2>Quiet by design</h2><p>Choose a bright or low-light workspace, or follow your operating system. Your choice is saved immediately.</p>
          <div className="zy-theme-choices">{([['light', 'Light Mode', Sun, 'Crisp monochrome white & black'], ['dark', 'Dark Mode', Moon, 'Pitch black & stark white'], ['system', 'System Sync', Monitor, 'Follows OS preference']] as const).map(([value, label, Icon, sub]) => <button key={value} type="button" className={theme === value ? 'active' : ''} onClick={() => onThemeChoice(value)} aria-pressed={theme === value}><span className={`zy-theme-swatch ${value}`}><i/><b/></span><div className="theme-meta"><span className="theme-label"><Icon size={16}/>{label}</span><small className="theme-sub">{sub}</small></div>{theme === value && <span className="theme-active-tag">Active</span>}</button>)}</div></section>}

        {section === 'notifications' && <section className="settings-card"><div className="eyebrow">NOTIFICATIONS</div><h2>What deserves your attention</h2><p>Notifications arrive instantly in the notification centre. Turned-off kinds are not created for you.</p><div className="zy-toggle-list">{Object.entries(NOTIFY_LABELS).map(([key, label]) => <label key={key} className="zy-toggle"><span>{label}</span><input type="checkbox" role="switch" checked={prefs[key] !== false} onChange={e => togglePref(key, e.target.checked)}/><i aria-hidden="true"/></label>)}</div></section>}

        {section === 'ai' && <section className="settings-card"><div className="eyebrow">AI PROVIDERS</div><h2>Zynckle AI</h2><p>Provider keys live only in the backend environment and are never sent to the browser. Pick your preferred provider and model among those configured.</p>
          <div className="zy-provider-list">{providers.map(p => <div key={p.id} className="zy-provider"><span className={`zy-dot ${p.configured ? 'on' : ''}`}/><span><strong>{p.label}</strong><small>{p.configured ? `Configured · default model ${p.defaultModel}` : `Not configured · set ${p.id.toUpperCase()}_API_KEY`}</small></span></div>)}</div>
          {providers.some(p => p.configured) ? <div className="zy-inline-fields"><label>Preferred provider<select value={aiPref.provider} onChange={e => setAiPref({ provider: e.target.value, model: '' })}><option value="">Server default</option>{providers.filter(p => p.configured).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>{provider && <label>Model<select value={aiPref.model} onChange={e => setAiPref(a => ({ ...a, model: e.target.value }))}><option value="">Default ({provider.defaultModel})</option>{provider.models.map(m => <option key={m}>{m}</option>)}</select></label>}<button className="button-primary" onClick={saveAi} disabled={busy}><Save size={14}/> Save</button></div>
            : <div className="settings-caption">Add a key to the repository <code>.env</code> (see <code>.env.example</code>) and restart the API: <code>GROQ_API_KEY</code>, <code>GEMINI_API_KEY</code> or <code>OPENROUTER_API_KEY</code>. Optional: <code>AI_PROVIDER</code>, <code>AI_REQUESTS_PER_MINUTE</code>, <code>AI_REQUESTS_PER_DAY</code>.</div>}</section>}

        {section === 'storage' && <section className="settings-card"><div className="eyebrow">STORAGE</div><h2>{usage ? `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)}` : 'Workspace storage'}</h2>{usage && <><div className="zy-usage bare"><i><b style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }}/></i><ul>{Object.entries(usage.byType).map(([k, v]) => <li key={k}>{k}<em>{formatBytes(v)}</em></li>)}</ul></div><p>{usage.driver === 's3' ? 'Binary files are stored in your configured S3-compatible bucket (Cloudflare R2).' : 'Binary files are stored on the API host disk. Configure R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to use Cloudflare R2.'} Uploads are limited to {formatBytes(usage.maxUploadBytes)} per file. Metadata is stored separately from file contents.</p></>}</section>}

        {section === 'integrations' && <section className="settings-card"><div className="eyebrow">CONNECTED SERVICES</div><h2>Integrations</h2><p>Each integration reports its real status. Nothing here is simulated.</p><div className="zy-integrations">{integrations.map(i => <div key={i.id} className="zy-integration"><span className={`zy-pill ${i.status === 'connected' || i.status === 'available' ? 'ok' : ''}`}>{i.status.replace('-', ' ')}</span><strong>{i.name}</strong><small>{i.detail}</small>{i.env.length > 0 && <code>{i.env.join(' · ')}</code>}</div>)}</div></section>}

        {section === 'audit' && admin && <section className="settings-card"><div className="eyebrow">AUDIT LOG</div><h2>Sensitive changes</h2><p>Role changes, removals, sharing changes, deletions and ownership transfers in this workspace.</p><ActivityFeed items={audit}/></section>}

        {section === 'about' && (
          <section className="settings-card">
            <div className="eyebrow">ABOUT ZYNCKLE &amp; PLATFORM REFERENCE</div>
            <h2>The Unified Workspace Paradigm</h2>
            <p>
              Zynckle converges documents, LaTeX typesetting, agile task boards, code ide, and workspace-aware AI into a single local-first operating system.
            </p>

            <div className="about-telemetry-grid" style={{ margin: '14px 0 22px 0' }}>
              <div className="telemetry-card">
                <span className="telemetry-label">SYSTEM BUILD</span>
                <span className="telemetry-value">v2.4.0 Production</span>
                <span className="telemetry-status ok">● Local-First Resilience</span>
              </div>
              <div className="telemetry-card">
                <span className="telemetry-label">TEX VECTOR ENGINE</span>
                <span className="telemetry-value">&lt; 5ms Fast TeX</span>
                <span className="telemetry-status ok">● Pure-JS Zero-Freeze</span>
              </div>
              <div className="telemetry-card">
                <span className="telemetry-label">REALTIME COLLAB</span>
                <span className="telemetry-value">Yjs CRDTs</span>
                <span className="telemetry-status ok">● WebSockets Active</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>20 Foundational Architectural Topics</h3>
              <NavLink to="/about" className="text-button" style={{ fontSize: '12px', fontWeight: 600 }}>
                Open Full Interactive Showcase <ArrowRight size={13} />
              </NavLink>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {PLATFORM_TOPICS.map(topic => (
                <div key={topic.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-soft)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted-dim)', fontWeight: 700 }}>
                      {topic.id < 10 ? `0${topic.id}` : topic.id}
                    </span>
                    <strong style={{ fontSize: '13.5px', color: 'var(--ink-strong)' }}>{topic.title}</strong>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                      {topic.badge}
                    </span>
                  </div>
                  {topic.actionLink && (
                    <NavLink to={topic.actionLink} className="text-button" style={{ fontSize: '11.5px' }}>
                      View <ArrowRight size={12} />
                    </NavLink>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
              <NavLink to="/about" className="button-primary">
                Open Dedicated About &amp; Topics Page <ArrowRight size={14} />
              </NavLink>
            </div>
          </section>
        )}

        {section === 'danger' && <section className="settings-card settings-danger"><div className="eyebrow">ACCOUNT</div><h2>Delete your account</h2><p>This permanently removes your account, your private files and documents, your AI conversations and every workspace you own alone. If you own a workspace with other members, transfer ownership from Team first. Content you created in shared workspaces stays, attributed to “Former member”.</p>
          <form onSubmit={deleteAccount}>{account.hasPassword !== false && <label>Current password<input type="password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} required autoComplete="current-password"/></label>}<label>Type DELETE to confirm<input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} required/></label><button className="button-secondary danger" disabled={deleteConfirm !== 'DELETE' || busy}><Trash2 size={14}/> Permanently delete account</button></form></section>}
      </div>
    </div></>;
}
