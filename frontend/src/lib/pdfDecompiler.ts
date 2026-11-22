/**
 * Zynckle PDF to LaTeX Decompiler & Layout Format Extractor
 * Pure client-side binary stream parser + structured typesetting synthesizer.
 */

export interface DecompileResult {
  latex: string;
  template: string;
  title: string;
  author: string;
  docClass: string;
  sections: string[];
  equationCount: number;
  wordCount: number;
  pageCount: number;
}

export interface CitationItem {
  key: string;
  title: string;
  authors: string;
  year: string;
  journal?: string;
  bibtex: string;
}

/**
 * Extracts raw textual streams from an uploaded PDF file buffer.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number; metadata: Record<string, string> }> {
  const bytes = new Uint8Array(buffer);
  const latin1 = new TextDecoder('latin1').decode(bytes);
  let extracted = '';
  let pages = 0;

  // Count pages via /Type /Page
  const pageMatches = latin1.match(/\/Type\s*\/Page\b/g);
  pages = pageMatches ? pageMatches.length : 1;

  // Metadata detection
  const metadata: Record<string, string> = {};
  const titleMatch = latin1.match(/\/Title\s*\(([^)]+)\)/);
  if (titleMatch) metadata.title = unescapePdf(titleMatch[1]);
  const authorMatch = latin1.match(/\/Author\s*\(([^)]+)\)/);
  if (authorMatch) metadata.author = unescapePdf(authorMatch[1]);

  // Scan for stream ... endstream blocks
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin1)) !== null) {
    const rawStream = match[1];
    // Check if FlateDecode
    const streamStartIdx = match.index + match[0].indexOf(rawStream);
    const streamEndIdx = streamStartIdx + rawStream.length;
    const streamBytes = bytes.subarray(streamStartIdx, streamEndIdx);

    let streamStr = '';
    // Try browser-native DecompressionStream if available
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(streamBytes);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const total = chunks.reduce((a, b) => a + b.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        streamStr = new TextDecoder('utf-8').decode(merged);
      } catch {
        // Fallback to uncompressed
        streamStr = rawStream;
      }
    } else {
      streamStr = rawStream;
    }

    parseStreamText(streamStr, s => { extracted += s; });
  }

  // If stream parsing was sparse, extract text strings directly from literals
  if (extracted.trim().length < 40) {
    const directStrings = latin1.match(/\(([^()\\\\]*(?:\\.[^()\\\\]*)*)\)\s*(?:Tj|'|")/g);
    if (directStrings) {
      for (const ds of directStrings) {
        const inner = ds.replace(/^\(/, '').replace(/\)\s*(?:Tj|'|")$/, '');
        extracted += unescapePdf(inner) + '\n';
      }
    }
  }

  return { text: extracted.trim(), pages, metadata };
}

function parseStreamText(stream: string, write: (s: string) => void) {
  const btRegex = /BT\b([\s\S]*?)ET\b/g;
  let btMatch: RegExpExecArray | null;
  while ((btMatch = btRegex.exec(stream)) !== null) {
    const block = btMatch[1];
    // Match (string) Tj
    const tjRegex = /\(([^()\\\\]*(?:\\.[^()\\\\]*)*)\)\s*(?:Tj|'|")/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      write(unescapePdf(tjMatch[1]) + ' ');
    }
    // Match [(string) 20 (more)] TJ
    const arrayRegex = /\[([^\]]+)\]\s*TJ/g;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = arrayRegex.exec(block)) !== null) {
      const arr = arrMatch[1];
      const strRegex = /\(([^()\\\\]*(?:\\.[^()\\\\]*)*)\)/g;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = strRegex.exec(arr)) !== null) {
        write(unescapePdf(sMatch[1]));
      }
      write(' ');
    }
    write('\n');
  }
}

function unescapePdf(s: string): string {
  if (!s) return '';
  return s
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * Reverse-engineers structured text into clean LaTeX source and reusable template.
 */
