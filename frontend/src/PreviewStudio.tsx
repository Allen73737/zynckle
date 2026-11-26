import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Check, Code2, ExternalLink, Laptop, Layers, LoaderCircle, Monitor, Pencil, Plus, RefreshCw, RotateCw, Share2, ShieldAlert, ShieldCheck, Smartphone, Tablet, Terminal, Trash2, X } from 'lucide-react';
import ShareDialog from './components/ShareDialog';
import { api, errorMessage, timeAgo } from './lib/api';

type Preview = { id: string; title: string; url: string; description: string; projectId?: string | null; project?: string | null; kind: 'url' | 'code-site'; codeProjectId?: string | null; ownerId: string; owner: string; visibility: 'workspace' | 'private'; sharedWith: string[]; createdAt: string };
type Project = { id: string | number; name: string };
type Check = { reachable: boolean | null; embeddable: boolean | null; reason: string; status?: number };
const VIEWPORTS = { desktop: { label: 'Desktop', width: 0, icon: Monitor }, laptop: { label: 'Laptop · 1280', width: 1280, icon: Laptop }, tablet: { label: 'Tablet · 768', width: 768, icon: Tablet }, mobile: { label: 'Mobile · 390', width: 390, icon: Smartphone } } as const;
type Viewport = keyof typeof VIEWPORTS;

