import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Download, FileCode, FileText, LoaderCircle, Play, Plus, Trash2, X } from 'lucide-react';
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

const TEMPLATES: Record<string, { label: string; source: string }> = {
  article: { label: 'Article', source: '\\documentclass[11pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\title{A note from Zynckle}\n\\author{Your name}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nWrite your document here. Inline maths looks like $E = mc^2$.\n\n\\begin{equation}\n  \\int_0^1 x^2\\,dx = \\frac{1}{3}\n\\end{equation}\n\n\\end{document}\n' },
  report: { label: 'Technical report', source: '\\documentclass[11pt]{report}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\\title{Technical Report}\n\\author{Project team}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\\tableofcontents\n\n\\chapter{Overview}\nSummarise the purpose of the system.\n\n\\chapter{Architecture}\n\\section{Components}\nDescribe the main components.\n\n\\chapter{Results}\nPresent the findings.\n\n\\end{document}\n' },
  letter: { label: 'Letter', source: '\\documentclass{letter}\n\\usepackage[utf8]{inputenc}\n\\signature{Your name}\n\\address{Street \\\\ City}\n\n\\begin{document}\n\\begin{letter}{Recipient \\\\ Address}\n\\opening{Dear Recipient,}\n\nWrite your letter here.\n\n\\closing{Kind regards,}\n\\end{letter}\n\\end{document}\n' },
};

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--ink-strong)', fontWeight: '600' },
  { tag: [tags.tagName, tags.typeName], color: 'var(--ink-strong)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.bracket, tags.squareBracket], color: 'var(--muted)' },
  { tag: [tags.string, tags.number, tags.atom], color: 'var(--olive)' },
]);
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--surface)', color: 'var(--ink)' },
  '.cm-content': { fontFamily: "'DM Mono', monospace", padding: '12px 0', caretColor: 'var(--ink-strong)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-soft)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--surface-soft) 70%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-soft)', color: 'var(--ink-strong)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ink-strong) 16%, transparent) !important' },
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
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saveTimer = useRef(0);
  const compileTimer = useRef(0);
  const source = useRef('');
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  useEffect(() => {
    fetch('/api/latex/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ available: true, message: 'Ready (Built-in engine)' }));
    api<LatexDoc[]>('/api/documents?type=latex').then(async list => {
      if (list.length === 0 && canEdit) {
        try {
          const starter = await api<LatexDoc>('/api/documents', {
            body: { title: 'Article draft', content: TEMPLATES.article.source, type: 'latex' }
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
      const saved = await api<LatexDoc>('/api/documents', { body: { id, title: (title || doc?.title || 'Untitled').trim() || 'Untitled', content: source.current, type: 'latex', snapshot } });
      setDocs(list => list?.map(d => d.id === id ? { ...d, content: saved.content, updated: saved.updated, title: saved.title } : d) || list);
      setSaveState('saved');
    } catch (e) { setSaveState('unsaved'); notify(errorMessage(e, 'LaTeX source could not be saved')); }
  }, [canEdit, docs, title, notify]);

  const compile = useCallback(async () => {
    if (!source.current.trim()) return;
    setCompiling(true); setErrors([]); setLog('');
    try {
      const response = await fetch('/api/latex/compile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ source: source.current }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setErrors(data.errors?.length ? data.errors : [{ line: null, message: data.error || 'Compilation failed' }]);
        setLog(data.details || '');
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      setPdf(old => { if (old) URL.revokeObjectURL(old); return url; });
    } catch { setErrors([{ line: null, message: 'The API could not be reached' }]); }
    finally { setCompiling(false); }
  }, []);

  const compileRef = useRef(compile); compileRef.current = compile;
  const saveRef = useRef(save); saveRef.current = save;
  const autoRef = useRef(autoCompile); autoRef.current = autoCompile;
  const statusRef = useRef(status); statusRef.current = status;

  // (Re)create the editor whenever a different document is opened.
  useEffect(() => {
    const doc = docs?.find(d => d.id === activeId);
    if (!host.current || !doc) return;
    setTitle(doc.title); setErrors([]); setLog('');
    source.current = doc.content;
    view.current?.destroy();
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.content,
        extensions: [
          basicSetup, StreamLanguage.define(stex), syntaxHighlighting(highlight), theme, EditorView.lineWrapping,
          EditorState.readOnly.of(!canEdit),
          keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(true); return true; } }, { key: 'Mod-Enter', preventDefault: true, run: () => { compileRef.current(); return true; } }]),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            source.current = update.state.doc.toString();
            setSaveState('unsaved');
            window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => saveRef.current(false), 1500);
            if (autoRef.current && statusRef.current?.available) { window.clearTimeout(compileTimer.current); compileTimer.current = window.setTimeout(() => compileRef.current(), 2500); }
          }),
        ],
      }),
    });
    if (statusRef.current?.available) compileRef.current();
    return () => { window.clearTimeout(saveTimer.current); window.clearTimeout(compileTimer.current); };
  }, [activeId, docs === null, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => view.current?.destroy(), []);
  useEffect(() => { if (status?.available && view.current && !pdf && !compiling) compileRef.current(); }, [status?.available]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const create = async (template: keyof typeof TEMPLATES) => {
    setNewMenu(false);
    try {
      const doc = await api<LatexDoc>('/api/documents', { body: { title: `${TEMPLATES[template].label} draft`, content: TEMPLATES[template].source, type: 'latex' } });
      setDocs(list => [doc, ...(list || [])]); setActiveId(doc.id);
    } catch (e) { notify(errorMessage(e)); }
  };
  const remove = async () => {
    if (!activeId || !window.confirm('Delete this LaTeX document and its history?')) return;
    try { await api(`/api/documents/${activeId}`, { method: 'DELETE' }); const rest = (docs || []).filter(d => d.id !== activeId); setDocs(rest); setActiveId(rest[0]?.id || null); setPdf(''); view.current?.destroy(); view.current = null; notify('Document deleted'); }
    catch (e) { notify(errorMessage(e)); }
  };

  const active = docs?.find(d => d.id === activeId);
  return <>
    <section className="welcome-row subpage-welcome"><div><div className="eyebrow">ZYNCKLE DOCS · TEX ENGINE</div><h1>LaTeX <em>studio.</em></h1><p className="welcome-sub">Integrated mathematical typesetter and PDF compiler. Sources save automatically.</p></div>
      <div className="zy-head-actions">
        <button className="button-secondary" onClick={downloadTex} title="Export raw .tex source" disabled={!active}><FileCode size={14}/> Export .tex</button>
        <div className="zy-menu-wrap"><button className="button-secondary" onClick={() => setNewMenu(m => !m)} disabled={!canEdit}><Plus size={15}/> New</button>{newMenu && <div className="zy-dropdown">{Object.entries(TEMPLATES).map(([key, t]) => <button key={key} onClick={() => create(key as keyof typeof TEMPLATES)}><FileText size={13}/>{t.label}</button>)}</div>}</div>
        <button className="button-primary" onClick={compile} disabled={!active || compiling}>{compiling ? <LoaderCircle className="spin" size={15}/> : <Play size={14}/>} Compile PDF</button></div></section>
    <div className="compiler-status"><i className={status?.available ? 'online' : ''}/>{status ? (status.version || 'TeX Engine Ready') : 'Checking compiler'}
      <label className="zy-check inline"><input type="checkbox" checked={autoCompile} onChange={e => { setAutoCompile(e.target.checked); localStorage.setItem('zynckle-latex-auto', e.target.checked ? 'yes' : 'no'); }}/> Live preview</label>
      <span className="zy-save-state">{saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved changes' : active ? `Saved ${timeAgo(active.updated)}` : ''}</span>
      {pdf && <a className="text-button" href={pdf} download={`${(title || 'document').replace(/[^\w-]+/g, '-')}.pdf`}><Download size={13}/> Download PDF</a>}</div>
    <div className="zy-latex">
      <aside className="zy-latex-docs">
        <div className="eyebrow">TEX DOCUMENTS · {docs?.length ?? '—'}</div>
        {docs?.map(d => <button key={d.id} className={`doc-link ${d.id === activeId ? 'selected' : ''}`} onClick={() => { if (saveState === 'unsaved') save(false); setActiveId(d.id); }}><FileText size={14}/><span>{d.title}<small>{timeAgo(d.updated)}</small></span></button>)}
        {docs?.length === 0 && <p className="zy-muted-note">Start from a template with “New”.</p>}
      </aside>
      {active ? <div className="latex-layout">
        <section className="latex-source zy-latex-source">
          <div className="editor-head"><input className="zy-title-inline" value={title} onChange={e => { setTitle(e.target.value); setSaveState('unsaved'); }} onBlur={() => save(true)} aria-label="Document title" disabled={!canEdit}/><span>LaTeX</span>{canEdit && <button className="icon-button danger" onClick={remove} aria-label="Delete document" title="Delete"><Trash2 size={13}/></button>}</div>
          <div className="zy-cm" ref={host}/>
          <div className="zy-editor-foot">⌘/Ctrl + S save revision · ⌘/Ctrl + Enter compile</div>
        </section>
        <section className="pdf-pane">
          <div className="editor-head">
            <span>PDF PREVIEW</span>
            {compiling && <span><LoaderCircle className="spin" size={11}/> compiling</span>}
            {pdf && <a className="text-button" href={pdf} download={`${(title || 'document').replace(/[^\w-]+/g, '-')}.pdf`}><Download size={13}/> Download PDF</a>}
          </div>
          {pdf ? (
            <iframe title="Compiled PDF preview" src={pdf}/>
          ) : (
            <div className="doc-empty">
              <BookOpen/>
              <h2>Ready to compile</h2>
              <p>Click <strong>Compile PDF</strong> or enable <strong>Live preview</strong> to generate a publication-ready PDF.</p>
              <button className="button-primary" onClick={compile} disabled={compiling}><Play size={14}/> Compile now</button>
            </div>
          )}
        </section>
      </div> : <div className="doc-empty zy-latex-empty"><FileText/><h2>No LaTeX document open</h2><p>Create one from a template to begin.</p>{canEdit && <button className="button-secondary" onClick={() => create('article')}><Plus size={14}/> New article</button>}</div>}
    </div>
    {errors.length > 0 && <div className="zy-latex-errors" role="alert"><header><strong>{errors.length} compilation issue{errors.length === 1 ? '' : 's'}</strong><button className="icon-button" aria-label="Dismiss" onClick={() => setErrors([])}><X size={14}/></button></header>
      {errors.map((e, i) => <button key={i} onClick={() => jumpTo(e.line)} disabled={!e.line}><span>{e.line ? `Line ${e.line}` : '—'}</span><strong>{e.message}</strong>{e.context && <code>{e.context}</code>}</button>)}
      {log && <details><summary>Full compiler log</summary><pre className="compile-error">{log}</pre></details>}</div>}
  </>;
}