export function decompileToLatex(rawText: string, defaultTitle?: string, pageCount = 1): DecompileResult {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    const fallback = `\\documentclass[11pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb}\n\\title{Extracted Document}\n\\author{Author}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\n\\section{Extracted Content}\n(No readable text found in document stream)\n\n\\end{document}`;
    return {
      latex: fallback,
      template: fallback,
      title: defaultTitle || 'Extracted Document',
      author: 'Author',
      docClass: 'article',
      sections: ['Extracted Content'],
      equationCount: 0,
      wordCount: 0,
      pageCount
    };
  }

  // 1. Detect title
  let detectedTitle = defaultTitle || 'Extracted Document';
  let titleIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const l = lines[i];
    if (l.length > 5 && !/^(page|\d+|confidential|draft)/i.test(l)) {
      detectedTitle = l;
      titleIdx = i;
      break;
    }
  }

  // 2. Detect author
  let detectedAuthor = 'Author';
  if (titleIdx !== -1 && titleIdx + 1 < lines.length) {
    const candidate = lines[titleIdx + 1];
    if (candidate.length < 80 && !/^(abstract|1\.|introduction)/i.test(candidate)) {
      detectedAuthor = candidate;
    }
  }

  // 3. Document class
  const fullLower = rawText.toLowerCase();
  let docClass = 'article';
  if (fullLower.includes('\\chapter') || fullLower.includes('chapter 1') || fullLower.includes('table of contents')) {
    docClass = 'report';
  } else if (fullLower.includes('dear ') && (fullLower.includes('sincerely') || fullLower.includes('regards'))) {
    docClass = 'letter';
  }

  const sections: string[] = [];
  let equationCount = 0;
  let wordCount = 0;

  const latexParts: string[] = [];
  const templateParts: string[] = [];

  // Preamble
  const preamble = `\\documentclass[11pt]{${docClass}}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb,amsfonts}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\\usepackage{geometry}\n\\geometry{a4paper, margin=1in}\n\n`;
  latexParts.push(preamble);
  templateParts.push(preamble);

  // Meta
  latexParts.push(`\\title{\\textbf{${escapeLatex(detectedTitle)}}}\n\\author{${escapeLatex(detectedAuthor)}}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n`);
  templateParts.push(`\\title{\\textbf{<DOCUMENT_TITLE>}}\n\\author{<AUTHOR_NAME> \\\\ \\small <AFFILIATION>}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n`);

  let inAbstract = false;
  let inItemize = false;
  let inEnumerate = false;

  const startFrom = titleIdx !== -1 ? (titleIdx + (detectedAuthor !== 'Author' ? 2 : 1)) : 0;

  for (let i = startFrom; i < lines.length; i++) {
    const line = lines[i];
    wordCount += line.split(/\s+/).length;
    const lower = line.toLowerCase();

    // Abstract
    if (/^abstract\b/i.test(lower)) {
      if (inItemize) { latexParts.push('\\end{itemize}\n\n'); inItemize = false; }
      if (inEnumerate) { latexParts.push('\\end{enumerate}\n\n'); inEnumerate = false; }
      latexParts.push('\\begin{abstract}\n');
      templateParts.push('\\begin{abstract}\n<ABSTRACT_SUMMARY>\n\\end{abstract}\n\n');
      inAbstract = true;
      const rest = line.replace(/^abstract[:\s]*/i, '').trim();
      if (rest) latexParts.push(escapeLatex(rest) + '\n');
      continue;
    }

    if (inAbstract && isHeading(line)) {
      latexParts.push('\\end{abstract}\n\n');
      inAbstract = false;
    }

    // Section Headings
    if (isHeading(line)) {
      if (inItemize) { latexParts.push('\\end{itemize}\n\n'); inItemize = false; }
      if (inEnumerate) { latexParts.push('\\end{enumerate}\n\n'); inEnumerate = false; }
      const cleanH = cleanHeading(line);
      sections.push(cleanH);
      latexParts.push(`\\section{${escapeLatex(cleanH)}}\n`);
      templateParts.push(`\\section{<SECTION_TITLE>}\n<SECTION_CONTENT>\n\n`);
      continue;
    }

    // Subsections
    if (isSubheading(line)) {
      if (inItemize) { latexParts.push('\\end{itemize}\n\n'); inItemize = false; }
      if (inEnumerate) { latexParts.push('\\end{enumerate}\n\n'); inEnumerate = false; }
      const cleanSub = cleanHeading(line);
      latexParts.push(`\\subsection{${escapeLatex(cleanSub)}}\n`);
      continue;
    }

    // Equations
    if (isEquation(line)) {
      if (inItemize) { latexParts.push('\\end{itemize}\n\n'); inItemize = false; }
      if (inEnumerate) { latexParts.push('\\end{enumerate}\n\n'); inEnumerate = false; }
      equationCount++;
      latexParts.push(`\\begin{equation}\n  ${formatMath(line)}\n\\end{equation}\n\n`);
      continue;
    }

    // Bullet items
    if (/^[•\-*]\s+/.test(line)) {
      if (!inItemize) {
        if (inEnumerate) { latexParts.push('\\end{enumerate}\n\n'); inEnumerate = false; }
        latexParts.push('\\begin{itemize}\n');
        inItemize = true;
      }
      latexParts.push(`  \\item ${escapeLatex(line.replace(/^[•\-*]\s+/, ''))}\n`);
      continue;
    }

    // Numbered items
    if (/^\d+[.)]\s+/.test(line)) {
      if (!inEnumerate) {
        if (inItemize) { latexParts.push('\\end{itemize}\n\n'); inItemize = false; }
        latexParts.push('\\begin{enumerate}\n');
        inEnumerate = true;
      }
      latexParts.push(`  \\item ${escapeLatex(line.replace(/^\d+[.)]\s+/, ''))}\n`);
      continue;
    }

    // Standard paragraph
    if (inItemize) { latexParts.push('\\end{itemize}\n\n'); inItemize = false; }
    if (inEnumerate) { latexParts.push('\\end{enumerate}\n\n'); inEnumerate = false; }

    latexParts.push(escapeLatex(line) + '\n\n');
  }

  if (inAbstract) latexParts.push('\\end{abstract}\n\n');
  if (inItemize) latexParts.push('\\end{itemize}\n\n');
  if (inEnumerate) latexParts.push('\\end{enumerate}\n\n');

  latexParts.push('\\end{document}\n');
  templateParts.push('\\end{document}\n');

  return {
    latex: latexParts.join(''),
    template: templateParts.join(''),
    title: detectedTitle,
    author: detectedAuthor,
    docClass,
    sections: sections.length ? sections : ['General'],
    equationCount,
    wordCount,
    pageCount
  };
}

