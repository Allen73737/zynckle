import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FileCode2, FileText, Plus, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

export default function ScratchpadDrawer({
  onClose,
  notify,
  onNavigate
}: {
  onClose: () => void;
  notify: (msg: string) => void;
  onNavigate: (to: string) => void;
}) {
  const [content, setContent] = useState(() => localStorage.getItem('zynckle-scratchpad') || '');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem('zynckle-scratchpad', content);
  }, [content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify('Scratchpad copied to clipboard');
    });
  };

  const clear = () => {
    if (!content) return;
    if (window.confirm('Clear all scratchpad notes?')) {
      setContent('');
      localStorage.removeItem('zynckle-scratchpad');
    }
  };

  const sendToLatex = async () => {
    if (!content.trim()) return;
    try {
      const title = content.trim().split('\n')[0].slice(0, 50) || 'Scratchpad TeX Note';
      const latexSource = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\title{\\textbf{${title.replace(/[%$#&_]/g, '')}}}
\\author{Zynckle Quick Capture}
\\date{\\today}
\\begin{document}
\\maketitle

\\section{Captured Memo}
${content}

\\end{document}
`;
      await api('/api/documents', {
        body: { title: `TeX: ${title}`, content: latexSource, type: 'latex' }
      });
      notify('Saved as new LaTeX document');
      onClose();
      onNavigate('/latex');
    } catch (e) {
      notify(errorMessage(e, 'Failed to send to LaTeX'));
    }
  };

  const sendToDocs = async () => {
    if (!content.trim()) return;
    try {
      const lines = content.trim().split('\n');
      const title = lines[0].slice(0, 50) || 'Scratchpad Memo';
      const bodyHtml = lines.map(l => `<p>${l.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c)}</p>`).join('');
      await api('/api/documents', {
        body: { title: `Memo: ${title}`, content: bodyHtml, type: 'rich-text' }
      });
      notify('Saved to Collaborative Documents');
      onClose();
      onNavigate('/documents');
    } catch (e) {
      notify(errorMessage(e, 'Failed to save to Documents'));
    }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="assistant-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <aside className="assistant-panel" style={{ maxWidth: 440 }} role="dialog" aria-label="Quick Scratchpad">
        <header>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} />
            <strong>Quick Scratchpad HUD</strong>
          </div>
          <div className="zy-head-actions">
            <kbd className="zy-kbd">Ctrl+E</kbd>
            <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16}/></button>
          </div>
        </header>

        <p className="assistant-context">
          Persistent across all studios. Type formulas, fleeting ideas, or clipboard snippets.
        </p>

        <div style={{ padding: '0 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <textarea
            autoFocus
            className="zy-textarea"
            style={{
              flex: 1, width: '100%', height: '100%', minHeight: 320,
              fontFamily: "'DM Mono', monospace", fontSize: 13, resize: 'none',
              background: 'var(--surface-soft)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-m)', padding: 12
            }}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Type mathematical expressions, fleeting thoughts, or code snippets here..."
          />
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
            <span><strong>{wordCount}</strong> words · {content.length} chars</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="text-button" onClick={copy} disabled={!content.trim()} title="Copy to clipboard">
                {copied ? <Check size={12}/> : <Copy size={12}/>} Copy
              </button>
              <button className="text-button danger" onClick={clear} disabled={!content.trim()} title="Clear notes">
                <Trash2 size={12}/> Clear
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="button-secondary btn-sm" onClick={sendToLatex} disabled={!content.trim()}>
              <FileCode2 size={13} /> Send to LaTeX
            </button>
            <button className="button-primary btn-sm" onClick={sendToDocs} disabled={!content.trim()}>
              <Plus size={13} /> Save to Docs
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
