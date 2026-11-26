import { useState, useMemo } from 'react';
import {
  BookOpen,
  Code2,
  Cpu,
  FileCode2,
  HardDrive,
  Info,
  Layout,
  Lock,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Users,
  Workflow,
  Zap,
  Eye,
  Database,
  FileText,
  ArrowRight,
  Calendar,
  GitBranch,
  ShieldAlert,
  Sliders,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

export type TopicCategory = 'all' | 'architecture' | 'engines' | 'collaboration' | 'ai' | 'security';

interface Topic {
  id: number;
  category: TopicCategory;
  categoryLabel: string;
  title: string;
  icon: typeof Info;
  badge: string;
  summary: string;
  detail: string;
  specs: { label: string; value: string }[];
  actionLink?: string;
  actionText?: string;
}

export const PLATFORM_TOPICS: Topic[] = [
  {
    id: 1,
    category: 'architecture',
    categoryLabel: 'Core Architecture',
    title: 'Unified Workspace Paradigm',
    icon: Layout,
    badge: 'Zero Tool Fragmentation',
    summary: 'Single unified shell consolidating projects, live documents, LaTeX, source code, and cloud assets.',
    detail: 'Modern product teams lose hundreds of hours switching between Notion, Overleaf, Linear, VS Code, and ChatGPT. Zynckle converges these fragmented modalities into a single local-first application shell where documents cite code, Kanban tasks link to mathematical papers, and AI agents reference entire workspace contexts without context switching.',
    specs: [
      { label: 'Latency Goal', value: '< 16ms interaction loop' },
      { label: 'Modalities', value: 'Docs, LaTeX, Kanban, Code, Drive, AI' },
      { label: 'Integration', value: 'Unified cross-referenced data model' }
    ],
    actionLink: '/',
    actionText: 'Explore Overview Dashboard'
  },
  {
    id: 2,
    category: 'architecture',
    categoryLabel: 'Core Architecture',
    title: 'High-Contrast Monochrome Design System',
    icon: Sliders,
    badge: 'Pitch Black & Stark White',
    summary: 'Calibrated visual ergonomics built strictly on pitch black, stark white, and neutral zinc greys.',
    detail: 'Eliminates colorful SaaS fatigue with an executive monochrome palette (#000000, #09090b, #18181b, #27272a, #ffffff). Micro-animations, subtle laser borders, smooth drawer expansions, and crisp typography (Inter, Geist, and JetBrains Mono) provide unparalleled contrast and legibility for long coding and research sessions.',
    specs: [
      { label: 'Contrast Ratio', value: '21:1 AAA WCAG Compliant' },
      { label: 'Modes', value: 'Pure Pitch Dark, Crisp Light, OS Sync' },
      { label: 'Motion', value: 'Spring micro-interactions with reduced-motion support' }
    ],
    actionLink: '/settings#appearance',
    actionText: 'Configure Appearance'
  },
  {
    id: 3,
    category: 'architecture',
    categoryLabel: 'Core Architecture',
    title: 'Server-Backed Workspace Store',
    icon: Database,
    badge: 'Honest errors, no fake data',
    summary: 'Every project, task and document lives in the Spring Boot backend, shared by the whole workspace.',
    detail: 'All state is stored on the server and pushed to everyone in the workspace over WebSockets. If the backend is unreachable, Zynckle says so plainly instead of showing made-up placeholder data, so problems are never hidden.',
    specs: [
      { label: 'Persistence', value: 'Spring Boot + H2 / PostgreSQL' },
      { label: 'Live updates', value: 'WebSocket events and Yjs co-editing' },
      { label: 'Failures', value: 'Reported to the user, never masked' }
    ],
    actionLink: '/today',
    actionText: 'Open Daily Edition'
  },
  {
    id: 4,
    category: 'engines',
    categoryLabel: 'Document & Research Engines',
    title: 'LaTeX Studio with Live PDF',
    icon: FileCode2,
    badge: 'Real TeX, sandboxed',
    summary: 'Write LaTeX beside a live PDF, compiled on the server by a real TeX engine when one is installed.',
    detail: 'The server compiles with pdflatex, xelatex, lualatex or Tectonic when one is installed (set LATEX_COMPILER or put it on PATH). Without one, a simplified preview renderer draws titles, sections and paragraphs so you can keep writing, and the studio says so. Errors are reported with their line numbers instead of being replaced by a placeholder PDF.',
    specs: [
      { label: 'Engines', value: 'pdflatex · xelatex · lualatex · Tectonic' },
      { label: 'Safety', value: 'No shell escape, folder-only file access, 45 s limit' },
      { label: 'Cancellation', value: 'Superseded compiles are aborted' }
    ],
    actionLink: '/latex',
    actionText: 'Launch LaTeX Studio'
  },
  {
    id: 5,
    category: 'collaboration',
    categoryLabel: 'Realtime & Collaboration',
    title: 'Yjs CRDT Real-Time Document Synchronization',
    icon: Users,
    badge: 'Conflict-Free Replicated Data Types',
    summary: 'Real-time collaborative co-authoring powered by Yjs CRDTs over WebSockets.',
    detail: 'Documents feature real-time multi-user co-editing over lightweight WebSockets using Yjs CRDTs. Multiple team members can write simultaneously with live colored awareness carets and text selections. State updates merge mathematically with zero lock-stepping, zero lost edits, and offline reconciliation.',
    specs: [
      { label: 'Sync Protocol', value: 'Yjs Binary State Vectors' },
      { label: 'Transport', value: 'Multiplexed WebSockets (ws://)' },
      { label: 'Carets', value: 'Live peer presence with color-coded awareness' }
    ],
    actionLink: '/documents',
    actionText: 'Open Collaborative Documents'
  },
  {
    id: 6,
    category: 'collaboration',
    categoryLabel: 'Realtime & Collaboration',
    title: 'Natural Language Quick Capture HUD (Hotkey: C)',
    icon: Terminal,
    badge: 'Live NLP Tokenizer',
    summary: 'Global ambient modal that parses conversational text into dates, priorities, assignees, and projects.',
    detail: 'Pressing C anywhere in the workspace invokes the Quick Capture HUD. The live parser dynamically identifies dates (tomorrow, in 3 days, Nov 24), urgency flags (!urgent, !high, p1), assignees (@grace), project references (#atlas), and Kanban status (~review), rendering reactive chip badges in real time before the task is committed.',
    specs: [
      { label: 'Hotkey', value: 'C (Global ambient capture)' },
      { label: 'Token Grammar', value: '!priority, @assignee, #project, ~column' },
      { label: 'Commit Action', value: 'Enter (Create) / Ctrl+Enter (Continuous Entry)' }
    ],
    actionLink: '/tasks',
    actionText: 'View Task Kanban Board'
  },
  {
    id: 7,
    category: 'architecture',
    categoryLabel: 'Core Architecture',
    title: 'The Daily Edition (/today)',
    icon: Calendar,
    badge: 'Editorial Executive Briefing',
    summary: 'Newspaper-style front page dynamically generated from live workspace momentum and deadlines.',
    detail: 'Replaces cluttered dashboards with an editorial briefing: lead story highlighting the most pressing task, by-the-numbers metrics, due today vs running late breakdown, week-ahead forecast, and overnight teammate activity. Supports instant toggling between "My Desk" and "The Newsroom".',
    specs: [
      { label: 'Routing', value: '/today (Shortcut: G Y)' },
      { label: 'Data Feeds', value: 'Tasks, deadlines, audits, team activity' },
      { label: 'Perspectives', value: 'Personal Desk vs Global Workspace Newsroom' }
    ],
    actionLink: '/today',
    actionText: 'Read Today’s Edition'
  },
  {
    id: 8,
    category: 'collaboration',
    categoryLabel: 'Realtime & Collaboration',
    title: 'Kanban Matrix & Agile Task Flow',
    icon: Workflow,
    badge: 'Optimistic State Transitions',
    summary: 'Fluid drag-and-drop task boards with optimistic UI updates, filters, and threaded comments.',
    detail: 'Manage multi-stage pipelines from Backlog to Done with smooth drag-and-drop reordering, instant optimistic client updates, assignee filtering, and due date countdown badges. Tasks open into an inspector drawer featuring markdown descriptions and threaded comments with @mentions.',
    specs: [
      { label: 'Views', value: 'Kanban Board, Compact List, Timeline' },
      { label: 'Updates', value: 'Optimistic local mutation + socket broadcast' },
      { label: 'Comments', value: 'Threaded discussions with quote replies' }
    ],
    actionLink: '/projects',
    actionText: 'Manage Projects'
  },
  {
    id: 9,
    category: 'engines',
    categoryLabel: 'Document & Research Engines',
    title: 'Distraction-Free Focus Mode',
    icon: Eye,
    badge: 'Calibrated Reading Measure',
    summary: 'Single-keystroke escape stripping all UI chrome for immersion in complex technical writing.',
    detail: 'Writing and technical reviewing require deep focus. Pressing Focus Mode or Esc strips away topbars, navigation drawers, and floating panels, leaving an optically calibrated serif reading measure. Rolling revision history automatically captures 30 immutable snapshots with point-in-time restore.',
    specs: [
      { label: 'Trigger', value: 'Focus button or Esc shortcut' },
      { label: 'Revisions', value: '30 rolling snapshots with diff comparison' },
      { label: 'Export', value: 'Markdown, HTML, Plain Text, Vector PDF' }
    ],
    actionLink: '/documents',
    actionText: 'Open Editor Focus Mode'
  },
  {
    id: 10,
    category: 'engines',
    categoryLabel: 'Document & Research Engines',
    title: 'Code Studio & Sandboxed Web Previews',
    icon: Code2,
    badge: 'Opaque Origin Execution',
    summary: 'In-browser IDE with syntax highlighting, line jumping, and sandboxed live site previews.',
    detail: 'Upload source code folders, ZIP archives, or single files. Browse folder trees with syntax highlighting, line numbers, and full-text fuzzy regex search. Any project containing an index.html file can be launched into an isolated sandbox iframe served on an opaque origin with restricted Content-Security-Policy headers.',
    specs: [
      { label: 'Syntax Engines', value: 'CodeMirror 6, Lezer highlighting' },
      { label: 'Sandboxing', value: 'Opaque origin, restricted frame-ancestors' },
      { label: 'File Limits', value: 'Streaming ZIP decompression up to 40 MB' }
    ],
    actionLink: '/code',
    actionText: 'Browse Code Studio'
  },
  {
    id: 11,
    category: 'engines',
    categoryLabel: 'Document & Research Engines',
    title: 'One-Click Public GitHub Ingestion',
    icon: GitBranch,
    badge: 'Zero-Clone Repository Import',
    summary: 'Instantly import and inspect public repositories directly into editable workspace projects.',
    detail: 'Input any public GitHub repository URL (e.g. github.com/owner/repo) to fetch, unpack, and index the entire tree directly into Zynckle Code Studio. Files become searchable, editable, and ready for one-click AI code explanations and vulnerability reviews without installing git locally.',
    specs: [
      { label: 'Transport', value: 'Streaming GitHub Tarball API' },
      { label: 'Storage', value: 'Decoupled file tree indexed in workspace store' },
      { label: 'Review', value: 'Direct AI Code Review integration' }
    ],
    actionLink: '/code',
    actionText: 'Import from GitHub'
  },
  {
    id: 12,
    category: 'ai',
    categoryLabel: 'AI & Machine Intelligence',
    title: 'Context-Aware Workspace AI Mesh (RAG)',
    icon: Sparkles,
    badge: 'Multi-Provider Streaming Intelligence',
    summary: 'AI copilot grounded in user-selected project, document, and source code context.',
    detail: 'Unlike generic chatbots, Zynckle AI operates with explicit workspace awareness. Users choose exactly which project tasks, active documents, or repository files to feed as ground truth. Features streaming responses across specialized modes: General, Explain Code, Review Code (with severity tags), Debug, and Database Architect.',
    specs: [
      { label: 'Supported Providers', value: 'Groq (Llama 3.3 70B), Google Gemini 2.0, OpenRouter' },
      { label: 'Context Guard', value: 'Zero ambient data leakage; user-selected context only' },
      { label: 'Output Formatting', value: 'Full Markdown, highlighted code, Mermaid diagrams' }
    ],
    actionLink: '/ai',
    actionText: 'Open Zynckle AI Studio'
  },
  {
    id: 13,
    category: 'ai',
    categoryLabel: 'AI & Machine Intelligence',
    title: 'AI Architecture Designer',
    icon: Cpu,
    badge: '12-Section Spec Generator',
    summary: 'Generates end-to-end technical architecture specifications with Mermaid diagrams and React Flow trees.',
    detail: 'Takes high-level product briefs and automatically compiles 12 detailed architectural sections: executive summary, system topology, component interactions, API schemas, security enclaves, scaling limits, and disaster recovery. Each section can be independently regenerated, edited, and exported directly into Documents.',
    specs: [
      { label: 'Structure', value: '12 modular, independently regenerable sections' },
      { label: 'Visualizations', value: 'Mermaid class/sequence charts & React Flow interactive graphs' },
      { label: 'Export', value: 'Markdown, PDF, and live workspace document saving' }
    ],
    actionLink: '/ai/architecture',
    actionText: 'Design Architecture'
  },
  {
    id: 14,
    category: 'ai',
    categoryLabel: 'AI & Machine Intelligence',
    title: 'Docs & Planning Workshop',
    icon: FileText,
    badge: 'Evidence-Based Verification',
    summary: 'Generates Software Requirements Specifications (SRS) and verifiable implementation plans.',
    detail: 'An AI-powered technical authoring workshop that drafts evidence-based documentation (SRS, API manuals, database designs, rollout plans). It rigorously cites provided source files as primary evidence, marks speculative assumptions, and generates actionable Kanban tasks only after explicit human review.',
    specs: [
      { label: 'Artifacts', value: 'SRS, API Specs, Database Relational Schemas, Milestones' },
      { label: 'Verification', value: 'Source citations required; assumptions explicitly highlighted' },
      { label: 'Task Generation', value: 'One-click conversion of proposed tasks to Kanban cards' }
    ],
    actionLink: '/ai/workshop',
    actionText: 'Launch Planning Workshop'
  },
  {
    id: 15,
    category: 'security',
    categoryLabel: 'Security & Governance',
    title: 'Security: bcrypt and HttpOnly Sessions',
    icon: Lock,
    badge: 'Sessions scripts cannot read',
    summary: 'bcrypt password hashing, HttpOnly session cookies with CSRF protection, and per-device session revocation.',
    detail: 'Passwords are hashed with bcrypt (cost 11) and never stored. Each sign-in creates a random 32-byte session token; only its SHA-256 digest is kept on the server, and the browser holds it in an HttpOnly, SameSite cookie that page scripts cannot read. Cookie-authenticated writes require a custom header that other sites cannot send, and only the app\'s own origins may make credentialed requests. Sessions can be revoked one by one or all at once from Settings.',
    specs: [
      { label: 'Password hashing', value: 'bcrypt, cost factor 11' },
      { label: 'Sessions', value: 'HttpOnly cookie; 32-byte token, SHA-256 hashed at rest' },
      { label: 'Revocation', value: 'Per-device and global revoke-others endpoints' }
    ],
    actionLink: '/settings#security',
    actionText: 'View Security Settings'
  },
  {
    id: 16,
    category: 'security',
    categoryLabel: 'Security & Governance',
    title: 'Anti-SSRF Network Fortress',
    icon: ShieldAlert,
    badge: 'Private CIDR Rejection Guard',
    summary: 'Server-side request filtering strictly prohibiting access to internal network infrastructure.',
    detail: 'Whenever Zynckle fetches website preview headers, validates frame compatibility, or downloads external assets, all destination IP addresses are resolved and checked against non-routable, loopback, and private IPv4/IPv6 CIDR ranges (127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16). Requests targeting internal clouds are aborted immediately.',
    specs: [
      { label: 'Loopback Guard', value: 'Blocks 127.0.0.0/8 and ::1' },
      { label: 'RFC 1918 Guard', value: 'Blocks 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16' },
      { label: 'Link-Local Guard', value: 'Blocks AWS/GCP metadata service 169.254.169.254' }
    ],
    actionLink: '/previews',
    actionText: 'Check Website Previews'
  },
  {
    id: 17,
    category: 'architecture',
    categoryLabel: 'Core Architecture',
    title: 'Hybrid Cloud Object Storage (Disk & Cloudflare R2)',
    icon: HardDrive,
    badge: 'AWS SigV4 Compatible',
    summary: 'Streaming uploads and short-lived signed URLs for local disk or Cloudflare R2 / S3 storage.',
    detail: 'Files uploaded to Zynckle Drive bypass application database tables completely. Binary data streams directly into local disk partitions or any S3-compatible bucket (such as Cloudflare R2) authenticated via AWS Signature Version 4. Previews for PDF, audio, video, and imagery stream securely via short-lived signed URLs.',
    specs: [
      { label: 'Cloud Driver', value: 'Cloudflare R2 / AWS S3 / MinIO (SigV4)' },
      { label: 'Local Driver', value: 'Zero-overhead streaming disk pipeline' },
      { label: 'Quotas', value: 'Per-workspace quota monitoring and file size limits' }
    ],
    actionLink: '/drive',
    actionText: 'Open Cloud Drive'
  },
  {
    id: 18,
    category: 'security',
    categoryLabel: 'Security & Governance',
    title: 'Granular Role-Based Access Control (RBAC)',
    icon: Shield,
    badge: 'Cryptographically Enforced Permissions',
    summary: 'Multi-tiered workspace hierarchy (Owner, Admin, Member, Viewer) validated on every route.',
    detail: 'Access control is never delegated solely to frontend toggles. Every HTTP route and WebSocket protocol frame explicitly verifies caller membership and role in the target workspace. Viewers are blocked from editing; Admins can manage integrations; Owners retain sole authority over workspace deletion and ownership transfer.',
    specs: [
      { label: 'Roles', value: 'OWNER, ADMIN, MEMBER, VIEWER' },
      { label: 'Enforcement', value: 'Server-side middleware validation on all API calls' },
      { label: 'Invites', value: 'Signed, revocable invitation tokens with role pinning' }
    ],
    actionLink: '/team',
    actionText: 'Manage Workspace Team'
  },
  {
    id: 19,
    category: 'architecture',
    categoryLabel: 'Core Architecture',
    title: 'Complete Keyboard Navigation & Command Layer',
    icon: Zap,
    badge: 'Speed-of-Thought Chords',
    summary: 'Comprehensive keyboard interface including Command Palette (⌘K), Assistant (⌘J), and G chords.',
    detail: 'Designed for developers who work without leaving home row. Pressing ⌘K (or Ctrl+K) invokes global search and quick actions. ⌘J summons the streaming AI assistant. Chorded keys (pressing G then Y, P, T, O, L, C, D, or S) instantly navigate between sections, while Mod+Enter compiles LaTeX in 5ms.',
    specs: [
      { label: 'Palette', value: '⌘K / Ctrl+K with fuzzy page & task search' },
      { label: 'Navigation Chords', value: 'G Y (Today), G P (Projects), G L (LaTeX), G C (Code)' },
      { label: 'Cheatsheet', value: 'Press ? anytime to open the full shortcut modal' }
    ],
    actionLink: '/settings#profile',
    actionText: 'View Keyboard Shortcuts'
  },
  {
    id: 20,
    category: 'security',
    categoryLabel: 'Security & Governance',
    title: 'Audit Logging & Enterprise Governance',
    icon: CheckCircle2,
    badge: 'Immutable Event Trail',
    summary: 'Administrative audit logs tracking membership changes, role elevations, and asset deletions.',
    detail: 'Workspaces maintain an immutable audit trail capturing sensitive security events: user role updates, member removals, document access sharing, workspace renaming, and ownership transfers. Admins can inspect timestamps, actors, and IP addresses to ensure complete governance and compliance.',
    specs: [
      { label: 'Logged Events', value: 'Role changes, deletions, shares, ownership transfers' },
      { label: 'Access Level', value: 'Restricted strictly to Workspace Owners and Admins' },
      { label: 'Retention', value: 'Timestamped event sequence with reverse chronology' }
    ],
    actionLink: '/settings#audit',
    actionText: 'Inspect Audit Log'
  }
];

export default function AboutStudio({ notify: _notify }: { notify?: (msg: string) => void }) {
  const [filter, setFilter] = useState<TopicCategory>('all');
  const [query, setQuery] = useState('');
  const [expandedTopic, setExpandedTopic] = useState<number | null>(1);

  const filteredTopics = useMemo(() => {
    return PLATFORM_TOPICS.filter(t => {
      const matchCat = filter === 'all' || t.category === filter;
      const q = query.trim().toLowerCase();
      const matchQuery =
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.detail.toLowerCase().includes(q) ||
        t.badge.toLowerCase().includes(q) ||
        t.categoryLabel.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [filter, query]);

  return (
    <div className="about-studio-root zy-page-container">
      {/* Hero Welcome Row */}
      <section className="welcome-row subpage-welcome">
        <div>
          <div className="eyebrow">ZYNCKLE ECOSYSTEM &amp; SPECIFICATION</div>
          <h1>
            Platform Architecture &amp; <em>20 Core Topics</em>
          </h1>
          <p className="welcome-sub">
            The unified collaborative workspace and research operating system. Explore the architectural foundation,
            LaTeX studio with live PDF, real-time Yjs co-editing, and server-enforced permissions.
          </p>
        </div>
      </section>

      {/* System Telemetry Specs Strip */}
      <section className="about-telemetry-grid">
        <div className="telemetry-card">
          <span className="telemetry-label">PLATFORM RUNTIME</span>
          <span className="telemetry-value">v0.1.0</span>
          <span className="telemetry-status ok">● Server-backed workspace</span>
        </div>
        <div className="telemetry-card">
          <span className="telemetry-label">TEX COMPILATION ENGINE</span>
          <span className="telemetry-value">TeX or preview</span>
          <span className="telemetry-status ok">● Compiled on the server</span>
        </div>
        <div className="telemetry-card">
          <span className="telemetry-label">REALTIME COLLABORATION</span>
          <span className="telemetry-value">Yjs CRDTs</span>
          <span className="telemetry-status ok">● WebSocket Multiplexed</span>
        </div>
        <div className="telemetry-card">
          <span className="telemetry-label">SECURITY &amp; DEFENSE</span>
          <span className="telemetry-value">bcrypt + HttpOnly</span>
          <span className="telemetry-status ok">● CSRF-protected sessions</span>
        </div>
      </section>

      {/* Interactive Controls & Category Bar */}
      <section className="about-toolbar">
        <div className="about-search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search all 20 topics (e.g. latex, yjs, security, ai, storage, focus mode)..."
            aria-label="Search 20 topics"
          />
          {query && (
            <button className="clear-btn" onClick={() => setQuery('')}>
              Clear
            </button>
          )}
        </div>

        <div className="about-category-pills" role="tablist" aria-label="Topic categories">
          {[
            { id: 'all', label: `All Topics (${PLATFORM_TOPICS.length})` },
            { id: 'architecture', label: 'Architecture (5)' },
            { id: 'engines', label: 'Document & TeX (4)' },
            { id: 'collaboration', label: 'Realtime (3)' },
            { id: 'ai', label: 'AI & Mesh (3)' },
            { id: 'security', label: 'Security (5)' }
          ].map(cat => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={filter === cat.id}
              className={`category-pill ${filter === cat.id ? 'active' : ''}`}
              onClick={() => setFilter(cat.id as TopicCategory)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </section>

      {/* 20 Platform Topics Accordion / Grid */}
      <section className="about-topics-section">
        <div className="section-header-meta">
          <span className="eyebrow">
            SHOWING {filteredTopics.length} OF {PLATFORM_TOPICS.length} VERIFIED ARCHITECTURAL TOPICS
          </span>
        </div>

        <div className="about-topics-list">
          {filteredTopics.map(topic => {
            const isExpanded = expandedTopic === topic.id;
            const Icon = topic.icon;

            return (
              <article
                key={topic.id}
                className={`topic-card ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedTopic(isExpanded ? null : topic.id)}
              >
                <div className="topic-header">
                  <div className="topic-header-left">
                    <span className="topic-number">
                      {topic.id < 10 ? `0${topic.id}` : topic.id} // 20
                    </span>
                    <div className="topic-icon-wrap">
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="topic-title-row">
                        <h2 className="topic-title">{topic.title}</h2>
                        <span className="topic-badge">{topic.badge}</span>
                      </div>
                      <p className="topic-summary">{topic.summary}</p>
                    </div>
                  </div>

                  <div className="topic-header-right">
                    <span className="topic-category-tag">{topic.categoryLabel}</span>
                    <span className="toggle-indicator">{isExpanded ? '−' : '+'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="topic-body" onClick={e => e.stopPropagation()}>
                    <p className="topic-detail-text">{topic.detail}</p>

                    {/* Technical Specifications Matrix */}
                    <div className="topic-specs-grid">
                      {topic.specs.map((spec, i) => (
                        <div key={i} className="spec-box">
                          <span className="spec-label">{spec.label}</span>
                          <span className="spec-value">{spec.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Deep link action into the app */}
                    {topic.actionLink && (
                      <div className="topic-action-row">
                        <NavLink to={topic.actionLink} className="button-secondary topic-cta-btn">
                          {topic.actionText || 'Launch feature'} <ArrowRight size={14} />
                        </NavLink>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Footer System Specs Callout */}
      <section className="about-footer-card">
        <div className="footer-card-inner">
          <div className="eyebrow">HIGH-ASSURANCE OPEN PLATFORM</div>
          <h3>Designed for Technical Writers, Architects &amp; Research Engineers</h3>
          <p>
            Zynckle replaces fragmented software suites with one pitch-black, connected workspace.
            Every tool is wired together in one workspace you can host yourself.
          </p>
          <div className="footer-links-row">
            <NavLink to="/latex" className="button-primary">
              <FileCode2 size={15} /> Open LaTeX Studio
            </NavLink>
            <NavLink to="/documents" className="button-secondary">
              <BookOpen size={15} /> Collaborative Docs
            </NavLink>
            <NavLink to="/today" className="button-secondary">
              <Calendar size={15} /> The Daily Edition
            </NavLink>
            <a
              href="https://github.com/Allen73737/zynckle"
              target="_blank"
              rel="noreferrer"
              className="button-secondary"
            >
              <ExternalLink size={15} /> GitHub Repository
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
