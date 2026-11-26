import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { api, errorMessage, timeAgo } from './lib/api';
import './rich-text.css';

type Shared = { title: string; type: string; content: string; workspace: string; updated: string | null };

/** Public, read-only view of a document opened from a share link. No sign-in, no app chrome. */
export default function SharedDocument({ token }: { token: string }) {
  const [doc, setDoc] = useState<Shared | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Shared>(`/api/public/share/${encodeURIComponent(token)}`)
      .then(data => { setDoc(data); document.title = `${data.title} · Zynckle`; })
      .catch(e => setError(errorMessage(e, 'This link could not be opened')));
  }, [token]);

  return <div className="zy-shared-page">
    <header className="zy-shared-head">
      <a className="brand" href="/"><span className="brand-mark">z</span><span>zynckle</span></a>
      <span className="zy-shared-badge">Read-only shared document</span>
    </header>
    <main className="zy-shared-main">
      {error ? <div className="empty-state" role="alert"><h1>Link unavailable</h1><p>{error}</p></div>
        : !doc ? <p className="zy-muted-note" role="status">Opening the shared document…</p>
        : <article>
          <div className="eyebrow">{doc.workspace}{doc.updated && ` · updated ${timeAgo(doc.updated)}`}</div>
          <h1>{doc.title}</h1>
          {doc.type === 'latex'
            ? <pre className="zy-shared-source">{doc.content}</pre>
            : <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(doc.content) }}/>}
        </article>}
    </main>
  </div>;
}
