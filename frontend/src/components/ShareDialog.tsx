import { useEffect, useState } from 'react';
import { Globe2, Lock, Save, X } from 'lucide-react';
import { api, errorMessage, type Member } from '../lib/api';

/**
 * Sharing for any workspace item: visible to the whole workspace, or private to the
 * owner plus selected members. The backend enforces the same rule on every read.
 */
export default function ShareDialog({ title, visibility, shared, ownerId, onClose, onSave }: {
  title: string; visibility: 'workspace' | 'private'; shared: string[]; ownerId?: string;
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
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}><Save size={14}/> {busy ? 'Saving…' : 'Save access'}</button></div>
    </form>
  </div>;
}
