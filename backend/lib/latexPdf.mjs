// Pure JavaScript LaTeX-to-PDF compiler for Zynckle TeX Engine.
// Generates standard, valid PDF 1.4 without requiring external TeX Live or MiKTeX binaries.

function escapePdf(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function stripLatexFormatting(str) {
  return str
    .replace(/\\textbf\{([^}]+)\}/g, '$1')
    .replace(/\\textit\{([^}]+)\}/g, '$1')
    .replace(/\\texttt\{([^}]+)\}/g, '$1')
    .replace(/\\emph\{([^}]+)\}/g, '$1')
    .replace(/\\underline\{([^}]+)\}/g, '$1')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\mathbf\{([^}]+)\}/g, '$1')
    .replace(/\\,\s*/g, ' ')
    .replace(/\\quad\s*/g, '    ')
    .replace(/\\qquad\s*/g, '        ')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)')
    .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\int_([^\s^]+)\^([^\s]+)/g, 'integral_{$1}^{$2}')
    .replace(/\\sum_([^\s^]+)\^([^\s]+)/g, 'sum_{$1}^{$2}')
    .replace(/\\alpha\b/g, 'α')
    .replace(/\\beta\b/g, 'β')
    .replace(/\\gamma\b/g, 'γ')
    .replace(/\\delta\b/g, 'δ')
    .replace(/\\theta\b/g, 'θ')
    .replace(/\\lambda\b/g, 'λ')
    .replace(/\\mu\b/g, 'μ')
    .replace(/\\pi\b/g, 'π')
    .replace(/\\sigma\b/g, 'σ')
    .replace(/\\omega\b/g, 'ω')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\neq\b/g, '≠')
    .replace(/\\leq\b/g, '≤')
    .replace(/\\geq\b/g, '≥')
    .replace(/\\times\b/g, '×')
    .replace(/\\pm\b/g, '±')
    .replace(/\\to\b/g, '→')
    .replace(/\\leftarrow\b/g, '←')
    .replace(/\\rightarrow\b/g, '→')
    .replace(/\\[a-zA-Z]+\b/g, '')
    .replace(/[{}\\]/g, '')
    .trim();
}

