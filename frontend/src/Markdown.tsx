import { memo, useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import './markdown.css';

marked.setOptions({ gfm: true, breaks: false });

let mermaidLoader: Promise<typeof import('mermaid')['default']> | null = null;
const loadMermaid = () => {
  mermaidLoader ??= import('mermaid').then(module => module.default);
  return mermaidLoader;
};
let mermaidCount = 0;

/** Render a Mermaid definition into sanitized SVG, themed for the current mode. */
export async function renderMermaid(definition: string) {
  const mermaid = await loadMermaid();
  const dark = document.documentElement.dataset.theme === 'dark';
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: 'DM Sans, sans-serif',
    themeVariables: dark
      ? { primaryColor: '#1d1d1d', primaryTextColor: '#e8e8e8', primaryBorderColor: '#4b4b4b', lineColor: '#a5a5a5', secondaryColor: '#111111', tertiaryColor: '#111111', background: '#111111', mainBkg: '#1d1d1d', nodeBorder: '#4b4b4b', clusterBkg: '#111111', edgeLabelBackground: '#111111', fontSize: '13px' }
      : { primaryColor: '#f4f4f4', primaryTextColor: '#111111', primaryBorderColor: '#c9c9c9', lineColor: '#747474', secondaryColor: '#ffffff', tertiaryColor: '#ffffff', background: '#ffffff', mainBkg: '#f4f4f4', nodeBorder: '#c9c9c9', clusterBkg: '#ffffff', edgeLabelBackground: '#ffffff', fontSize: '13px' },
  });
  const { svg } = await mermaid.render(`zm-${Date.now()}-${mermaidCount++}`, definition.trim());
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true } });
}

export function markdownToHtml(source: string) {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}

function MarkdownView({ source, streaming = false, className = '' }: { source: string; streaming?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => markdownToHtml(source), [source]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('a[href]').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
    root.querySelectorAll<HTMLElement>('pre > code').forEach(code => {
      const pre = code.parentElement!;
      const language = (code.className.match(/language-([\w-]+)/) || [])[1];
      if (language === 'mermaid') {
        if (streaming) return; // wait until the definition is complete
        const holder = document.createElement('div');
        holder.className = 'md-mermaid';
        holder.textContent = 'Rendering diagram…';
        const definition = code.textContent || '';
        pre.replaceWith(holder);
        renderMermaid(definition).then(svg => {
          holder.innerHTML = svg;
          const actions = document.createElement('div');
          actions.className = 'md-mermaid-actions';
          const copy = document.createElement('button');
          copy.type = 'button'; copy.textContent = 'Copy source';
          copy.onclick = () => navigator.clipboard.writeText(definition);
          const download = document.createElement('button');
          download.type = 'button'; download.textContent = 'Download SVG';
          download.onclick = () => { const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); const a = document.createElement('a'); a.href = url; a.download = 'diagram.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 500); };
          actions.append(copy, download);
          holder.append(actions);
        }).catch(() => {
          holder.className = 'md-mermaid md-mermaid-error';
          holder.innerHTML = '';
          const note = document.createElement('small'); note.textContent = 'This Mermaid diagram has a syntax error. Showing its source instead.';
          const source = document.createElement('pre'); source.textContent = definition;
          holder.append(note, source);
        });
        return;
      }
      if (!code.dataset.highlighted) {
        try {
          code.innerHTML = language && hljs.getLanguage(language) ? hljs.highlight(code.textContent || '', { language, ignoreIllegals: true }).value : hljs.highlightAuto(code.textContent || '').value;
          code.dataset.highlighted = 'yes';
        } catch { /* leave as plain text */ }
      }
      if (!streaming && !pre.querySelector('.md-copy')) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'md-copy'; button.textContent = 'Copy';
        button.onclick = () => { navigator.clipboard.writeText(code.textContent || ''); button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1400); };
        if (language) { const tag = document.createElement('span'); tag.className = 'md-lang'; tag.textContent = language; pre.append(tag); }
        pre.append(button);
      }
    });
  }, [html, streaming]);

  return <div ref={ref} className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }}/>;
}

export default memo(MarkdownView);
