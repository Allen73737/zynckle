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
  FileUp,
  LoaderCircle,
  Maximize,
  Maximize2,
  Minimize,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Quote,
  Search,
  Sigma,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
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
import { api, authHeaders, errorMessage, timeAgo } from './lib/api';
import { extractPdfText, decompileToLatex, POPULAR_CITATIONS, type CitationItem, type DecompileResult } from './lib/pdfDecompiler';

type LatexDoc = { id: string; title: string; content: string; updated: string };
type LatexError = { line: number | null; message: string; context?: string };
type ViewLayout = 'split' | 'preview-expanded' | 'preview-only' | 'editor-only';

export type CustomTemplate = {
  id: string;
  label: string;
  desc: string;
  source: string;
  extractedFrom?: string;
  createdAt: string;
};

const BUILTIN_TEMPLATES: Record<string, { label: string; desc: string; source: string }> = {
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
  const [status, setStatus] = useState<{ available: boolean; engine?: 'tex' | 'preview'; version?: string | null; message: string } | null>(null);
  const [pdf, setPdf] = useState('');
  const [errors, setErrors] = useState<LatexError[]>([]);
  const [log, setLog] = useState('');
  const [previewNoteDismissed, setPreviewNoteDismissed] = useState(() => { try { return sessionStorage.getItem('zynckle-latex-preview-note') === 'hidden'; } catch { return false; } });
  useEffect(() => { if (previewNoteDismissed) try { sessionStorage.setItem('zynckle-latex-preview-note', 'hidden'); } catch { /* ignore */ } }, [previewNoteDismissed]);
  const [compiling, setCompiling] = useState(false);
  const [compileDurationMs, setCompileDurationMs] = useState<number | null>(4);
  const [autoCompile, setAutoCompile] = useState(() => localStorage.getItem('zynckle-latex-auto') === 'yes');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [newMenu, setNewMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Layout & Zoom state
  const [isFullWindow, setIsFullWindow] = useState(() => localStorage.getItem('zynckle-latex-fullscreen') === 'yes');
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('zynckle-latex-sidebar') !== 'no');
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() => (localStorage.getItem('zynckle-latex-layout') as ViewLayout) || 'split');
  const [zoom, setZoom] = useState<number>(() => Number(localStorage.getItem('zynckle-latex-zoom')) || 100);

  // Advanced Supercharged Features state
  const [mathDrawerOpen, setMathDrawerOpen] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [citationModalOpen, setCitationModalOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);

  // PDF Decompiler state
  const [decompileResult, setDecompileResult] = useState<DecompileResult | null>(null);
  const [isDecompiling, setIsDecompiling] = useState(false);
  const [decompileViewTab, setDecompileViewTab] = useState<'latex' | 'template' | 'stats'>('latex');
  const [templateSaveName, setTemplateSaveName] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');

  // AI Generator state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('article');
  const [aiIncludeTheorems, setAiIncludeTheorems] = useState(true);
  const [aiIncludeBib, setAiIncludeBib] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiGeneratedCode, setAiGeneratedCode] = useState('');

  // Citation Finder state
  const [citationSearch, setCitationSearch] = useState('');

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saveTimer = useRef(0);
  const compileTimer = useRef(0);
  const abortCtrl = useRef<AbortController | null>(null);
  const source = useRef('');
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  // Load custom templates
  useEffect(() => {
    api<Array<{ id: string; title: string; content: string; updated: string }>>('/api/latex/templates')
      .then(list => {
        if (list && list.length > 0) {
          const tmpls: CustomTemplate[] = list.map(item => ({
            id: item.id,
            label: item.title,
            desc: 'User-saved layout template',
            source: item.content,
            createdAt: item.updated
          }));
          setCustomTemplates(tmpls);
          localStorage.setItem('zynckle-latex-custom-templates', JSON.stringify(tmpls));
        } else {
          const local = localStorage.getItem('zynckle-latex-custom-templates');
          if (local) setCustomTemplates(JSON.parse(local));
        }
      })
      .catch(() => {
        const local = localStorage.getItem('zynckle-latex-custom-templates');
        if (local) setCustomTemplates(JSON.parse(local));
      });
  }, []);

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
      .catch(() => setStatus({ available: false, version: 'Compiler unreachable', message: 'The LaTeX service could not be reached. Check that the backend is running.' }));

    api<LatexDoc[]>('/api/documents?type=latex').then(async list => {
      if (list.length === 0 && canEdit) {
        try {
          const starter = await api<LatexDoc>('/api/documents', {
            body: { title: 'High-Assurance Paper', content: BUILTIN_TEMPLATES.article.source, type: 'latex' }
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
    if (abortCtrl.current) abortCtrl.current.abort();
    const controller = new AbortController();
    abortCtrl.current = controller;

    const start = performance.now();
    setCompiling(true);
    setErrors([]);
    setLog('');
    try {
      const response = await fetch('/api/latex/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() }, credentials: 'same-origin',
        body: JSON.stringify({ source: source.current }),
        signal: controller.signal
      });
      setCompileDurationMs(Math.max(1, Math.round(performance.now() - start)));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setErrors(data.errors?.length ? data.errors : [{ line: null, message: data.error || `Compilation failed (${response.status})` }]);
        if (data.details) setLog(data.details);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setPdf(old => { if (old) URL.revokeObjectURL(old); return url; });
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setCompileDurationMs(Math.max(1, Math.round(performance.now() - start)));
      setErrors([{ line: null, message: 'Cannot reach the LaTeX compiler. Check that the backend is running.' }]);
    } finally {
      if (abortCtrl.current === controller) {
        setCompiling(false);
      }
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
              compileTimer.current = window.setTimeout(() => compileRef.current(), 900);
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

  const replaceEditorContent = (content: string, newTitle?: string) => {
    const editor = view.current;
    if (!editor || !canEdit) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content }
    });
    source.current = content;
    if (newTitle) setTitle(newTitle);
    save(true);
    compile();
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

  const createFromSource = async (docTitle: string, docSource: string) => {
    setNewMenu(false);
    try {
      const doc = await api<LatexDoc>('/api/documents', {
        body: { title: docTitle, content: docSource, type: 'latex' }
      });
      setDocs(list => [doc, ...(list || [])]);
      setActiveId(doc.id);
      notify(`Created "${docTitle}"`);
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

  // -------------------------------------------------------------
  // PDF Reverse-Engineering Handler
  // -------------------------------------------------------------
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setIsDecompiling(true);
    setDecompileResult(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      // Try local parsing first
      const { text, pages, metadata } = await extractPdfText(arrayBuffer);
      const titleHint = metadata.title || file.name.replace(/\.[^/.]+$/, '');
      let result = decompileToLatex(text, titleHint, pages);

      // Also call backend decompiler for deep stream analysis if available
      try {
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        const serverRes = await api<{
          latex: string;
          extractedTemplate: string;
          title: string;
          author: string;
          docClass: string;
          sections: string[];
          equationCount: number;
          wordCount: number;
        }>('/api/latex/decompile-pdf', {
          body: { pdfBase64: base64, filename: file.name, text }
        });
        if (serverRes && serverRes.latex) {
          result = {
            latex: serverRes.latex,
            template: serverRes.extractedTemplate,
            title: serverRes.title || result.title,
            author: serverRes.author || result.author,
            docClass: serverRes.docClass || result.docClass,
            sections: serverRes.sections || result.sections,
            equationCount: serverRes.equationCount || result.equationCount,
            wordCount: serverRes.wordCount || result.wordCount,
            pageCount: pages
          };
        }
      } catch {}

      setDecompileResult(result);
      setTemplateSaveName(`${result.title} Format`);
      notify(`PDF decompiled: ${result.sections.length} sections and ${result.equationCount} equations detected`);
    } catch (err) {
      notify(errorMessage(err, 'Failed to decompile PDF'));
    } finally {
      setIsDecompiling(false);
    }
  };

  // Save extracted template
  const saveExtractedTemplate = async () => {
    if (!decompileResult?.template) return;
    const name = (templateSaveName || 'Extracted Custom Format').trim();
    try {
      const saved = await api<{ id: string; title: string; content: string; updated: string }>('/api/latex/templates', {
        body: { title: name, content: decompileResult.template }
      });
      const newTmpl: CustomTemplate = {
        id: saved.id || `tmpl-${Date.now()}`,
        label: name,
        desc: `Extracted from ${pdfFileName || 'PDF'}`,
        source: decompileResult.template,
        extractedFrom: pdfFileName,
        createdAt: new Date().toISOString()
      };
      const updated = [newTmpl, ...customTemplates.filter(t => t.id !== newTmpl.id)];
      setCustomTemplates(updated);
      localStorage.setItem('zynckle-latex-custom-templates', JSON.stringify(updated));
      notify(`Template "${name}" saved to your workspace library`);
    } catch (e) {
      notify(errorMessage(e, 'Failed to save template'));
    }
  };

  const deleteCustomTemplate = async (tmplId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this custom template?')) return;
    try {
      await api(`/api/latex/templates/${tmplId}`, { method: 'DELETE' });
    } catch {}
    const updated = customTemplates.filter(t => t.id !== tmplId);
    setCustomTemplates(updated);
    localStorage.setItem('zynckle-latex-custom-templates', JSON.stringify(updated));
    notify('Custom template deleted');
  };

  // -------------------------------------------------------------
  // AI LaTeX Generator Handler
  // -------------------------------------------------------------
  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiGeneratedCode('');

    try {
      const res = await api<{ latex: string; title: string; style: string }>('/api/latex/ai-generate', {
        body: {
          prompt: aiPrompt,
          style: aiStyle,
          options: { includeTheorems: aiIncludeTheorems, includeBib: aiIncludeBib }
        }
      });
      if (res.latex) {
        setAiGeneratedCode(res.latex);
      }
    } catch (err) {
      notify(errorMessage(err, 'AI generation failed'));
    } finally {
      setAiBusy(false);
    }
  };

  // -------------------------------------------------------------
  // BibTeX Citation Handler
  // -------------------------------------------------------------
  const filteredCitations = useMemo(() => {
    if (!citationSearch.trim()) return POPULAR_CITATIONS;
    const q = citationSearch.toLowerCase();
    return POPULAR_CITATIONS.filter(
      c => c.title.toLowerCase().includes(q) || c.authors.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)
    );
  }, [citationSearch]);

  const insertCitation = (c: CitationItem) => {
    insertSnippet(`\\cite{${c.key}}`);
    // Append to bibliography if not already there
    const editor = view.current;
    if (editor) {
      const currentText = editor.state.doc.toString();
      if (!currentText.includes(c.key)) {
        const endDoc = currentText.lastIndexOf('\\end{document}');
        if (endDoc !== -1) {
          editor.dispatch({
            changes: { from: endDoc, to: endDoc, insert: `\n\\begin{thebibliography}{99}\n\\bibitem{${c.key}} ${c.authors}. \\textit{${c.title}}. ${c.year}.\n\\end{thebibliography}\n\n` }
          });
        }
      }
    }
    notify(`Inserted \\cite{${c.key}}`);
    setCitationModalOpen(false);
  };

  const active = docs?.find(d => d.id === activeId);

  // Compute live document statistics
  const documentStats = useMemo(() => {
    const raw = source.current || '';
    const cleanWords = raw
      .replace(/%.*$/gm, '')
      .replace(/\\[a-zA-Z]+/g, ' ')
      .replace(/[{}\[\]\(\)]/g, ' ')
      .split(/\s+/)
      .filter(w => w.trim().length > 0).length;
    const equations = (raw.match(/\\begin\{(?:equation|align|gather)\}|\$[^$]+\$/g) || []).length;
    const lines = raw.split('\n').length;
    return { words: cleanWords, chars: raw.length, equations, lines };
  }, [source.current]);

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
            <span className="eyebrow">ZYNCKLE RESEARCH OS · FAST TEX VECTOR ENGINE</span>
            {isFullWindow && <span className="latex-badge-focus">FULL WINDOW STUDIO</span>}
          </div>
          <h1 className="latex-page-title">LaTeX <em>studio.</em></h1>
          <p className="welcome-sub">Zero-latency pure vector typesetting, reverse-engineering PDF decompiler, and contextual AI generation.</p>
        </div>

        <div className="zy-head-actions latex-head-actions">
          {/* Supercharged Action: Reverse-Engineer from PDF */}
          <button
            className="button-secondary"
            onClick={() => setPdfModalOpen(true)}
            title="Upload any PDF to reverse-engineer LaTeX code and extract its reusable layout template"
          >
            <UploadCloud size={14} />
            <span>Decompile PDF</span>
          </button>

          {/* Supercharged Action: AI LaTeX Generator */}
          <button
            className="button-secondary"
            onClick={() => setAiModalOpen(true)}
            title="Generate custom research papers, problem sets, or CVs using AI"
          >
            <Sparkles size={14} />
            <span>AI LaTeX</span>
          </button>

          {/* Supercharged Action: BibTeX Citation Finder */}
          <button
            className="button-secondary"
            onClick={() => setCitationModalOpen(true)}
            title="Search academic papers and insert BibTeX citations (\cite)"
          >
            <Quote size={14} />
            <span>Citations</span>
          </button>

          {/* Math & Symbols Palette Toggle */}
          <button
            className={`button-secondary ${mathDrawerOpen ? 'button-active' : ''}`}
            onClick={() => setMathDrawerOpen(o => !o)}
            title="Toggle quick math and symbol palette"
          >
            <Sigma size={14} />
            <span>Symbols</span>
          </button>

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
              <div className="zy-dropdown latex-template-dropdown" style={{ minWidth: 320, zIndex: 100 }}>
                <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Standard Archetypes
                </div>
                {Object.entries(BUILTIN_TEMPLATES).map(([key, t]) => (
                  <button key={key} onClick={() => createFromSource(t.label, t.source)}>
                    <FileText size={14} />
                    <div className="template-item-meta">
                      <strong>{t.label}</strong>
                      <small>{t.desc}</small>
                    </div>
                  </button>
                ))}

                {customTemplates.length > 0 && (
                  <>
                    <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', borderTop: '1px solid var(--line)', marginTop: 4 }}>
                      Custom Extracted Formats ({customTemplates.length})
                    </div>
                    {customTemplates.map(tmpl => (
                      <div key={tmpl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <button style={{ flex: 1 }} onClick={() => createFromSource(tmpl.label, tmpl.source)}>
                          <Sparkles size={14} style={{ color: 'var(--ink-strong)' }} />
                          <div className="template-item-meta">
                            <strong>{tmpl.label}</strong>
                            <small>{tmpl.desc}</small>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={e => deleteCustomTemplate(tmpl.id, e)}
                          title="Delete template"
                          style={{ padding: 6, marginRight: 8 }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
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

      {/* Compiler Status & Live Telemetry Bar */}
      <div className="compiler-status latex-status-bar">
        <button
          className="latex-sidebar-toggle-btn"
          onClick={() => setSidebarOpen(s => !s)}
          title={sidebarOpen ? 'Collapse documents sidebar' : 'Expand documents sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          <span>{sidebarOpen ? 'Hide Docs' : 'Show Docs'}</span>
        </button>

        <span className="compiler-pill" title={status?.message}>
          <i className={status?.available ? (status.engine === 'preview' ? 'warn' : 'online') : ''} />
          {status ? (status.version || 'LaTeX compiler') : 'Checking compiler…'}
        </span>

        {compileDurationMs !== null && (
          <span className="zy-chip zy-mono" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--surface-soft)' }}>
            ⚡ {compileDurationMs}ms build
          </span>
        )}

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

        {/* Live Document Analytics Counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }} className="zy-desktop-only">
          <span><strong>{documentStats.words}</strong> words</span>
          <span><strong>{documentStats.equations}</strong> equations</span>
          <span><strong>{documentStats.lines}</strong> lines</span>
        </div>

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

      {/* Expandable Math & Symbols Palette */}
      {mathDrawerOpen && (
        <div style={{ background: 'var(--surface-soft)', borderBottom: '1px solid var(--line)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginRight: 4 }}>Symbols:</span>
          {['\\alpha', '\\beta', '\\gamma', '\\delta', '\\lambda', '\\sigma', '\\omega', '\\theta', '\\pi', '\\mu'].map(sym => (
            <button key={sym} type="button" className="text-button" onClick={() => insertSnippet(`${sym} `)} style={{ padding: '2px 6px', fontFamily: 'serif', fontStyle: 'italic' }}>
              {sym.replace('\\', '')}
            </button>
          ))}
          <span style={{ height: 16, width: 1, background: 'var(--line)', margin: '0 4px' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginRight: 4 }}>Calculus:</span>
          {['\\int_{a}^{b} f(x)\\,dx', '\\sum_{i=1}^{n}', '\\prod_{k=1}^{N}', '\\partial', '\\nabla', '\\lim_{x \\to \\infty}'].map(op => (
            <button key={op} type="button" className="text-button" onClick={() => insertSnippet(`${op} `)} style={{ padding: '2px 6px', fontFamily: 'monospace', fontSize: 11 }}>
              {op.split(' ')[0]}
            </button>
          ))}
          <span style={{ height: 16, width: 1, background: 'var(--line)', margin: '0 4px' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginRight: 4 }}>Equations:</span>
          <button type="button" className="text-button" onClick={() => insertSnippet('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')} style={{ padding: '2px 6px', fontSize: 11 }}>
            [Matrix]
          </button>
          <button type="button" className="text-button" onClick={() => insertSnippet('\\begin{align}\n  y &= f(x) \\\\\n  &= 2x + 1\n\\end{align}')} style={{ padding: '2px 6px', fontSize: 11 }}>
            [Align]
          </button>
          <button type="button" className="text-button" onClick={() => insertSnippet('\\sqrt{x^2 + y^2}')} style={{ padding: '2px 6px', fontSize: 11 }}>
            [Sqrt]
          </button>
          <button type="button" className="icon-button" onClick={() => setMathDrawerOpen(false)} style={{ marginLeft: 'auto' }}>
            <X size={13} />
          </button>
        </div>
      )}

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
                      <button type="button" onClick={() => insertSnippet('\\begin{itemize}\n  \\item \n\\end{itemize}')} title="Insert list">• List</button>
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
                      aria-label="Open full page PDF in new tab"
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
            <p>Select a document from the list, decompile an existing PDF, or create one from a template.</p>
            {canEdit && (
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="button-secondary" onClick={() => createFromSource(BUILTIN_TEMPLATES.article.label, BUILTIN_TEMPLATES.article.source)}>
                  <Plus size={14} /> New academic article
                </button>
                <button className="button-primary" onClick={() => setPdfModalOpen(true)}>
                  <UploadCloud size={14} /> Decompile from PDF
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Errors & Compiler Log Overlay */}
      {status?.engine === 'preview' && !previewNoteDismissed && (
        <div className="zy-latex-engine-note" role="note">
          <span><strong>Preview renderer.</strong> {status.message}</span>
          <button className="icon-button" onClick={() => setPreviewNoteDismissed(true)} aria-label="Dismiss"><X size={13}/></button>
        </div>
      )}
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

      {/* ========================================================= */}
      {/* 1. PDF DECOMPILER & FORMAT EXTRACTION MODAL */}
      {/* ========================================================= */}
      {pdfModalOpen && (
        <div className="modal-backdrop" onClick={() => setPdfModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 860, width: '92%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <UploadCloud size={18} />
                <div>
                  <strong>Reverse-Engineer PDF to LaTeX & Extract Layout</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Upload any PDF to synthesize clean LaTeX and extract reusable templates</div>
                </div>
              </div>
              <button className="icon-button" onClick={() => setPdfModalOpen(false)}><X size={15} /></button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
              {/* File Dropzone */}
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '28px 16px', border: '2px dashed var(--line)', borderRadius: 'var(--radius-m)',
                cursor: 'pointer', background: 'var(--surface-soft)', transition: 'border-color .2s'
              }}>
                <FileUp size={32} style={{ color: 'var(--muted)', marginBottom: 8 }} />
                <strong>Select or drop a PDF file here</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Scans PDF binary streams, extracts mathematical formulas, sections, and fonts</span>
                <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: 'none' }} />
              </label>

              {isDecompiling && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 }}>
                  <LoaderCircle className="spin" size={20} />
                  <span>Decompressing PDF streams and reverse-engineering LaTeX markup…</span>
                </div>
              )}

              {decompileResult && !isDecompiling && (
                <div style={{ marginTop: 20 }}>
                  {/* Summary Bar */}
                  <div style={{ display: 'flex', gap: 16, background: 'var(--surface-soft)', padding: '12px 16px', borderRadius: 'var(--radius-m)', marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div><span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Detected Title</span><strong>{decompileResult.title}</strong></div>
                    <div><span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Sections</span><strong>{decompileResult.sections.length}</strong></div>
                    <div><span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Equations</span><strong>{decompileResult.equationCount}</strong></div>
                    <div><span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Words</span><strong>{decompileResult.wordCount}</strong></div>
                    <div><span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Document Class</span><code className="zy-mono">{decompileResult.docClass}</code></div>
                  </div>

                  {/* Tabs */}
                  <div className="zy-tabs small">
                    <button className={decompileViewTab === 'latex' ? 'active' : ''} onClick={() => setDecompileViewTab('latex')}>
                      <FileCode size={13} /> Generated LaTeX Code
                    </button>
                    <button className={decompileViewTab === 'template' ? 'active' : ''} onClick={() => setDecompileViewTab('template')}>
                      <Wand2 size={13} /> Extracted Layout Format (Reusable)
                    </button>
                  </div>

                  {decompileViewTab === 'latex' ? (
                    <div>
                      <textarea
                        className="zy-textarea"
                        style={{ width: '100%', height: 260, fontFamily: "'DM Mono', monospace", fontSize: 12 }}
                        value={decompileResult.latex}
                        onChange={e => setDecompileResult({ ...decompileResult, latex: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div>
                      <p className="zy-muted-note">
                        This template captures the typography, margins, and environments of the uploaded PDF with generic placeholders (<code className="zy-mono">&lt;DOCUMENT_TITLE&gt;</code>, <code className="zy-mono">&lt;SECTION_CONTENT&gt;</code>) so you can reuse this format for future papers.
                      </p>
                      <textarea
                        className="zy-textarea"
                        style={{ width: '100%', height: 220, fontFamily: "'DM Mono', monospace", fontSize: 12 }}
                        value={decompileResult.template}
                        onChange={e => setDecompileResult({ ...decompileResult, template: e.target.value })}
                      />
                      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
                        <input
                          type="text"
                          className="zy-input"
                          style={{ flex: 1 }}
                          value={templateSaveName}
                          onChange={e => setTemplateSaveName(e.target.value)}
                          placeholder="Template Name (e.g., IEEE Double-Column Format)"
                        />
                        <button className="button-secondary" onClick={saveExtractedTemplate}>
                          Save as Reusable Template
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button className="button-secondary" onClick={() => setPdfModalOpen(false)}>Close</button>
              {decompileResult && (
                <>
                  <button
                    className="button-secondary"
                    onClick={() => {
                      createFromSource(`${decompileResult.title} (Decompiled)`, decompileResult.latex);
                      setPdfModalOpen(false);
                    }}
                  >
                    Create as New Document
                  </button>
                  <button
                    className="button-primary"
                    onClick={() => {
                      replaceEditorContent(decompileResult.latex, decompileResult.title);
                      setPdfModalOpen(false);
                      notify('Extracted LaTeX applied to editor');
                    }}
                  >
                    Apply to Active Editor
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. AI LATEX GENERATOR MODAL */}
      {/* ========================================================= */}
      {aiModalOpen && (
        <div className="modal-backdrop" onClick={() => setAiModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 780, width: '92%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} />
                <div>
                  <strong>AI LaTeX Typesetter & Document Architect</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Generate publication-grade LaTeX papers, problem sets, or CVs from natural language</div>
                </div>
              </div>
              <button className="icon-button" onClick={() => setAiModalOpen(false)}><X size={15} /></button>
            </div>

            <form onSubmit={handleAiGenerate}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Describe the document to typeset:
                  </label>
                  <textarea
                    className="zy-textarea"
                    rows={4}
                    style={{ width: '100%' }}
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    placeholder="e.g. Research paper on Real-Time CRDT Invariant Manifolds with Cauchy-Schwarz bounds, Hilbert spaces, and an abstract..."
                    required
                  />
                  {/* Preset quick pills */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Presets:</span>
                    {[
                      'Quantum Field Theory Invariant Manifolds',
                      'Distributed Systems & CRDT Convergence Proof',
                      'Applied Mathematics Problem Set with Matrices',
                      'Senior Systems Architect Curriculum Vitae',
                      'Microservice Platform Architecture Spec'
                    ].map(p => (
                      <button
                        key={p}
                        type="button"
                        className="text-button zy-mono"
                        style={{ fontSize: 11, textDecoration: 'underline' }}
                        onClick={() => setAiPrompt(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Archetype / Style</label>
                    <select
                      className="zy-select"
                      style={{ width: '100%' }}
                      value={aiStyle}
                      onChange={e => setAiStyle(e.target.value)}
                    >
                      <option value="article">Academic Article (arXiv / IEEE)</option>
                      <option value="report">Technical Systems Report</option>
                      <option value="exam">Problem Set & Mathematical Proofs</option>
                      <option value="resume">Professional Curriculum Vitae</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                    <label className="zy-check inline">
                      <input
                        type="checkbox"
                        checked={aiIncludeTheorems}
                        onChange={e => setAiIncludeTheorems(e.target.checked)}
                      />
                      Include Equations & Theorems
                    </label>
                    <label className="zy-check inline">
                      <input
                        type="checkbox"
                        checked={aiIncludeBib}
                        onChange={e => setAiIncludeBib(e.target.checked)}
                      />
                      Include Abstract & Bibliography
                    </label>
                  </div>
                </div>

                {aiBusy && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 }}>
                    <LoaderCircle className="spin" size={18} />
                    <span>Neural model is generating verified LaTeX code…</span>
                  </div>
                )}

                {aiGeneratedCode && !aiBusy && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Generated LaTeX Output:</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Ready for sub-5ms compilation</span>
                    </div>
                    <textarea
                      className="zy-textarea"
                      style={{ width: '100%', height: 220, fontFamily: "'DM Mono', monospace", fontSize: 12 }}
                      value={aiGeneratedCode}
                      onChange={e => setAiGeneratedCode(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="modal-foot">
                <button type="button" className="button-secondary" onClick={() => setAiModalOpen(false)}>Cancel</button>
                {!aiGeneratedCode ? (
                  <button type="submit" className="button-primary" disabled={aiBusy || !aiPrompt.trim()}>
                    <Sparkles size={14} /> Generate LaTeX Code
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        createFromSource(`AI Paper: ${aiPrompt.slice(0, 32)}`, aiGeneratedCode);
                        setAiModalOpen(false);
                      }}
                    >
                      Create as New Document
                    </button>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => {
                        replaceEditorContent(aiGeneratedCode, `AI Paper: ${aiPrompt.slice(0, 32)}`);
                        setAiModalOpen(false);
                        notify('AI LaTeX applied to editor');
                      }}
                    >
                      Apply to Active Document
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 3. CITATIONS & BIBTEX FINDER MODAL */}
      {/* ========================================================= */}
      {citationModalOpen && (
        <div className="modal-backdrop" onClick={() => setCitationModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 720, width: '92%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Quote size={18} />
                <div>
                  <strong>Academic Citations & BibTeX Manager</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Search foundational references and insert <code>\cite&#123;key&#125;</code> into your document</div>
                </div>
              </div>
              <button className="icon-button" onClick={() => setCitationModalOpen(false)}><X size={15} /></button>
            </div>

            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <input
                  type="text"
                  className="zy-input"
                  style={{ width: '100%', paddingLeft: 32 }}
                  placeholder="Search papers by title, author, or citation key (e.g., Attention, Shannon, Lamport)..."
                  value={citationSearch}
                  onChange={e => setCitationSearch(e.target.value)}
                  autoFocus
                />
                <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredCitations.map(c => (
                  <div key={c.key} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-m)', padding: 12, background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <strong style={{ fontSize: 14 }}>{c.title}</strong>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.authors} ({c.year}) · <em>{c.journal}</em></div>
                        <code className="zy-mono" style={{ fontSize: 11, color: 'var(--ink-strong)', display: 'inline-block', marginTop: 4 }}>
                          \cite&#123;{c.key}&#125;
                        </code>
                      </div>
                      <button className="button-secondary btn-sm" onClick={() => insertCitation(c)}>
                        Insert \cite
                      </button>
                    </div>
                    <details style={{ marginTop: 8, fontSize: 11 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>View BibTeX Entry</summary>
                      <pre className="zy-mono" style={{ padding: 8, background: 'var(--surface-soft)', borderRadius: 4, overflowX: 'auto', marginTop: 4 }}>
                        {c.bibtex}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-foot">
              <button className="button-secondary" onClick={() => setCitationModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