export default function PreviewStudio({ projects, notify, canEdit, isAdmin, accountId }: { token: string; projects: Project[]; notify: (message: string) => void; canEdit: boolean; isAdmin: boolean; accountId?: string }) {
  const [params, setParams] = useSearchParams();
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [active, setActive] = useState<Preview | null>(null);
  const [frameUrl, setFrameUrl] = useState('');
  const [form, setForm] = useState({ kind: 'url' as 'url' | 'code-site', url: '', title: '', description: '', projectId: '', codeProjectId: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Preview | null>(null);
  const [codeProjects, setCodeProjects] = useState<{ id: string; name: string; hasSite: boolean }[]>([]);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [landscape, setLandscape] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [sharing, setSharing] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [multiSyncMode, setMultiSyncMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const seedDemoPreviews = async () => {
    try {
      const demo = await api<Preview>('/api/previews', {
        body: {
          url: 'https://example.com',
          title: 'Example Responsive Site',
          description: 'Standard responsive reference site for viewport verification.',
          kind: 'url'
        }
      });
      setPreviews(items => [demo, ...(items || [])]);
      select(demo);
      notify('Demo preview added to your workspace');
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const testDirectUrl = (e: React.FormEvent) => {
    e.preventDefault();
    let url = directUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const tempPreview: Preview = {
      id: 'direct-probe-' + Date.now(),
      title: url.replace(/^https?:\/\//i, '').split('/')[0] || 'Direct Probe',
      url,
      description: 'Quick-tested URL',
      kind: 'url',
      ownerId: accountId || 'local',
      owner: 'You',
      visibility: 'workspace',
      sharedWith: [],
      createdAt: new Date().toISOString()
    };
    select(tempPreview);
    setDirectUrl('');
  };

  useEffect(() => {
    api<Preview[]>('/api/previews').then(data => { setPreviews(data); select(data.find(p => p.id === params.get('preview')) || data[0] || null); }).catch(e => { setError(errorMessage(e, 'Preview links could not be loaded')); setPreviews([]); });
    api<{ id: string; name: string; hasSite: boolean }[]>('/api/code-projects').then(setCodeProjects).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = async (preview: Preview | null) => {
    setActive(preview); setCheck(null); setFrameUrl('');
    if (!preview) return;
    setParams(p => { const n = new URLSearchParams(p); n.set('preview', preview.id); return n; }, { replace: true });
    if (preview.kind === 'code-site' && preview.codeProjectId) {
      try { setFrameUrl((await api<{ url: string }>(`/api/code-projects/${preview.codeProjectId}/site`)).url); setCheck({ reachable: true, embeddable: true, reason: 'Served from a Zynckle code project in a sandboxed frame' }); }
      catch (e) { setCheck({ reachable: false, embeddable: false, reason: errorMessage(e) }); }
      return;
    }
    setFrameUrl(preview.url);
    setChecking(true);
    api<Check>('/api/previews/check', { body: { url: preview.url } }).then(setCheck).catch(() => setCheck(null)).finally(() => setChecking(false));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      if (editing) {
        const data = await api<Preview>(`/api/previews/${editing.id}`, { method: 'PATCH', body: { title: form.title, description: form.description, projectId: form.projectId || null, ...(editing.kind === 'url' ? { url: form.url } : {}) } });
        setPreviews(items => (items || []).map(p => p.id === data.id ? data : p)); select(data); notify('Preview updated');
      } else {
        let url = form.url.trim();
        if (form.kind === 'url') { try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); url = parsed.toString(); } catch { setError('Enter a complete http or https URL.'); return; } }
        else url = `${location.origin}/code/${form.codeProjectId}`;
        const data = await api<Preview>('/api/previews', { body: { url, title: form.title.trim() || (form.kind === 'url' ? new URL(url).hostname : codeProjects.find(c => c.id === form.codeProjectId)?.name), description: form.description, projectId: form.projectId || undefined, kind: form.kind, codeProjectId: form.codeProjectId || undefined } });
        setPreviews(items => [data, ...(items || [])]); select(data); notify('Preview saved to your workspace');
      }
      setFormOpen(false); setEditing(null);
    } catch (e) { setError(errorMessage(e, 'Preview could not be saved')); }
  };

  const startEdit = (preview: Preview) => { setEditing(preview); setForm({ kind: preview.kind, url: preview.url, title: preview.title, description: preview.description, projectId: preview.projectId || '', codeProjectId: preview.codeProjectId || '' }); setFormOpen(true); };
  const remove = async (preview: Preview) => {
    if (!window.confirm(`Remove ${preview.title} from previews?`)) return;
    try { await api(`/api/previews/${preview.id}`, { method: 'DELETE' }); const next = (previews || []).filter(item => item.id !== preview.id); setPreviews(next); select(next[0] || null); notify('Preview removed'); }
    catch (e) { setError(errorMessage(e, 'Preview could not be removed')); }
  };

  const width = VIEWPORTS[viewport].width;
  const frameWidth = landscape && (viewport === 'mobile' || viewport === 'tablet') ? (viewport === 'mobile' ? 844 : 1024) : width;
  const sites = codeProjects.filter(c => c.hasSite);

  return <>
    <section className="welcome-row subpage-welcome">
      <div>
        <div className="eyebrow">ZYNCKLE PREVIEW · RESPONSIVE CHECK</div>
        <h1>See the <em>whole picture.</em></h1>
        <p className="welcome-sub">Save deployed sites or static sites from Zynckle Code, compare viewports, and open externally when framing is blocked.</p>
      </div>
      <div className="zy-head-actions">
        <form className="zy-probe-form" onSubmit={testDirectUrl}>
          <input className="zy-probe-input" value={directUrl} onChange={e => setDirectUrl(e.target.value)} placeholder="Inspect URL (https://…)" aria-label="Inspect URL"/>
          <button type="submit" className="button-secondary" disabled={!directUrl.trim()}>Probe</button>
        </form>
        {canEdit && <button className="button-primary" onClick={() => { setEditing(null); setForm({ kind: 'url', url: '', title: '', description: '', projectId: '', codeProjectId: sites[0]?.id || '' }); setFormOpen(true); }}><Plus size={15}/> Add preview</button>}
      </div>
    </section>
    {error && <div className="zy-inline-error" role="alert"><X size={13}/>{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
    <div className="preview-workspace">
      <aside className="preview-links"><div className="eyebrow">SAVED LINKS · {previews?.length ?? '—'}</div>
        {previews === null && <div className="zy-skeleton-rows small"><i/><i/></div>}
        {previews?.map(preview => <div className={`preview-link ${active?.id === preview.id ? 'selected' : ''}`} key={preview.id}><button onClick={() => select(preview)}><strong>{preview.kind === 'code-site' && <Code2 size={10}/>} {preview.title}</strong><small>{preview.kind === 'code-site' ? 'Static site from Zynckle Code' : preview.url}</small>{preview.project && <small>{preview.project}</small>}</button>
          {canEdit && <button className="icon-button danger" aria-label={`Remove ${preview.title}`} title="Remove preview" onClick={() => remove(preview)}><Trash2 size={14}/></button>}</div>)}
        {previews?.length === 0 && (
          <div className="zy-empty-panel">
            <p className="welcome-sub">Save a deployed site to add it to this list.</p>
            {canEdit && <button className="button-secondary zy-gap-top" onClick={seedDemoPreviews}><Plus size={13}/> Load demo preview</button>}
          </div>
        )}
      </aside>
      <section className="preview-stage">
        <div className="preview-stage-toolbar"><span className="zy-stage-title">{active?.title || 'Preview stage'}{active && check && <em className={check.embeddable ? 'ok' : check.embeddable === false ? 'blocked' : ''} title={check.reason}>{check.embeddable ? <ShieldCheck size={11}/> : <ShieldAlert size={11}/>}{check.embeddable ? 'Embeddable' : check.embeddable === false ? 'Embedding blocked' : 'Not checked'}</em>}{checking && <LoaderCircle size={11} className="spin"/>}</span>
          <div className="viewport-controls">
            <button
              className={multiSyncMode ? 'active' : ''}
              onClick={() => setMultiSyncMode(m => !m)}
              aria-label="Multi-Device Matrix"
              title={multiSyncMode ? 'Switch to single viewport' : 'Multi-Device Matrix (Desktop, Tablet, Mobile)'}
            >
              <Layers size={15}/>
            </button>
            <button
              className={inspectorOpen ? 'active' : ''}
              onClick={() => setInspectorOpen(o => !o)}
              aria-label="Telemetry Inspector"
              title="Toggle bottom telemetry inspector"
            >
              <Terminal size={15}/>
            </button>
            {(Object.keys(VIEWPORTS) as Viewport[]).map(v => { const Icon = VIEWPORTS[v].icon; return <button key={v} className={!multiSyncMode && viewport === v ? 'active' : ''} onClick={() => { setViewport(v); setMultiSyncMode(false); }} aria-label={VIEWPORTS[v].label} title={VIEWPORTS[v].label}><Icon size={15}/></button>; })}
            {(viewport === 'mobile' || viewport === 'tablet') && !multiSyncMode && <button onClick={() => setLandscape(l => !l)} aria-label="Rotate" title="Rotate"><RotateCw size={14}/></button>}
            {active && <button onClick={() => setReloadKey(k => k + 1)} aria-label="Reload preview" title="Reload"><RefreshCw size={14}/></button>}
            {active && canEdit && (active.ownerId === accountId || isAdmin) && <button onClick={() => setSharing(active)} aria-label="Share" title="Share"><Share2 size={14}/></button>}
            {active && canEdit && <button onClick={() => startEdit(active)} aria-label="Edit preview" title="Edit"><Pencil size={14}/></button>}
            {active && <button className="preview-external" onClick={() => window.open(frameUrl || active.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={14}/> Open externally</button>}
          </div></div>
        {active?.description && <p className="zy-preview-desc">{active.description}</p>}
        <div className="site-preview">
          {active && check?.embeddable === false && check.reachable !== false && <div className="zy-frame-warning"><ShieldAlert size={16}/><div><strong>This site prevents iframe embedding</strong><small>{check.reason}. Click “Open externally” to view in a new tab.</small></div></div>}
          {active && check?.reachable === false && <div className="zy-frame-warning"><ShieldAlert size={16}/><div><strong>The site could not be reached</strong><small>{check.reason}</small></div></div>}

          {multiSyncMode && active && frameUrl && check?.embeddable !== false ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, width: '100%', padding: '12px 0' }}>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-m)', padding: 8, background: 'var(--surface-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 6 }}><Monitor size={12}/> Desktop Matrix (1440 × 900)</div>
                <iframe key={`desktop-${frameUrl}-${reloadKey}`} title="Desktop View" src={frameUrl} style={{ width: '100%', height: 440, border: 'none', background: '#fff' }} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-m)', padding: 8, background: 'var(--surface-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 6 }}><Tablet size={12}/> Tablet Matrix (768 × 1024)</div>
                <iframe key={`tablet-${frameUrl}-${reloadKey}`} title="Tablet View" src={frameUrl} style={{ width: '100%', height: 440, border: 'none', background: '#fff' }} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-m)', padding: 8, background: 'var(--surface-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 6 }}><Smartphone size={12}/> Mobile Matrix (390 × 844)</div>
                <iframe key={`mobile-${frameUrl}-${reloadKey}`} title="Mobile View" src={frameUrl} style={{ width: '100%', height: 440, border: 'none', background: '#fff' }} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/>
              </div>
            </div>
          ) : (
            <div className={`preview-frame preview-${viewport}`} style={frameWidth ? { maxWidth: frameWidth } : undefined}>
              {active && frameUrl ? (
                check?.embeddable === false ? (
                  <div className="doc-empty zy-blocked-frame">
                    <ShieldAlert size={36}/>
                    <h2>{active.title} protects frame embedding</h2>
                    <p>{check.reason}. To view this site safely, launch it directly in a dedicated tab.</p>
                    <button className="button-primary" onClick={() => window.open(frameUrl || active.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={14}/> Open externally</button>
                  </div>
                ) : (
                  <iframe key={`${frameUrl}-${reloadKey}`} title={`Preview of ${active.title}`} src={frameUrl} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy"/>
                )
              ) : (
                <div className="doc-empty">
                  <Activity/>
                  <h2>Your preview stage</h2>
                  <p>Save a public deployment URL, or a Zynckle Code project containing index.html.</p>
                  {canEdit && previews?.length === 0 && <button className="button-secondary zy-gap-top" onClick={seedDemoPreviews}><Plus size={14}/> Add demo preview</button>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Console & Security Telemetry Drawer */}
        {inspectorOpen && (
          <div style={{
            marginTop: 16, border: '1px solid var(--line)', borderRadius: 'var(--radius-m)',
            background: 'var(--surface-soft)', padding: 14, fontFamily: "'DM Mono', monospace", fontSize: 12
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Terminal size={14}/>
                <strong>Viewport Security & Telemetry Audit</strong>
              </div>
              <button className="icon-button" onClick={() => setInspectorOpen(false)}><X size={13}/></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, color: 'var(--ink)' }}>
              <div>• Origin Isolation: <span style={{ color: 'var(--ink-strong)' }}>Active (sandbox="allow-scripts")</span></div>
              <div>• Anti-SSRF Guard: <span style={{ color: 'var(--ink-strong)' }}>Enforced (Private IPs blocked)</span></div>
              <div>• Frame Embedding: <span style={{ color: check?.embeddable ? 'var(--ink-strong)' : 'var(--muted)' }}>{check?.embeddable ? 'Allowed' : check?.reason || 'Checking…'}</span></div>
              <div>• Referrer Policy: <span style={{ color: 'var(--ink-strong)' }}>no-referrer</span></div>
            </div>
          </div>
        )}
        <p className="preview-footnote">{active ? `${VIEWPORTS[viewport].label}${landscape ? ' (landscape)' : ''} · added ${timeAgo(active.createdAt)} by ${active.owner}. ` : ''}Frames are sandboxed. Uploaded applications are not executed on Zynckle servers; framework apps should be previewed from their deployed URL.</p>
      </section>
    </div>
    {formOpen && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setFormOpen(false)}><form className="modal" onSubmit={save}>
      <div className="modal-head"><div><div className="eyebrow">ZYNCKLE PREVIEW</div><h2>{editing ? 'Edit preview' : 'Add a preview'}</h2></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Close"><X size={18}/></button></div>
      {!editing && <div className="zy-segmented" role="radiogroup"><button type="button" className={form.kind === 'url' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, kind: 'url' }))}><ExternalLink size={13}/> Deployed URL</button><button type="button" className={form.kind === 'code-site' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, kind: 'code-site' }))} disabled={!sites.length} title={sites.length ? '' : 'Add an index.html to a code project first'}><Code2 size={13}/> Static site from Code</button></div>}
      {form.kind === 'url' ? <label>Website URL<input autoFocus required value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://your-site.example"/></label>
        : !editing && <label>Code project<select value={form.codeProjectId} onChange={e => setForm(f => ({ ...f, codeProjectId: e.target.value }))} required>{sites.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <label>Name <span className="optional">OPTIONAL</span><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={120} placeholder="Marketing site · staging"/></label>
      <label>Description <span className="optional">OPTIONAL</span><textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} maxLength={1000} placeholder="What should reviewers look at?"/></label>
      <label>Project <span className="optional">OPTIONAL</span><select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}><option value="">No project</option>{projects.filter(p => typeof p.id === 'string').map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="button-primary"><Check size={14}/> {editing ? 'Save changes' : 'Save preview'}</button></div>
    </form></div>}
    {sharing && <ShareDialog linksBase={`/api/previews/${sharing.id}`} linksNoun="preview" linksBlocked={sharing.kind === 'code-site' ? 'Code-project previews are only available to signed-in members. Add the deployed URL as a preview to share it publicly.' : ''} canEdit={canEdit} title={sharing.title} visibility={sharing.visibility} shared={sharing.sharedWith || []} ownerId={sharing.ownerId} onClose={() => setSharing(null)} onSave={async v => { const data = await api<Preview>(`/api/previews/${sharing.id}`, { method: 'PATCH', body: { visibility: v.visibility, sharedWith: v.shared } }); setPreviews(list => (list || []).map(p => p.id === data.id ? data : p)); setActive(data); notify('Access updated'); }}/>}
  </>;
}
