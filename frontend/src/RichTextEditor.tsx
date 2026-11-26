import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Bold, Code2, Columns3, Heading1, Heading2, Heading3, ImagePlus, Info, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote, Redo2, Rows3, Sigma, Strikethrough, Table2, Trash2, Underline, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './rich-text.css';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

export function initialHtml(value: string) {
  if (!value) return '';
  if (/^\s*</.test(value)) return value;
  const lines = value.replace(/\r/g, '').split('\n');
  const html: string[] = [];
  let listOpen = false;
  for (const line of lines) {
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      if (!listOpen) { html.push('<ul>'); listOpen = true; }
      html.push(`<li><p>${escapeHtml(item[1])}</p></li>`);
      continue;
    }
    if (listOpen) { html.push('</ul>'); listOpen = false; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) html.push(`<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`);
    else if (line.trim()) html.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (listOpen) html.push('</ul>');
  return html.join('');
}

function Tool({ editor, label, active, disabled, onClick, children }: { editor: Editor; label: string; active?: boolean; disabled?: boolean; onClick: (editor: Editor) => void; children: React.ReactNode }) {
  return <button type="button" className={`editor-tool${active ? ' active' : ''}`} aria-label={label} title={label} aria-pressed={!!active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => onClick(editor)}>{children}</button>;
}

export type Collab = { docId: string; token: string; user: { name: string; color: string }; readOnly?: boolean };
export type Peer = { name: string; color: string };

