import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  LoaderCircle,
  Maximize,
  Maximize2,
  Minimize,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags } from '@lezer/highlight';
import { api, errorMessage, getToken, timeAgo } from './lib/api';

type LatexDoc = { id: string; title: string; content: string; updated: string };
type LatexError = { line: number | null; message: string; context?: string };
type ViewLayout = 'split' | 'preview-expanded' | 'preview-only' | 'editor-only';

const TEMPLATES: Record<string, { label: string; desc: string; source: string }> = {
  article: {
    label: 'Academic Article',
    desc: 'Mathematical theorems, proofs, equations & abstract',
    source: `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{geometry}
\\geometry{a4paper, margin=1in}

\\title{\\textbf{High-Assurance Distributed Systems: Architecture and Verification}}
\\author{Dr. Alex Vance \\and Sarah Chen \\\\ \\small Zynckle Research Group}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
We present a deterministic local-first synchronization model designed for zero-drift collaborative typesetting and real-time computation under partial network partition.
\\end{abstract}

\\section{Introduction}
Modern distributed workspaces require precision typesetting combined with deterministic local-first state convergence. Inline mathematical relations like $E = mc^2$ and Hilbert spaces $\\mathcal{H} = L^2(\\mathbb{R})$ are verified natively.

\\section{Mathematical Formulation}
Consider the energy minimization objective across active peers:
\\begin{equation}
  \\mathcal{L}(\\theta) = \\frac{1}{N} \\sum_{i=1}^N \\left( y_i - f(x_i; \\theta) \\right)^2 + \\lambda \\|\\theta\\|_2^2
\\end{equation}

\\subsection{Convergence and Orthogonality}
Let $\\{\\Delta_t\\}_{t=0}^\\infty$ represent sequential state delta vectors. By Cauchy-Schwarz inequality:
\\begin{equation}
  \\left| \\langle u, v \\rangle \\right| \\le \\|u\\| \\cdot \\|v\\| \\quad \\forall u, v \\in \\mathcal{H}
\\end{equation}

\\section{Conclusion}
The resulting system guarantees zero-drift synchronization with bounded client-side compile times.

\\end{document}
`
  },
  report: {
    label: 'Technical Report',
    desc: 'Formal multi-chapter report with table of contents',
    source: `\\documentclass[11pt]{report}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage{hyperref}
\\usepackage{geometry}
\\geometry{a4paper, margin=1.1in}

\\title{\\textbf{System Architecture and Security Audit Report}\\\\\\large Platform Infrastructure Release 4.0}
\\author{Zynckle Engineering Platform}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents

\\chapter{Executive Summary}
This document summarizes the strategic architectural deliverables, performance thresholds, and zero-trust security parameters for the Zynckle enterprise platform.

\\chapter{Core Architecture}
\\section{Subsystem Partitioning}
The application layer separates presentation, collaborative sync primitives, and low-latency vector compilation.

\\section{Performance Benchmarks}
Compilation latency remains bounded under sustained high throughput:
\\begin{equation}
  P_{90} < 14\\text{ms}, \\quad P_{99} < 26\\text{ms}
\\end{equation}

\\chapter{Verification Matrix}
All unit and regression tests pass across modern browsers with zero external runtime dependencies.

\\end{document}
`
  },
  exam: {
    label: 'Mathematics Problem Set',
    desc: 'Matrices, limits, contour integrals & formal proofs',
    source: `\\documentclass[12pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{geometry}
\\geometry{a4paper, margin=0.9in}

\\title{\\textbf{Advanced Applied Mathematics}\\\\\\large Problem Set 3: Spectral Theory and Contour Integrals}
\\author{Department of Applied Mathematics}
\\date{Due: November 28, 2026}

\\begin{document}
\\maketitle

\\section*{Problem 1: Self-Adjoint Operators (25 points)}
Let $T: \\mathcal{H} \\to \\mathcal{H}$ be a compact self-adjoint operator on a separable Hilbert space $\\mathcal{H}$.
\\begin{enumerate}
  \\item[(a)] Prove that all eigenvalues $\\lambda \\in \\sigma(T)$ are strictly real: $\\lambda = \\bar{\\lambda}$.
  \\item[(b)] Demonstrate that eigenvectors corresponding to distinct eigenvalues are mutually orthogonal:
  \\begin{equation}
    \\lambda_i \\ne \\lambda_j \\implies \\langle v_i, v_j \\rangle = 0
  \\end{equation}
\\end{enumerate}

\\section*{Problem 2: Matrix Exponentials (25 points)}
Compute the matrix exponential $e^{At}$ for the system:
\\begin{equation}
  A = \\begin{pmatrix} 0 & 1 & 0 \\\\ 0 & 0 & 1 \\\\ 6 & -11 & 6 \\end{pmatrix}
\\end{equation}

\\section*{Problem 3: Residue Calculus (25 points)}
Evaluate the improper integral via Jordan's lemma:
\\begin{equation}
  I = \\int_{-\\infty}^{\\infty} \\frac{\\cos(x)}{x^2 + a^2} \\, dx, \\quad (a > 0)
\\end{equation}

\\end{document}
`
  },
  resume: {
    label: 'Professional Resume',
    desc: 'Clean, elegant, modern single-page CV layout',
    source: `\\documentclass[10pt,letterpaper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{geometry}
\\usepackage{hyperref}
\\usepackage{enumitem}
\\geometry{margin=0.65in}

\\begin{document}
\\begin{center}
  {\\LARGE \\textbf{Alex Morgan}} \\\\ \\vspace{2pt}
  \\small +1 (555) 019-2834 \\quad|\\quad alex.morgan@zynckle.io \\quad|\\quad San Francisco, CA \\quad|\\quad github.com/alexmorgan
\\end{center}

\\section*{Executive Summary}
Lead Software Architect with 9+ years experience engineering ultra-scalable cloud architectures, collaborative document platforms, and developer systems.

\\section*{Technical Skills}
\\textbf{Languages \\& Frameworks:} TypeScript, React, Node.js, Go, Rust, Python, LaTeX, SQL, C++ \\\\
\\textbf{Cloud \\& DevOps:} Google Cloud, Docker, Kubernetes, WebSockets, Zero-Trust Security

\\section*{Experience}
\\textbf{Principal Systems Architect} \\hfill 2023 -- Present \\\\
\\textit{Zynckle Technologies} \\hfill San Francisco, CA
\\begin{itemize}[leftmargin=15pt, itemsep=2pt]
  \\item Directed technical roadmap for real-time collaborative platform supporting 500k+ active workspaces.
  \\item Engineered pure-JS vector PDF compilation pipeline reducing preview latency to under 35ms.
\\end{itemize}

\\textbf{Senior Infrastructure Engineer} \\hfill 2020 -- 2023 \\\\
\\textit{Veritas Cloud Platforms} \\hfill Seattle, WA
\\begin{itemize}[leftmargin=15pt, itemsep=2pt]
  \\item Built resilient data synchronization layer with zero data loss across distributed edge clusters.
\\end{itemize}

\\section*{Education}
\\textbf{B.S. in Computer Science and Applied Mathematics} \\hfill Stanford University \\\\
\\textit{Summa Cum Laude, GPA 3.96/4.0} \\hfill 2016 -- 2020

\\end{document}
`
  },
  letter: {
    label: 'Formal Business Letter',
    desc: 'Executive correspondence with letterhead and signature',
    source: `\\documentclass[11pt]{letter}
\\usepackage[utf8]{inputenc}
\\usepackage{geometry}
\\geometry{a4paper, margin=1in}

\\signature{Dr. Jordan Brooks \\\\ \\small Vice President of Engineering}
\\address{Zynckle Technologies \\\\ 100 Enterprise Way \\\\ San Francisco, CA 94107}

\\begin{document}
\\begin{letter}{Enterprise Partner Group \\\\ 500 Innovation Boulevard \\\\ New York, NY 10001}

\\opening{Dear Executive Committee,}

I am writing to formally confirm that the platform integration, mathematical typesetting suite, and security compliance objectives have all been successfully validated.

The local-first vector compilation engine ensures our clients experience instantaneous PDF generation with zero reliance on external compilation farms. We look forward to our continued partnership.

\\closing{Sincerely yours,}

\\end{letter}
\\end{document}
`
  }
};

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--ink-strong)', fontWeight: '600' },
  { tag: [tags.tagName, tags.typeName], color: 'var(--ink-strong)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.bracket, tags.squareBracket], color: 'var(--muted)' },
  { tag: [tags.string, tags.number, tags.atom], color: 'var(--olive)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--ink)' },
  '.cm-content': { fontFamily: "'DM Mono', monospace", padding: '16px 0', caretColor: 'var(--ink-strong)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-soft)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--surface-soft) 70%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-soft)', color: 'var(--ink-strong)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ink-strong) 18%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--ink-strong)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--line)' },
  '.cm-panels': { backgroundColor: 'var(--surface-soft)', color: 'var(--ink)' },
});