function isHeading(line: string): boolean {
  if (line.length > 70) return false;
  if (/^(?:\d+\.|I{1,3}\.|[A-Z]\.)\s+[A-Za-z]/.test(line)) return true;
  if (/^(?:Introduction|Background|Methodology|Related Work|Architecture|Implementation|Results|Discussion|Conclusion|References)\b/i.test(line)) return true;
  if (line === line.toUpperCase() && line.length > 3 && line.length < 50 && /[A-Z]/.test(line)) return true;
  return false;
}

function isSubheading(line: string): boolean {
  if (line.length > 80) return false;
  return /^(?:\d+\.\d+|[a-z]\))\s+[A-Za-z]/.test(line);
}

function cleanHeading(line: string): string {
  return line.replace(/^(?:\d+\.(?:\d+)?|I{1,3}\.|[A-Za-z][.)])\s*/, '').trim();
}

function isEquation(line: string): boolean {
  if (line.length > 120) return false;
  if (/\b(?:\\int|\\sum|\\prod|\\partial|\\nabla|\\lambda|\\sigma|\\theta|\\in|\\le|\\ge|\\ne|\\approx)\b/.test(line)) return true;
  if (/[a-zA-Z0-9_]+\s*=\s*[-+/*0-9a-zA-Z\\(\\)\\{\\}\\\\]+/.test(line) && line.includes('=') && !line.includes(';') && !line.startsWith('http')) {
    return line.length < 80;
  }
  return false;
}

function formatMath(line: string): string {
  return line
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/!=/g, '\\ne ')
    .replace(/->/g, '\\to ')
    .replace(/=>/g, '\\implies ')
    .replace(/\balpha\b/g, '\\alpha')
    .replace(/\bbeta\b/g, '\\beta')
    .replace(/\blambda\b/g, '\\lambda')
    .replace(/\btheta\b/g, '\\theta')
    .replace(/\bsigma\b/g, '\\sigma')
    .replace(/\bomega\b/g, '\\omega')
    .replace(/\bsum\b/g, '\\sum')
    .replace(/\bint\b/g, '\\int');
}

function escapeLatex(text: string): string {
  return text
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_');
}

/**
 * Built-in searchable academic references with complete BibTeX entries.
 */
export const POPULAR_CITATIONS: CitationItem[] = [
  {
    key: 'vaswani2017attention',
    title: 'Attention Is All You Need',
    authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, et al.',
    year: '2017',
    journal: 'Advances in Neural Information Processing Systems (NeurIPS)',
    bibtex: `@inproceedings{vaswani2017attention,
  author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, Lukasz and Polosukhin, Illia},
  title     = {Attention Is All You Need},
  booktitle = {Advances in Neural Information Processing Systems (NeurIPS)},
  volume    = {30},
  year      = {2017}
}`
  },
  {
    key: 'lamport1978time',
    title: 'Time, Clocks, and the Ordering of Events in a Distributed System',
    authors: 'Leslie Lamport',
    year: '1978',
    journal: 'Communications of the ACM (CACM)',
    bibtex: `@article{lamport1978time,
  author  = {Lamport, Leslie},
  title   = {Time, Clocks, and the Ordering of Events in a Distributed System},
  journal = {Communications of the ACM},
  volume  = {21},
  number  = {7},
  pages   = {558--565},
  year    = {1978}
}`
  },
  {
    key: 'shannon1948mathematical',
    title: 'A Mathematical Theory of Communication',
    authors: 'Claude E. Shannon',
    year: '1948',
    journal: 'Bell System Technical Journal',
    bibtex: `@article{shannon1948mathematical,
  author  = {Shannon, Claude E.},
  title   = {A Mathematical Theory of Communication},
  journal = {The Bell System Technical Journal},
  volume  = {27},
  number  = {3},
  pages   = {379--423},
  year    = {1948}
}`
  },
  {
    key: 'shapiro2011crdts',
    title: 'Conflict-Free Replicated Data Types',
    authors: 'Marc Shapiro, Nuno Preguica, Carlos Baquero, Marek Zawirski',
    year: '2011',
    journal: 'Symposium on Self-Stabilizing Systems (SSS)',
    bibtex: `@inproceedings{shapiro2011crdts,
  author    = {Shapiro, Marc and Pregui{\\c{c}}a, Nuno and Baquero, Carlos and Zawirski, Marek},
  title     = {Conflict-Free Replicated Data Types},
  booktitle = {Stabilization, Safety, and Security of Distributed Systems},
  pages     = {386--400},
  year      = {2011}
}`
  },
  {
    key: 'einstein1905electrodynamics',
    title: 'On the Electrodynamics of Moving Bodies',
    authors: 'Albert Einstein',
    year: '1905',
    journal: 'Annalen der Physik',
    bibtex: `@article{einstein1905electrodynamics,
  author  = {Einstein, Albert},
  title   = {Zur Elektrodynamik bewegter K{\\"o}rper},
  journal = {Annalen der Physik},
  volume  = {322},
  number  = {10},
  pages   = {891--921},
  year    = {1905}
}`
  },
  {
    key: 'knuth1984texbook',
    title: 'The TeXbook',
    authors: 'Donald E. Knuth',
    year: '1984',
    journal: 'Addison-Wesley',
    bibtex: `@book{knuth1984texbook,
  author    = {Knuth, Donald E.},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}`
  }
];