const COLORS = ['#ffffff', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a', '#52525b'];
export const colorFor = (seed: string) => COLORS[[...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLORS.length];

/**
 * Rich-text editor. With `collab`, edits sync live through Yjs over the authenticated
 * /collab socket; if the socket cannot sync in time, `onFallback` lets the parent
 * mount a local-only editor so writing is never blocked.
 */
export default function RichTextEditor({ value, onChange, collab, onPeers, onFallback, onSelectionText, editable = true }: {
  value: string; onChange: (html: string) => void; collab?: Collab; onPeers?: (peers: Peer[]) => void; onFallback?: () => void; onSelectionText?: (text: string) => void; editable?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectionRef = useRef(onSelectionText);
  selectionRef.current = onSelectionText;
  const [synced, setSynced] = useState(!collab);
  const [session, setSession] = useState<{ ydoc: Y.Doc; provider: WebsocketProvider } | null>(null);
  // The provider is owned by an effect so React's mount/unmount cycles never leave it destroyed.
  useEffect(() => {
    if (!collab) { setSession(null); return; }
    const ydoc = new Y.Doc();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebsocketProvider(`${protocol}://${location.host}/collab`, collab.docId, ydoc, { params: collab.token ? { token: collab.token } : {}, maxBackoffTime: 8000 });
    setSession({ ydoc, provider });
    return () => { provider.destroy(); ydoc.destroy(); };
  }, [collab?.docId, collab?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    editable: editable && !collab?.readOnly,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }, ...(session ? { undoRedo: false } : {}) }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: false, HTMLAttributes: { loading: 'lazy' } }),
      Placeholder.configure({ placeholder: 'Start writing — use the toolbar for headings, lists, tables and more…' }),
      CharacterCount,
      ...(session && collab ? [Collaboration.configure({ document: session.ydoc }), CollaborationCaret.configure({ provider: session.provider, user: collab.user })] : []),
    ],
    content: session ? undefined : initialHtml(value),
    editorProps: { attributes: { class: 'rich-text-content', 'aria-label': 'Document editor', spellcheck: 'true' } },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML()),
    onSelectionUpdate: ({ editor: current }) => { const { from, to } = current.state.selection; selectionRef.current?.(from === to ? '' : current.state.doc.textBetween(from, to, ' ').slice(0, 400)); },
  }, [session]);

  // Seed a brand-new collaborative document from the saved HTML once the room has synced.
  useEffect(() => {
    if (!session || !editor) return;
    const { provider, ydoc } = session;
    let done = false;
    const onSync = (isSynced: boolean) => {
      if (!isSynced || done) return;
      done = true;
      if (ydoc.getXmlFragment('default').length === 0 && value && !collab?.readOnly) editor.commands.setContent(initialHtml(value));
      setSynced(true);
    };
    provider.on('sync', onSync);
    if (provider.synced) onSync(true);
    const timer = window.setTimeout(() => { if (!done) onFallback?.(); }, 5000);
    const updatePeers = () => {
      const peers: Peer[] = [];
      provider.awareness.getStates().forEach((state, clientId) => { if (clientId !== ydoc.clientID && state.user) peers.push(state.user as Peer); });
      onPeers?.(peers);
    };
    provider.awareness.on('change', updatePeers);
    return () => { window.clearTimeout(timer); provider.off('sync', onSync); provider.awareness.off('change', updatePeers); };
  }, [session, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor || (collab && !session)) return <div className="rich-text-loading" aria-label="Loading editor" />;
  const readOnly = !editable || collab?.readOnly;
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous || 'https://');
    if (url === null) return;
    if (!url.trim()) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    if (!/^(https?:|mailto:)/i.test(url.trim())) { window.alert('Use an http(s) or mailto link.'); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const addImage = () => {
    const url = window.prompt('Image URL (https://…)');
    if (url && /^https:\/\//i.test(url.trim())) editor.chain().focus().setImage({ src: url.trim() }).run();
    else if (url) window.alert('Images must use an https URL. Upload files to Drive and use a public link.');
  };
  const inTable = editor.isActive('table');
  return <div className={`rich-text-editor${synced ? '' : ' zy-syncing'}`}>
    {!readOnly && <div className="rich-text-toolbar" role="toolbar" aria-label="Text formatting">
      <Tool editor={editor} label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={e => e.chain().focus().toggleBold().run()}><Bold size={15}/></Tool>
      <Tool editor={editor} label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={e => e.chain().focus().toggleItalic().run()}><Italic size={15}/></Tool>
      <Tool editor={editor} label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={e => e.chain().focus().toggleUnderline().run()}><Underline size={15}/></Tool>
      <Tool editor={editor} label="Strikethrough" active={editor.isActive('strike')} onClick={e => e.chain().focus().toggleStrike().run()}><Strikethrough size={15}/></Tool>
      <i aria-hidden="true" />
      <Tool editor={editor} label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={e => e.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={15}/></Tool>
      <Tool editor={editor} label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={e => e.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15}/></Tool>
      <Tool editor={editor} label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={e => e.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15}/></Tool>
      <i aria-hidden="true" />
      <Tool editor={editor} label="Bulleted list" active={editor.isActive('bulletList')} onClick={e => e.chain().focus().toggleBulletList().run()}><List size={15}/></Tool>
      <Tool editor={editor} label="Numbered list" active={editor.isActive('orderedList')} onClick={e => e.chain().focus().toggleOrderedList().run()}><ListOrdered size={15}/></Tool>
      <Tool editor={editor} label="Quote" active={editor.isActive('blockquote')} onClick={e => e.chain().focus().toggleBlockquote().run()}><Quote size={14}/></Tool>
      <Tool editor={editor} label="Code block" active={editor.isActive('codeBlock')} onClick={e => e.chain().focus().toggleCodeBlock().run()}><Code2 size={15}/></Tool>
      <Tool editor={editor} label="Insert math / LaTeX formula" onClick={e => e.chain().focus().insertContent('<p>$$\\mathcal{L}(\\theta) = \\frac{1}{N}\\sum_{i=1}^N (y_i - f(x_i))^2 + \\lambda\\|\\theta\\|^2$$</p>').run()}><Sigma size={15}/></Tool>
      <Tool editor={editor} label="Callout note" onClick={e => e.chain().focus().insertContent('<blockquote><p><strong>Note:</strong> Specify key architecture requirements and constraints here.</p></blockquote>').run()}><Info size={15}/></Tool>
      <Tool editor={editor} label="Divider" onClick={e => e.chain().focus().setHorizontalRule().run()}><Minus size={15}/></Tool>
      <i aria-hidden="true" />
      <Tool editor={editor} label="Link" active={editor.isActive('link')} onClick={setLink}><Link2 size={15}/></Tool>
      <Tool editor={editor} label="Image from URL" onClick={addImage}><ImagePlus size={15}/></Tool>
      <Tool editor={editor} label="Insert table" active={inTable} onClick={e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={15}/></Tool>
      {inTable && <>
        <Tool editor={editor} label="Add column" onClick={e => e.chain().focus().addColumnAfter().run()}><Columns3 size={15}/></Tool>
        <Tool editor={editor} label="Add row" onClick={e => e.chain().focus().addRowAfter().run()}><Rows3 size={15}/></Tool>
        <Tool editor={editor} label="Toggle header row" onClick={e => e.chain().focus().toggleHeaderRow().run()}><ListChecks size={15}/></Tool>
        <Tool editor={editor} label="Delete table" onClick={e => e.chain().focus().deleteTable().run()}><Trash2 size={14}/></Tool>
      </>}
      <span className="toolbar-spacer" />
      <Tool editor={editor} label="Undo" disabled={!editor.can().undo()} onClick={e => e.chain().focus().undo().run()}><Undo2 size={15}/></Tool>
      <Tool editor={editor} label="Redo" disabled={!editor.can().redo()} onClick={e => e.chain().focus().redo().run()}><Redo2 size={15}/></Tool>
    </div>}
    <EditorContent editor={editor}/>
    <div className="zy-editor-count">{editor.storage.characterCount.words()} words · {editor.storage.characterCount.characters()} characters{readOnly ? ' · read only' : ''}</div>
  </div>;
}