export default function LatexStudio({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const [docs, setDocs] = useState<LatexDoc[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => new URLSearchParams(location.search).get('doc'));
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<{ available: boolean; version?: string | null; message: string } | null>(null);
  const [pdf, setPdf] = useState('');
  const [errors, setErrors] = useState<LatexError[]>([]);
  const [log, setLog] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [autoCompile, setAutoCompile] = useState(() => localStorage.getItem('zynckle-latex-auto') === 'yes');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [newMenu, setNewMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Layout & Zoom state
  const [isFullWindow, setIsFullWindow] = useState(() => localStorage.getItem('zynckle-latex-fullscreen') === 'yes');
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('zynckle-latex-sidebar') !== 'no');
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() => (localStorage.getItem('zynckle-latex-layout') as ViewLayout) || 'split');
  const [zoom, setZoom] = useState<number>(() => Number(localStorage.getItem('zynckle-latex-zoom')) || 100);

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saveTimer = useRef(0);
  const compileTimer = useRef(0);
  const source = useRef('');
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  useEffect(() => { localStorage.setItem('zynckle-latex-fullscreen', isFullWindow ? 'yes' : 'no'); }, [isFullWindow]);
  useEffect(() => { localStorage.setItem('zynckle-latex-sidebar', sidebarOpen ? 'yes' : 'no'); }, [sidebarOpen]);
  useEffect(() => { localStorage.setItem('zynckle-latex-layout', viewLayout); }, [viewLayout]);
  useEffect(() => { localStorage.setItem('zynckle-latex-zoom', String(zoom)); }, [zoom]);

  // Global hotkeys (Ctrl+Shift+F for full-window, Esc to exit full-window)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFullWindow(v => !v);
      } else if (e.key === 'Escape' && isFullWindow) {
        setIsFullWindow(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullWindow]);

  useEffect(() => {
    fetch('/api/latex/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ available: true, message: 'Ready (Built-in engine)' }));

    api<LatexDoc[]>('/api/documents?type=latex').then(async list => {
      if (list.length === 0 && canEdit) {
        try {
          const starter = await api<LatexDoc>('/api/documents', {
            body: { title: 'High-Assurance Paper', content: TEMPLATES.article.source, type: 'latex' }
          });
          setDocs([starter]);
          setActiveId(starter.id);
          return;
        } catch {}
      }
      setDocs(list);
      if (!activeRef.current && list[0]) setActiveId(list[0].id);
    }).catch(() => setDocs([]));
  }, [canEdit]);

  const save = useCallback(async (snapshot = false) => {
    const id = activeRef.current;
    if (!id || !canEdit) return;
    setSaveState('saving');
    try {
      const doc = docs?.find(d => d.id === id);
      const saved = await api<LatexDoc>('/api/documents', {
        body: { id, title: (title || doc?.title || 'Untitled').trim() || 'Untitled', content: source.current, type: 'latex', snapshot }
      });
      setDocs(list => list?.map(d => d.id === id ? { ...d, content: saved.content, updated: saved.updated, title: saved.title } : d) || list);
      setSaveState('saved');
    } catch (e) {
      setSaveState('unsaved');
      notify(errorMessage(e, 'LaTeX source could not be saved'));
    }
  }, [canEdit, docs, title, notify]);

  const compile = useCallback(async () => {
    if (!source.current.trim()) return;
    setCompiling(true);
    setErrors([]);
    setLog('');
    try {
      const response = await fetch('/api/latex/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ source: source.current })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setErrors(data.errors?.length ? data.errors : [{ line: null, message: data.error || 'Compilation failed' }]);
        setLog(data.details || '');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setPdf(old => { if (old) URL.revokeObjectURL(old); return url; });
    } catch {
      setErrors([{ line: null, message: 'The API could not be reached' }]);
    } finally {
      setCompiling(false);
    }
  }, []);

  const compileRef = useRef(compile); compileRef.current = compile;
  const saveRef = useRef(save); saveRef.current = save;
  const autoRef = useRef(autoCompile); autoRef.current = autoCompile;
  const statusRef = useRef(status); statusRef.current = status;

  // (Re)create the editor whenever a different document is opened
  useEffect(() => {
    const doc = docs?.find(d => d.id === activeId);
    if (!host.current || !doc) return;
    setTitle(doc.title);
    setErrors([]);
    setLog('');
    source.current = doc.content;
    view.current?.destroy();
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.content,
        extensions: [
          basicSetup,
          StreamLanguage.define(stex),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(!canEdit),
          keymap.of([
            indentWithTab,
            { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(true); return true; } },
            { key: 'Mod-Enter', preventDefault: true, run: () => { compileRef.current(); return true; } }
          ]),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            source.current = update.state.doc.toString();
            setSaveState('unsaved');
            window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => saveRef.current(false), 1500);
            if (autoRef.current && statusRef.current?.available) {
              window.clearTimeout(compileTimer.current);
              compileTimer.current = window.setTimeout(() => compileRef.current(), 2500);
            }
          }),
        ],
      }),
    });
    if (statusRef.current?.available) compileRef.current();
    return () => { window.clearTimeout(saveTimer.current); window.clearTimeout(compileTimer.current); };
  }, [activeId, docs === null, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => view.current?.destroy(), []);
  useEffect(() => { if (status?.available && view.current && !pdf && !compiling) compileRef.current(); }, [status?.available]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertSnippet = (snippet: string) => {
    const editor = view.current;
    if (!editor || !canEdit) return;
    const { from, to } = editor.state.selection.main;
    editor.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + snippet.length }
    });
    editor.focus();
  };

  const jumpTo = (line: number | null) => {
    const editor = view.current;
    if (!editor || !line) return;
    const target = editor.state.doc.line(Math.min(line, editor.state.doc.lines));
    editor.dispatch({ selection: { anchor: target.from, head: target.to }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
    editor.focus();
  };

  const downloadTex = () => {
    const blob = new Blob([source.current], { type: 'text/x-tex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'document').replace(/[^\w-]+/g, '-')}.tex`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySource = () => {
    if (!source.current) return;
    navigator.clipboard.writeText(source.current).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify('LaTeX source copied to clipboard');
    });
  };

  const openPdfNewTab = () => {
    if (!pdf) return;
    window.open(pdf, '_blank');
  };

  const create = async (templateKey: keyof typeof TEMPLATES) => {
    setNewMenu(false);
    try {
      const template = TEMPLATES[templateKey];
      const doc = await api<LatexDoc>('/api/documents', {
        body: { title: `${template.label} Draft`, content: template.source, type: 'latex' }
      });
      setDocs(list => [doc, ...(list || [])]);
      setActiveId(doc.id);
      notify(`Created from ${template.label}`);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!activeId || !window.confirm('Delete this LaTeX document and its history?')) return;
    try {
      await api(`/api/documents/${activeId}`, { method: 'DELETE' });
      const rest = (docs || []).filter(d => d.id !== activeId);
      setDocs(rest);
      setActiveId(rest[0]?.id || null);
      setPdf('');
      view.current?.destroy();
      view.current = null;
      notify('Document deleted');
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const active = docs?.find(d => d.id === activeId);

  // Compute PDF viewer URL with zoom and fit parameters
  const pdfViewerUrl = useMemo(() => {
    if (!pdf) return '';
    return `${pdf}#view=FitH&zoom=${zoom}`;
  }, [pdf, zoom]);

  return (
    <div className={`latex-studio-container ${isFullWindow ? 'zy-latex-fullwindow' : ''}`}>
      {/* Studio Header & Global Actions */}
      <section className="welcome-row subpage-welcome latex-welcome-bar">
        <div>
          <div className="eyebrow-row">
            <span className="eyebrow">ZYNCKLE DOCS · TEX ENGINE</span>
            {isFullWindow && <span className="latex-badge-focus">FULL WINDOW STUDIO</span>}
          </div>
          <h1 className="latex-page-title">LaTeX <em>studio.</em></h1>
          <p className="welcome-sub">Precision mathematical typesetter and vector PDF compiler. Changes save automatically.</p>
        </div>

        <div className="zy-head-actions latex-head-actions">
          {/* Layout Mode Switcher */}
          <div className="latex-layout-switcher" title="Adjust workspace split">
            <button
              className={`layout-btn ${viewLayout === 'split' ? 'active' : ''}`}
              onClick={() => setViewLayout('split')}
              title="Split 50 / 50 view"
            >
              <Columns2 size={14} />
              <span>Split</span>
            </button>
            <button
              className={`layout-btn ${viewLayout === 'preview-expanded' ? 'active' : ''}`}
              onClick={() => setViewLayout('preview-expanded')}
              title="Expanded Preview (30% Editor / 70% Preview)"
            >
              <Maximize size={14} />
              <span>Big Preview</span>
            </button>
            <button
              className={`layout-btn ${viewLayout === 'preview-only' ? 'active' : ''}`}
              onClick={() => setViewLayout('preview-only')}
              title="Full Preview (100% Page Reading Mode)"
            >
              <FileText size={14} />
              <span>Preview Only</span>
            </button>
            <button
              className={`layout-btn ${viewLayout === 'editor-only' ? 'active' : ''}`}
              onClick={() => setViewLayout('editor-only')}
              title="Full Code Editor Mode"
            >
              <FileCode size={14} />
              <span>Code Only</span>
            </button>
          </div>

          {/* Full-Window Studio Toggle */}
          <button
            className={`button-secondary ${isFullWindow ? 'button-active' : ''}`}
            onClick={() => setIsFullWindow(f => !f)}
            title={isFullWindow ? 'Exit full window (Esc)' : 'Expand studio to full window (Ctrl+Shift+F)'}
          >
            {isFullWindow ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            <span>{isFullWindow ? 'Exit Full Window' : 'Expand Studio'}</span>
            <kbd className="zy-kbd">F</kbd>
          </button>

          {/* Export and Templates */}
          <button className="button-secondary" onClick={downloadTex} title="Export raw .tex source" disabled={!active}>
            <FileCode size={14} /> Export .tex
          </button>

          <div className="zy-menu-wrap">
            <button className="button-secondary" onClick={() => setNewMenu(m => !m)} disabled={!canEdit}>
              <Plus size={15} /> New Template
            </button>
            {newMenu && (
              <div className="zy-dropdown latex-template-dropdown">
                {Object.entries(TEMPLATES).map(([key, t]) => (
                  <button key={key} onClick={() => create(key as keyof typeof TEMPLATES)}>
                    <FileText size={14} />
                    <div className="template-item-meta">
                      <strong>{t.label}</strong>
                      <small>{t.desc}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="button-primary" onClick={compile} disabled={!active || compiling}>
            {compiling ? <LoaderCircle className="spin" size={15} /> : <Play size={14} />}
            <span>{compiling ? 'Compiling…' : 'Compile PDF'}</span>
            <kbd className="zy-kbd">⏎</kbd>
          </button>
        </div>
      </section>

      {/* Compiler Status Bar */}
      <div className="compiler-status latex-status-bar">
        <button
          className="latex-sidebar-toggle-btn"
          onClick={() => setSidebarOpen(s => !s)}
          title={sidebarOpen ? 'Collapse documents sidebar' : 'Expand documents sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          <span>{sidebarOpen ? 'Hide Docs' : 'Show Docs'}</span>
        </button>

        <span className="compiler-pill">
          <i className={status?.available ? 'online' : ''} />
          {status ? (status.version || 'TeX Engine Ready') : 'Checking compiler…'}
        </span>

        <label className="zy-check inline">
          <input
            type="checkbox"
            checked={autoCompile}
            onChange={e => {
              setAutoCompile(e.target.checked);
              localStorage.setItem('zynckle-latex-auto', e.target.checked ? 'yes' : 'no');
            }}
          />
          Live preview
        </label>

        <span className="zy-save-state">
          {saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved changes' : active ? `Saved ${timeAgo(active.updated)}` : ''}
        </span>

        <div className="compiler-right-actions">
          {pdf && (
            <>
              <button className="text-button" onClick={openPdfNewTab} title="Open PDF in a clean full tab">
                <ExternalLink size={13} /> Open in Tab
              </button>
              <a
                className="text-button"
                href={pdf}
                download={`${(title || 'document').replace(/[^\w-]+/g, '-')}.pdf`}
                title="Download compiled publication PDF"
              >
                <Download size={13} /> Download PDF
              </a>
            </>
          )}
        </div>
      </div>

      {/* Main Studio Body */}
      <div className={`zy-latex ${!sidebarOpen ? 'zy-latex-nosidebar' : ''}`}>
        {/* Left Documents List */}
        {sidebarOpen && (
          <aside className="zy-latex-docs">
            <div className="eyebrow-row">
              <span className="eyebrow">DOCUMENTS · {docs?.length ?? '—'}</span>
            </div>
            {docs?.map(d => (
              <button
                key={d.id}
                className={`doc-link ${d.id === activeId ? 'selected' : ''}`}
                onClick={() => {
                  if (saveState === 'unsaved') save(false);
                  setActiveId(d.id);
                }}
              >
                <FileText size={14} />
                <span>
                  {d.title}
                  <small>{timeAgo(d.updated)}</small>
                </span>
              </button>
            ))}
            {docs?.length === 0 && <p className="zy-muted-note">Start from a template with “New”.</p>}
          </aside>
        )}

        {/* Editor & Preview Split Layout */}
        {active ? (
          <div className={`latex-layout layout-${viewLayout}`}>
            {/* Left Source Code Editor */}
            {viewLayout !== 'preview-only' && (
              <section className="latex-source zy-latex-source">
                <div className="editor-head latex-editor-head">
                  <input
                    className="zy-title-inline"
                    value={title}
                    onChange={e => { setTitle(e.target.value); setSaveState('unsaved'); }}
                    onBlur={() => save(true)}
                    aria-label="Document title"
                    disabled={!canEdit}
                  />

                  {/* Math and Layout Snippets Quick Bar */}
                  {canEdit && (
                    <div className="latex-snippets-bar zy-desktop-only">
                      <button type="button" onClick={() => insertSnippet('\\section{}')} title="Insert \\section{}">§ Sec</button>
                      <button type="button" onClick={() => insertSnippet('\\begin{equation}\n  \n\\end{equation}')} title="Insert equation">Eq</button>
                      <button type="button" onClick={() => insertSnippet('\\frac{a}{b}')} title="Insert fraction">½ Frac</button>
                      <button type="button" onClick={() => insertSnippet('\\textbf{}')} title="Insert bold text">B</button>
                      <button type="button" onClick={() => insertSnippet('\\textit{}')} title="Insert italic text">I</button>
                    </div>
                  )}

                  <div className="editor-head-actions">
                    <button className="icon-button" onClick={copySource} title="Copy LaTeX source">
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    {canEdit && (
                      <button className="icon-button danger" onClick={remove} aria-label="Delete document" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="zy-cm" ref={host} />
                <div className="zy-editor-foot">
                  <span>⌘/Ctrl + S save revision · ⌘/Ctrl + Enter compile</span>
                  <span className="latex-hint-key">Press Ctrl+Shift+F for Full Window</span>
                </div>
              </section>
            )}

            {/* Right PDF Preview Pane */}
            {viewLayout !== 'editor-only' && (
              <section className="pdf-pane latex-pdf-pane">
                <div className="editor-head latex-pdf-head">
                  <div className="pdf-head-title-wrap">
                    <span className="pdf-badge">PDF PREVIEW</span>
                    {compiling && (
                      <span className="compiling-indicator">
                        <LoaderCircle className="spin" size={12} /> Compiling…
                      </span>
                    )}
                  </div>

                  {/* Zoom Controls & Expand Tools */}
                  <div className="pdf-head-controls">
                    <div className="pdf-zoom-toolbar">
                      <button
                        className="zoom-btn"
                        onClick={() => setZoom(z => Math.max(50, z - 25))}
                        title="Zoom out"
                      >
                        <ZoomOut size={13} />
                      </button>
                      <span className="zoom-val" onClick={() => setZoom(100)} title="Click to reset to 100%">
                        {zoom}%
                      </span>
                      <button
                        className="zoom-btn"
                        onClick={() => setZoom(z => Math.min(250, z + 25))}
                        title="Zoom in"
                      >
                        <ZoomIn size={13} />
                      </button>
                    </div>

                    {/* Quick Expand Toggle for Preview */}
                    <button
                      className="icon-button"
                      onClick={() => setViewLayout(l => l === 'preview-expanded' ? 'split' : 'preview-expanded')}
                      title={viewLayout === 'preview-expanded' ? 'Reset split to 50/50' : 'Expand preview to 70% width'}
                    >
                      {viewLayout === 'preview-expanded' ? <Minimize size={14} /> : <Maximize size={14} />}
                    </button>

                    <button
                      className="icon-button"
                      onClick={openPdfNewTab}
                      disabled={!pdf}
                      title="Open full page PDF in new tab"
                    >
                      <ExternalLink size={14} />
                    </button>

                    {pdf && (
                      <a
                        className="button-secondary btn-sm"
                        href={pdf}
                        download={`${(title || 'document').replace(/[^\w-]+/g, '-')}.pdf`}
                        title="Download compiled publication PDF"
                      >
                        <Download size={13} /> PDF
                      </a>
                    )}
                  </div>
                </div>

                {pdf ? (
                  <div className="pdf-viewer-wrapper">
                    <iframe
                      key={`${pdf}-${zoom}`}
                      title="Compiled PDF preview"
                      src={pdfViewerUrl}
                      className="latex-pdf-iframe"
                    />
                  </div>
                ) : (
                  <div className="doc-empty latex-empty-pane">
                    <BookOpen size={36} />
                    <h2>Ready to compile</h2>
                    <p>Click <strong>Compile PDF</strong> or check <strong>Live preview</strong> to generate a crisp vector PDF.</p>
                    <button className="button-primary" onClick={compile} disabled={compiling}>
                      <Play size={14} /> Compile document now
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
        ) : (
          <div className="doc-empty zy-latex-empty">
            <FileText size={38} />
            <h2>No LaTeX document open</h2>
            <p>Select a document from the list or create one from a template to begin writing.</p>
            {canEdit && (
              <button className="button-secondary" onClick={() => create('article')}>
                <Plus size={14} /> New academic article
              </button>
            )}
          </div>
        )}
      </div>

      {/* Errors & Compiler Log Overlay */}
      {errors.length > 0 && (
        <div className="zy-latex-errors" role="alert">
          <header>
            <strong>{errors.length} compilation issue{errors.length === 1 ? '' : 's'}</strong>
            <button className="icon-button" aria-label="Dismiss" onClick={() => setErrors([])}>
              <X size={14} />
            </button>
          </header>
          {errors.map((e, i) => (
            <button key={i} onClick={() => jumpTo(e.line)} disabled={!e.line}>
              <span>{e.line ? `Line ${e.line}` : '—'}</span>
              <strong>{e.message}</strong>
              {e.context && <code>{e.context}</code>}
            </button>
          ))}
          {log && (
            <details>
              <summary>Full compiler log</summary>
              <pre className="compile-error">{log}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
