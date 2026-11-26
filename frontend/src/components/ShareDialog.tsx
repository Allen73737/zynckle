import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Globe2, Link2, Lock, Save, Trash2, X } from 'lucide-react';
import { api, errorMessage, timeAgo, type Member } from '../lib/api';

type PublicLink = { id: string; createdAt: string; expiresAt: string | null; views: number };

/**
 * Read-only public links for a document or website preview. The full URL is returned only when a link is created
 * (the server keeps a hash), so it is shown once with a copy button.
 */
function PublicLinks({ base, disabledReason, canEdit, noun }: { base: string; disabledReason: string; canEdit: boolean; noun: string }) {
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [days, setDays] = useState(30);
  const [fresh, setFresh] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => api<PublicLink[]>(`${base}/share-links`).then(setLinks).catch(e => setError(errorMessage(e, 'Public links could not be loaded'))), [base]);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const link = await api<PublicLink & { url: string }>(`${base}/share-links`, { body: { expiresInDays: days } });
      setFresh(new URL(link.url, window.location.origin).toString());
      load();
    } catch (e) { setError(errorMessage(e, 'The link could not be created')); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this link? Anyone using it will lose access.')) return;
    try { await api(`/api/share-links/${id}`, { method: 'DELETE' }); setLinks(l => l.filter(x => x.id !== id)); }
    catch (e) { setError(errorMessage(e, 'The link could not be revoked')); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard blocked: the field is selectable */ }
  };
  return <section className="zy-public-links" aria-labelledby="public-links-title">
    <div className="eyebrow" id="public-links-title"><Link2 size={12}/> PUBLIC READ-ONLY LINK</div>
    {disabledReason ? <p className="zy-muted-note">{disabledReason}</p> : <>
      <p className="zy-muted-note">Anyone with the link can view this {noun} without signing in. They cannot edit it or see anything else in the workspace.</p>
      {canEdit && <div className="zy-public-create">
        <label>Expires<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>in 1 day</option><option value={7}>in 7 days</option><option value={30}>in 30 days</option><option value={365}>in 1 year</option><option value={0}>never</option></select></label>
        <button type="button" className="button-secondary" onClick={create} disabled={busy}><Link2 size={14}/> {busy ? 'Creating…' : 'Create link'}</button>
      </div>}
      {fresh && <div className="zy-public-fresh" role="status"><input readOnly value={fresh} aria-label="New public link" onFocus={e => e.currentTarget.select()}/><button type="button" className="button-secondary" onClick={copy}>{copied ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}</button><small>Copy it now: for security it will not be shown again.</small></div>}
    </>}
    {links.length > 0 && <ul className="zy-public-list">{links.map(l => <li key={l.id}>
      <span><strong>Link created {timeAgo(l.createdAt)}</strong><small>{l.views} view{l.views === 1 ? '' : 's'} · {l.expiresAt ? (new Date(l.expiresAt) < new Date() ? 'expired' : `expires ${new Date(l.expiresAt).toLocaleDateString()}`) : 'never expires'}</small></span>
      {canEdit && <button type="button" className="icon-button danger" onClick={() => revoke(l.id)} aria-label="Revoke link" title="Revoke"><Trash2 size={14}/></button>}
    </li>)}</ul>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </section>;
}

/**
 * Sharing for any workspace item: visible to the whole workspace, or private to the
 * owner plus selected members. The backend enforces the same rule on every read.
 */
export default function ShareDialog({ title, visibility, shared, ownerId, onClose, onSave, linksBase, linksNoun = 'document', linksBlocked = '', canEdit = true }: {
  title: string; visibility: 'workspace' | 'private'; shared: string[]; ownerId?: string; canEdit?: boolean;
  /** e.g. /api/documents/<id>: enables the public-link section. */ linksBase?: string; linksNoun?: string; linksBlocked?: string;
  onClose: () => void; onSave: (value: { visibility: 'workspace' | 'private'; shared: string[] }) => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [mode, setMode] = useState(visibility);
  const [picked, setPicked] = useState<string[]>(shared);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<{ members: Member[] }>('/api/team').then(data => setMembers(data.members.filter(m => m.id !== ownerId))).catch(() => setError('Workspace members could not be loaded')); }, [ownerId]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave({ visibility: mode, shared: mode === 'private' ? picked : [] }); onClose(); }
    catch (e) { setError(errorMessage(e, 'Sharing could not be updated')); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form className="modal zy-share" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="modal-head"><div><div className="eyebrow">SHARING & ACCESS</div><h2 id="share-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      <div className="zy-share-modes" role="radiogroup">
        <button type="button" role="radio" aria-checked={mode === 'workspace'} className={mode === 'workspace' ? 'active' : ''} onClick={() => setMode('workspace')}><Globe2 size={16}/><span><strong>Everyone in this workspace</strong><small>Members can open it; viewers can only read.</small></span></button>
        <button type="button" role="radio" aria-checked={mode === 'private'} className={mode === 'private' ? 'active' : ''} onClick={() => setMode('private')}><Lock size={16}/><span><strong>Only people I choose</strong><small>Private to the owner and selected members.</small></span></button>
      </div>
      {mode === 'private' && <div className="zy-share-people"><div className="eyebrow">SHARE WITH</div>{members.length ? members.map(m => <label key={m.id} className="zy-check"><input type="checkbox" checked={picked.includes(m.id)} onChange={() => setPicked(p => p.includes(m.id) ? p.filter(x => x !== m.id) : [...p, m.id])}/><span className="avatar avatar-self">{m.avatar}</span><span><strong>{m.name}</strong><small>{m.email} · {m.role?.toLowerCase()}</small></span></label>) : <p className="zy-muted-note">No other members yet. Invite people from Team.</p>}</div>}
      {linksBase && <PublicLinks base={linksBase} noun={linksNoun} canEdit={canEdit} disabledReason={linksBlocked || (visibility !== 'workspace' ? `Save this ${linksNoun} as visible to the workspace before creating a public link.` : '')}/>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}><Save size={14}/> {busy ? 'Saving…' : 'Save access'}</button></div>
    </form>
  </div>;
}