export function compileLatexToPdf(source) {
  // Extract metadata
  const titleMatch = source.match(/\\title\{([^}]+)\}/);
  const authorMatch = source.match(/\\author\{([^}]+)\}/);
  const dateMatch = source.match(/\\date\{([^}]+)\}/);

  const title = titleMatch ? stripLatexFormatting(titleMatch[1]) : 'Zynckle LaTeX Document';
  const author = authorMatch ? stripLatexFormatting(authorMatch[1]) : '';
  const date = dateMatch ? (dateMatch[1] === '\\today' ? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : stripLatexFormatting(dateMatch[1])) : new Date().toLocaleDateString();

  // Extract body content between \begin{document} and \end{document}
  let body = source;
  const docStart = source.indexOf('\\begin{document}');
  const docEnd = source.indexOf('\\end{document}');
  if (docStart !== -1) {
    body = source.slice(docStart + 16, docEnd !== -1 ? docEnd : undefined);
  }

  // Remove comments and metadata commands
  body = body.replace(/%.*$/gm, '');
  body = body.replace(/\\maketitle/g, '');
  body = body.replace(/\\tableofcontents/g, '');

  // Parse lines into logical blocks
  const blocks = [];

  // Title header block
  if (title) blocks.push({ type: 'title', text: title });
  if (author || date) blocks.push({ type: 'meta', text: [author, date].filter(Boolean).join('  ·  ') });

  // Process sections and paragraphs
  const rawLines = body.split(/\r?\n/);
  let currentParagraph = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ').trim();
      if (text) blocks.push({ type: 'paragraph', text });
      currentParagraph = [];
    }
  };

  let inEquation = false;
  let equationBuffer = [];
  let inItemize = false;
  let sectionIndex = 0;

  for (let rawLine of rawLines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    // Equation environments
    if (/\\begin\{(equation|align|gather)\*?\}/.test(line)) {
      flushParagraph();
      inEquation = true;
      equationBuffer = [];
      continue;
    }
    if (/\\end\{(equation|align|gather)\*?\}/.test(line)) {
      inEquation = false;
      const eqText = stripLatexFormatting(equationBuffer.join(' '));
      if (eqText) blocks.push({ type: 'equation', text: eqText });
      equationBuffer = [];
      continue;
    }
    if (inEquation) {
      equationBuffer.push(line);
      continue;
    }

    // List environments
    if (/\\begin\{(itemize|enumerate)\}/.test(line)) {
      flushParagraph();
      inItemize = true;
      continue;
    }
    if (/\\end\{(itemize|enumerate)\}/.test(line)) {
      flushParagraph();
      inItemize = false;
      continue;
    }

    // Sections
    const secMatch = line.match(/\\section\*?\{([^}]+)\}/);
    if (secMatch) {
      flushParagraph();
      sectionIndex++;
      blocks.push({ type: 'section', text: `${sectionIndex}. ${stripLatexFormatting(secMatch[1])}` });
      continue;
    }

    // Subsections
    const subSecMatch = line.match(/\\subsection\*?\{([^}]+)\}/);
    if (subSecMatch) {
      flushParagraph();
      blocks.push({ type: 'subsection', text: stripLatexFormatting(subSecMatch[1]) });
      continue;
    }

    // Chapters
    const chapMatch = line.match(/\\chapter\*?\{([^}]+)\}/);
    if (chapMatch) {
      flushParagraph();
      blocks.push({ type: 'chapter', text: stripLatexFormatting(chapMatch[1]) });
      continue;
    }

    // Items
    if (line.startsWith('\\item')) {
      flushParagraph();
      const itemText = stripLatexFormatting(line.replace(/^\\item\s*/, ''));
      blocks.push({ type: 'item', text: itemText });
      continue;
    }

    // Inline equations: if line starts and ends with $$ or \[ \]
    if (/^(\$\$|\\\[).+(\$\$|\\\])$/.test(line)) {
      flushParagraph();
      const eq = stripLatexFormatting(line.replace(/^(\$\$|\\\[)/, '').replace(/(\$\$|\\\])$/, ''));
      blocks.push({ type: 'equation', text: eq });
      continue;
    }

    // Accumulate normal text into paragraph
    currentParagraph.push(stripLatexFormatting(line));
  }
  flushParagraph();

  // Word wrap helper
  function wrapText(text, maxChars = 75) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) {
        cur = w;
      } else if ((cur + ' ' + w).length <= maxChars) {
        cur += ' ' + w;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Generate pages and PDF streams
  const pages = [];
  let currentPageOperations = [];
  let curY = 780; // A4 height is 841.89 pt; top margin is ~60 pt
  const bottomMargin = 60;
  const pageHeight = 841.89;
  const pageWidth = 595.28;

  function newPage() {
    if (currentPageOperations.length > 0) {
      pages.push(currentPageOperations);
      currentPageOperations = [];
    }
    curY = 780;
  }

  for (const block of blocks) {
    if (block.type === 'title') {
      if (curY < 700) newPage();
      const lines = wrapText(block.text, 45);
      for (const l of lines) {
        curY -= 26;
        currentPageOperations.push({ font: '/F2', size: 22, x: 54, y: curY, text: l });
      }
      curY -= 8;
    } else if (block.type === 'meta') {
      curY -= 16;
      currentPageOperations.push({ font: '/F3', size: 10, x: 54, y: curY, text: block.text });
      curY -= 20;
    } else if (block.type === 'chapter') {
      if (curY < bottomMargin + 100) newPage();
      curY -= 30;
      currentPageOperations.push({ font: '/F2', size: 18, x: 54, y: curY, text: block.text });
      curY -= 12;
    } else if (block.type === 'section') {
      if (curY < bottomMargin + 60) newPage();
      curY -= 24;
      currentPageOperations.push({ font: '/F2', size: 14, x: 54, y: curY, text: block.text });
      curY -= 8;
    } else if (block.type === 'subsection') {
      if (curY < bottomMargin + 40) newPage();
      curY -= 18;
      currentPageOperations.push({ font: '/F2', size: 12, x: 54, y: curY, text: block.text });
      curY -= 6;
    } else if (block.type === 'item') {
      const lines = wrapText(block.text, 68);
      for (let i = 0; i < lines.length; i++) {
        if (curY < bottomMargin) newPage();
        curY -= 15;
        const prefix = i === 0 ? '•  ' : '   ';
        currentPageOperations.push({ font: '/F1', size: 10.5, x: 70, y: curY, text: prefix + lines[i] });
      }
      curY -= 3;
    } else if (block.type === 'equation') {
      if (curY < bottomMargin + 40) newPage();
      curY -= 22;
      currentPageOperations.push({ font: '/F4', size: 11, x: 100, y: curY, text: block.text });
      curY -= 14;
    } else if (block.type === 'paragraph') {
      const lines = wrapText(block.text, 72);
      for (const l of lines) {
        if (curY < bottomMargin) newPage();
        curY -= 15;
        currentPageOperations.push({ font: '/F1', size: 11, x: 54, y: curY, text: l });
      }
      curY -= 8;
    }
  }

  if (currentPageOperations.length > 0) {
    pages.push(currentPageOperations);
  }
  if (pages.length === 0) {
    pages.push([{ font: '/F1', size: 11, x: 54, y: 750, text: 'Blank document' }]);
  }

  // Construct PDF structure
  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font Resources
  // For each page i (from 0 to pages.length - 1):
  // Page object ID: 4 + 2 * i
  // Content stream object ID: 4 + 2 * i + 1

  const totalPages = pages.length;
  const pageObjIds = [];
  for (let i = 0; i < totalPages; i++) {
    pageObjIds.push(4 + 2 * i);
  }

  const objects = [];

  // 1: Catalog
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

  // 2: Pages
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${totalPages} >>`;

  // 3: Font Resources
  objects[3] = `<< /Font <<
    /F1 << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>
    /F2 << /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>
    /F3 << /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>
    /F4 << /Type /Font /Subtype /Type1 /BaseFont /Courier >>
  >> >>`;

  for (let i = 0; i < totalPages; i++) {
    const pageObjId = 4 + 2 * i;
    const contentObjId = 4 + 2 * i + 1;
    const ops = pages[i];

    // Page number in footer
    ops.push({ font: '/F1', size: 9, x: pageWidth / 2 - 10, y: 35, text: `${i + 1} / ${totalPages}` });

    let stream = 'BT\n';
    for (const op of ops) {
      stream += `${op.font} ${op.size} Tf\n${op.x.toFixed(2)} ${op.y.toFixed(2)} Td\n(${escapePdf(op.text)}) Tj\n`;
    }
    stream += 'ET\n';

    const streamBuf = Buffer.from(stream, 'utf8');

    // Page object
    objects[pageObjId] = `<< /Type /Page /Parent 2 0 R /Resources 3 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjId} 0 R >>`;

    // Content stream object
    objects[contentObjId] = `<< /Length ${streamBuf.length} >>\nstream\n${stream}endstream`;
  }

  // Build final binary
  let out = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'utf8');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(out, 'utf8');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(out, 'utf8');
}
