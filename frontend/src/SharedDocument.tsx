import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { ExternalLink, Monitor, Smartphone, Tablet } from 'lucide-react';
import { api, errorMessage, timeAgo } from './lib/api';
import './rich-text.css';

type Shared =
  | { kind?: 'document'; title: string; type: string; content: string; workspace: string; updated: string | null }
  | { kind: 'preview'; title: string; url: string; description: string; workspace: string; updated: string | null };

const VIEWPORTS = { desktop: { label: 'Desktop', width: 0, icon: Monitor }, tablet: { label: 'Tablet', width: 768, icon: Tablet }, mobile: { label: 'Mobile', width: 390, icon: Smartphone } } as const;
type Viewport = keyof typeof VIEWPORTS;

/** Public, read-only view of a document or website preview opened from a share link. No sign-in, no app chrome. */
export default function SharedDocument({ token }: { token: string }) {
  const [item, setItem] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState<Viewport>('desktop');

  useEffect(() => {
    api<Shared>(`/api/public/share/${encodeURIComponent(token)}`)
      .then(data => { setItem(data); document.title = `${data.title} · Zynckle`; })
      .catch(e => setError(errorMessage(e, 'This link could not be opened')));
  }, [token]);

  const isPreview = item?.kind === 'preview';
  return <div className={`zy-shared-page ${isPreview ? 'wide' : ''}`}>
    <header className="zy-shared-head">
      <a className="brand" href="/"><span className="brand-mark">z</span><span>zynckle</span></a>
      <span className="zy-shared-badge">{isPreview ? 'Shared website preview' : 'Read-only shared document'}</span>
    </header>
    <main className="zy-shared-main">
      {error ? <div className="empty-state" role="alert"><h1>Link unavailable</h1><p>{error}</p></div>
        : !item ? <p className="zy-muted-note" role="status">Opening the shared link…</p>
        : item.kind === 'preview' ? <article>
          <div className="eyebrow">{item.workspace}{item.updated && ` · added ${timeAgo(item.updated)}`}</div>
          <h1>{item.title}</h1>
          {item.description && <p className="zy-shared-desc">{item.description}</p>}
          <div className="zy-shared-toolbar">
            <div className="zy-segmented small" role="radiogroup" aria-label="Viewport">
              {(Object.keys(VIEWPORTS) as Viewport[]).map(v => { const { label, icon: Icon } = VIEWPORTS[v]; return <button key={v} role="radio" aria-checked={viewport === v} className={viewport === v ? 'active' : ''} onClick={() => setViewport(v)}><Icon size={13}/> {label}</button>; })}
            </div>
            <a className="button-secondary" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Open the site</a>
          </div>
          <div className="zy-shared-frame-wrap">
            {/* Sandboxed: the site runs, but cannot reach this page or its storage. */}
            <iframe className="zy-shared-frame" style={VIEWPORTS[viewport].width ? { width: VIEWPORTS[viewport].width } : undefined}
              src={item.url} title={item.title} sandbox="allow-scripts allow-forms allow-popups allow-same-origin" referrerPolicy="no-referrer" loading="lazy"/>
          </div>
          <p className="zy-muted-note">Blank frame? Some sites refuse to be shown inside other pages. Use “Open the site” instead.</p>
        </article>
        : <article>
          <div className="eyebrow">{item.workspace}{item.updated && ` · updated ${timeAgo(item.updated)}`}</div>
          <h1>{item.title}</h1>
          {item.type === 'latex'
            ? <pre className="zy-shared-source">{item.content}</pre>
            : <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.content) }}/>}
        </article>}
    </main>
  </div>;
}
