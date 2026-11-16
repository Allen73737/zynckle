import { memo, useEffect, useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import kotlin from 'highlight.js/lib/languages/kotlin';
import csharp from 'highlight.js/lib/languages/csharp';
import bash from 'highlight.js/lib/languages/bash';
import ruby from 'highlight.js/lib/languages/ruby';
import ini from 'highlight.js/lib/languages/ini';
import './code-preview.css';

const languages = { java, javascript, typescript, python, c, cpp, xml, css, sql, json, yaml, markdown, php, go, rust, kotlin, csharp, bash, ruby, ini };
for (const [name, definition] of Object.entries(languages)) hljs.registerLanguage(name, definition);

const fileLanguages: Record<string, string> = {
  java: 'java', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', vue: 'xml',
  css: 'css', scss: 'css', sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown', php: 'php', go: 'go',
  rs: 'rust', kt: 'kotlin', cs: 'csharp', sh: 'bash', rb: 'ruby', toml: 'ini', ini: 'ini',
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

/** Read-only, syntax-highlighted source with optional line numbers and a focused line. */
function CodePreviewView({ name, content, lineNumbers = false, highlightLine }: { name: string; content: string; lineNumbers?: boolean; highlightLine?: number }) {
  const language = fileLanguages[name.split('.').pop()?.toLowerCase() || ''];
  const ref = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(() => {
    // Very large files skip highlighting to keep the viewer responsive.
    if (!language || content.length > 400_000) return escapeHtml(content);
    try { return hljs.highlight(content, { language, ignoreIllegals: true }).value; }
    catch { return escapeHtml(content); }
  }, [content, language]);
  const lines = useMemo(() => (lineNumbers ? content.split('\n').length : 0), [content, lineNumbers]);
  useEffect(() => {
    if (!highlightLine || !ref.current) return;
    const lineHeight = parseFloat(getComputedStyle(ref.current).lineHeight) || 18;
    ref.current.scrollTo({ top: Math.max(0, (highlightLine - 4) * lineHeight), behavior: 'smooth' });
  }, [highlightLine, content]);
  if (!lineNumbers) return <pre className="code-source"><code className={language ? `language-${language}` : undefined} dangerouslySetInnerHTML={{ __html: highlighted }}/></pre>;
  return <pre ref={ref} className="code-source zy-numbered" style={highlightLine ? { ['--hl' as string]: highlightLine } : undefined}>
    <span className="zy-gutter" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} className={i + 1 === highlightLine ? 'hl' : ''}>{i + 1}</span>)}</span>
    {highlightLine ? <i className="zy-line-mark" aria-hidden="true"/> : null}
    <code className={language ? `language-${language}` : undefined} dangerouslySetInnerHTML={{ __html: highlighted }}/>
  </pre>;
}

export default memo(CodePreviewView);
