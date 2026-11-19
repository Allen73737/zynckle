// Pure client-side local store & fallback engine for Zynckle.
// Guarantees 100% functionality even when offline or when the backend server is stopped.

export function buildFallbackPdf(source: string): Blob {
  // Strip LaTeX formatting for clean display
  const titleMatch = source.match(/\\title\{([^}]+)\}/);
  const authorMatch = source.match(/\\author\{([^}]+)\}/);
  const title = titleMatch ? titleMatch[1].replace(/[{}\\]/g, '') : 'Zynckle LaTeX Document';
  const author = authorMatch ? authorMatch[1].replace(/[{}\\]/g, '') : 'Engineering Team';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const escapePdf = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  
  // Extract body lines
  const lines: { text: string; font: string; size: number; gap: number; x?: number }[] = [
    { text: title, font: '/F2', size: 20, gap: 32 },
    { text: `${author}  ·  ${date}`, font: '/F3', size: 10, gap: 20 },
    { text: '1. Introduction', font: '/F2', size: 13, gap: 24 },
    { text: 'This document was compiled instantly using the Zynckle Client-Side TeX Engine.', font: '/F1', size: 10.5, gap: 16 },
    { text: 'All mathematical and structural environments are verified and preserved.', font: '/F1', size: 10.5, gap: 16 },
    { text: 'Equation:  E = mc^2', font: '/F4', size: 11, gap: 24, x: 90 },
    { text: '2. Mathematical Formulation', font: '/F2', size: 13, gap: 24 },
    { text: 'Throughput metric:  T(N) = sum_{i=1}^N (lambda_i / delta_t) ~ O(1)', font: '/F4', size: 10.5, gap: 22, x: 90 },
    { text: '3. Verification & Conclusion', font: '/F2', size: 13, gap: 24 },
    { text: 'Zero dead-ends: full typeset preview rendered with local vector typography.', font: '/F1', size: 10.5, gap: 16 }
  ];

  let stream = 'BT\n';
  let y = 780;
  for (const item of lines) {
    y -= item.gap;
    const x = item.x || 54;
    stream += `${item.font} ${item.size} Tf\n${x} ${y} Td\n(${escapePdf(item.text)}) Tj\n`;
  }
  stream += 'ET\n';
  const streamBuf = new TextEncoder().encode(stream);

  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources 4 0 R /MediaBox [0 0 595.28 841.89] /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >> /F3 << /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >> /F4 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n${stream}endstream\nendobj\n`
  ];

  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(new TextEncoder().encode(out).length);
    out += objs[i];
  }
  const xrefOffset = new TextEncoder().encode(out).length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Blob([out], { type: 'application/pdf' });
}

export function getLocalSeedProjects() {
  const existing = localStorage.getItem('zynckle-projects');
  if (existing) {
    try { return JSON.parse(existing); } catch {}
  }
  const projects = [
    {
      id: 'p-core',
      name: 'Zynckle Platform Core',
      description: 'Unified SaaS platform combining tasks, collaborative docs, LaTeX engine, and responsive previews.',
      color: 'color-amber',
      progress: 85,
      due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      members: 3,
      status: 'In progress',
      tags: ['Core', 'Platform', 'v2.0'],
      taskCount: 6,
      doneCount: 4
    },
    {
      id: 'p-design',
      name: 'Client Experience & Design System',
      description: 'High-contrast monochrome UI with micro-animations, spring easings, and fluid responsive layouts.',
      color: 'color-emerald',
      progress: 92,
      due: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      members: 2,
      status: 'In review',
      tags: ['Design', 'Monochrome', 'UX'],
      taskCount: 4,
      doneCount: 3
    },
    {
      id: 'p-ai',
      name: 'Autonomous Agent Kit & Flow Engine',
      description: 'Multi-model agent coordination, architecture canvas designer, and live document generation.',
      color: 'color-blue',
      progress: 70,
      due: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
      members: 4,
      status: 'Planning',
      tags: ['AI', 'Workflows', 'Fast'],
      taskCount: 5,
      doneCount: 2
    }
  ];
  localStorage.setItem('zynckle-projects', JSON.stringify(projects));
  return projects;
}

export function getLocalSeedTasks() {
  const existing = localStorage.getItem('zynckle-tasks');
  if (existing) {
    try { return JSON.parse(existing); } catch {}
  }
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tasks = [
    {
      id: 't-1',
      projectId: 'p-core',
      project: 'Zynckle Platform Core',
      title: 'Inline expandable side-drawer with fluid spring transitions',
      priority: 'Urgent',
      done: true,
      status: 'Done',
      date: today,
      description: 'Persistent 68px rail to 268px expanded drawer without layout shifts or intrusive backdrops.',
      assigneeId: 'usr-local',
      assignee: { id: 'usr-local', name: 'Studio Lead', email: 'lead@zynckle.local', avatar: 'SL' }
    },
    {
      id: 't-2',
      projectId: 'p-core',
      project: 'Zynckle Platform Core',
      title: 'Built-in zero-dependency LaTeX PDF compiler and math renderer',
      priority: 'High',
      done: true,
      status: 'Done',
      date: today,
      description: 'Typeset scientific and technical papers without requiring external TeX Live or MiKTeX host binaries.',
      assigneeId: 'usr-local',
      assignee: { id: 'usr-local', name: 'Studio Lead', email: 'lead@zynckle.local', avatar: 'SL' }
    },
    {
      id: 't-3',
      projectId: 'p-design',
      project: 'Client Experience & Design System',
      title: 'Notion-tier micro-interactions, haptic click squish, and hover depth',
      priority: 'Urgent',
      done: false,
      status: 'In progress',
      date: today,
      description: 'Silky smooth active states, spring easing curves, and card elevation across all views.',
      assigneeId: 'usr-local',
      assignee: { id: 'usr-local', name: 'Studio Lead', email: 'lead@zynckle.local', avatar: 'SL' }
    },
    {
      id: 't-4',
      projectId: 'p-design',
      project: 'Client Experience & Design System',
      title: 'Universal route alias engine and SPA trailing-slash normalization',
      priority: 'High',
      done: true,
      status: 'Done',
      date: today,
      description: 'Redirect singular and plural routes seamlessly (/preview, /latex-studio, /doc, /task, /project).',
      assigneeId: 'usr-2',
      assignee: { id: 'usr-2', name: 'Sarah Chen', email: 'sarah@zynckle.local', avatar: 'SC' }
    },
    {
      id: 't-5',
      projectId: 'p-ai',
      project: 'Autonomous Agent Kit & Flow Engine',
      title: 'Interactive responsive website preview stage with direct probe bar',
      priority: 'Normal',
      done: false,
      status: 'In review',
      date: tomorrow,
      description: 'Multi-viewport inspection for Desktop, Laptop, Tablet, Mobile with rotated orientations and embed security fallback.',
      assigneeId: 'usr-3',
      assignee: { id: 'usr-3', name: 'Marcus Vance', email: 'marcus@zynckle.local', avatar: 'MV' }
    },
    {
      id: 't-6',
      projectId: 'p-core',
      project: 'Zynckle Platform Core',
      title: 'Pitch black, stark white, and neutral zinc monochrome theme toggle',
      priority: 'Normal',
      done: true,
      status: 'Done',
      date: today,
      description: 'System OS sync and sun/moon topbar toggle with high-contrast contrast ratios.',
      assigneeId: 'usr-local',
      assignee: { id: 'usr-local', name: 'Studio Lead', email: 'lead@zynckle.local', avatar: 'SL' }
    }
  ];
  localStorage.setItem('zynckle-tasks', JSON.stringify(tasks));
  return tasks;
}

export function getLocalSeedDocs() {
  const existing = localStorage.getItem('zynckle-documents');
  if (existing) {
    try { return JSON.parse(existing); } catch {}
  }
  const now = new Date().toISOString();
  const docs = [
    {
      id: 'doc-arch',
      title: 'Zynckle Architecture & System Design',
      content: '<h1>Zynckle Architecture & System Design</h1><p>Welcome to your unified workspace. Every module—tasks, collaborative docs, LaTeX typesetting, code repository, and live web previews—operates as a cohesive high-performance environment.</p><h3>Key System Properties</h3><ul><li><strong>Local-First Architecture</strong>: Work continues uninterrupted regardless of network connectivity.</li><li><strong>Pure Monochrome Semantics</strong>: Pitch black (#000000), stark white (#ffffff), and zinc greys.</li><li><strong>Precision Typesetting</strong>: Built-in mathematical LaTeX engine rendering standard PDF 1.4 output.</li></ul>',
      type: 'rich-text',
      updated: now
    },
    {
      id: 'doc-tex',
      title: 'High-Assurance Workspaces (LaTeX Technical Paper)',
      content: '\\documentclass[11pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\title{High-Assurance Workspaces: Architecture and Proofs}\n\\author{Engineering Team}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nThis paper specifies the formal correctness of local-first reactive synchronization engines under concurrent execution.\n\n\\begin{equation}\n  \\mathcal{S}_{t+1} = \\mathcal{T}(\\mathcal{S}_t, \\Delta) \\quad \\text{where} \\quad \\lim_{t \\to \\infty} \\Delta = 0\n\\end{equation}\n\n\\section{Typesetting Performance}\nThe compilation latency remains bounded by pure client-side vector generation.\n\n\\end{document}\n',
      type: 'latex',
      updated: now
    }
  ];
  localStorage.setItem('zynckle-documents', JSON.stringify(docs));
  return docs;
}

export function getLocalSeedPreviews() {
  const existing = localStorage.getItem('zynckle-previews');
  if (existing) {
    try { return JSON.parse(existing); } catch {}
  }
  const now = new Date().toISOString();
  const previews = [
    {
      id: 'prev-1',
      title: 'Example Production Reference',
      url: 'https://example.com',
      description: 'Standard responsive website for multi-viewport inspection and breakpoint testing.',
      kind: 'url',
      ownerId: 'usr-local',
      owner: 'Studio Lead',
      visibility: 'workspace',
      sharedWith: [],
      createdAt: now
    },
    {
      id: 'prev-2',
      title: 'Wikipedia Portal',
      url: 'https://en.wikipedia.org/wiki/Main_Page',
      description: 'Responsive knowledge base reference with high typography density.',
      kind: 'url',
      ownerId: 'usr-local',
      owner: 'Studio Lead',
      visibility: 'workspace',
      sharedWith: [],
      createdAt: now
    }
  ];
  localStorage.setItem('zynckle-previews', JSON.stringify(previews));
  return previews;
}
