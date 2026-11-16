# Zynckle

**One workspace. Everything connected.** Plan, collaborate, document, organise and create — projects, live documents, LaTeX, source code, website previews, cloud files and a workspace-aware AI in one product.

```
frontend/   React 18 · TypeScript · Vite · Tiptap + Yjs · CodeMirror · Mermaid · React Flow
backend/    Node.js API (no framework) · WebSockets (ws) · Yjs sync server · JSON metadata store
            backend/src = Spring Boot / PostgreSQL foundation and Flyway migrations (not started by npm)
```

## Quick start

Requirements: **Node.js 20+**. Optional: MiKTeX or TeX Live (`pdflatex`) for LaTeX compilation; an AI provider key.

```powershell
copy .env.example .env        # then add GROQ_API_KEY (or GEMINI_API_KEY / OPENROUTER_API_KEY)

cd backend
npm install
npm start                     # API + realtime on http://127.0.0.1:8080

cd ../frontend                # second terminal
npm install
npm run dev                   # http://localhost:5173 (proxies /api, /ws, /collab, /sites)
```

Create an account in the browser. Single-process production run: `cd frontend && npm run build`, then `cd backend && npm start` — the API serves `frontend/dist` with a strict Content-Security-Policy at `http://127.0.0.1:8080`.

### Checks

| Command | What it verifies |
| --- | --- |
| `cd backend && npm test` | 12 API integration suites against an isolated server: auth + reset flow, role enforcement, cross-workspace isolation, private sharing, signed URLs, executable blocking, ZIP traversal / bomb rejection, sandboxed static sites, SSRF guard, honest AI-unavailable state, WebSocket + Yjs authorisation, account-deletion rules |
| `cd frontend && npx tsc -b` | Strict TypeScript across the app |
| `cd frontend && npm run build` | Production bundle (route-level code splitting; editor, CodeMirror, Mermaid and React Flow load on demand) |

## What works

**Accounts & security** — sign-up/in, scrypt-hashed passwords with strength rules, password reset, email verification, optional Google OAuth, revocable sessions (hashed tokens, per-device list), rate limits on auth and AI, profile, careful account deletion (blocked until owned shared workspaces are transferred).

**Workspaces & teams** — multiple workspaces, switching, invites by link with roles (Owner / Admin / Member / Viewer, enforced on every API route and socket), role changes, removal, ownership transfer, leave, live presence, activity feed, admin audit log.

**Projects** — create/edit/archive/restore/delete, deadlines, tags, project members, progress, activity tab. Kanban (Backlog → Done) with drag-and-drop, optimistic moves, filters by text/priority/assignee, board/list views, task drawer with assignee, due date, priority, description and threaded comments with @mentions. Realtime updates from teammates.

**Docs** — Tiptap editor with headings, lists, quotes, code blocks, tables, links, images, underline/strike, word count; **real-time co-editing over Yjs** with live carets and graceful local fallback; autosave plus explicit revisions (30 retained, restore); folders; comments with quotes, resolve/reopen and mentions; private sharing with collaborators; project linking.

**LaTeX** — CodeMirror editor with TeX highlighting, multiple documents, templates, autosave, real `pdflatex` compilation (shell escape off, isolated temp dir, timeout), live preview, clickable line-addressed errors, PDF download. Shows an honest “compiler unavailable” state when TeX isn’t installed.

**Code** — code projects, file/folder/ZIP upload, public GitHub import, tree browser, syntax highlighting with line numbers, full-text search with line jumps, file versions, copy/download, project ZIP download, sharing, one-click “Explain / Review with AI”, and static-site preview for projects containing `index.html` (served sandboxed on an opaque origin). Nothing uploaded is ever executed on the server.

**Drive** — streaming uploads with progress and drag-and-drop, folders and breadcrumbs, move, rename, delete, search, previews for images/PDF/audio/video/text via short-lived signed URLs, private sharing, storage quota and usage by type. Storage is local disk or Cloudflare R2 / any S3-compatible bucket (SigV4) — metadata stays in the store, binaries never do.

**Previews** — deployed URLs or Code static sites, desktop/laptop/tablet/mobile viewports with rotation, reload, descriptions, project association, sharing, and a server-side framing check (X-Frame-Options / CSP `frame-ancestors`, SSRF-guarded) so the UI says honestly when a site blocks embedding.

**Zynckle AI** — provider-independent (Groq default, Gemini, OpenRouter) with streaming. Assistant with persisted private conversations, modes (General, Explain code, Review code with severity labels, Debug, Database, Docs), context you choose (project, documents, code project/files — authorised server-side), model picker, stop/regenerate/copy/save-to-Documents, Markdown + highlighted code + Mermaid rendering. **Architecture designer**: 12 sections generated individually (regenerate any one without losing the rest), editable, Mermaid diagrams, interactive React Flow component graph, Markdown export and save to Documents. **Docs & planning workshop**: evidence-based documentation (README, SRS, API, deployment…) that cites sources and marks assumptions, database design, and a planner whose tasks are created only after review and confirmation.

**Signature features**
- **Quick Capture** — press `C` anywhere and type naturally: `Draft press release tomorrow !high @grace #atlas ~review`. Dates (`today`, `fri`, `in 3 days`, `next week`, `Nov 20`), priority (`!urgent` `!high` `!low`, `p1`–`p4`), assignee, project and column are parsed live into chips before the task is created. `Ctrl+Enter` adds and keeps the composer open.
- **The Daily Edition** (`/today`) — an editorial front page built from real data: lead story (the most pressing task), by-the-numbers, due today, running late, awaiting review, the week ahead and overnight teammate activity, with an optional AI editor’s note. Switch between “My desk” and the whole workspace.
- **Project timeline** — tasks laid on a day ruler from creation to due date with a today line, weekend shading and late highlighting.
- **Focus mode** for documents — all workspace chrome disappears, a serif reading measure takes over, `Esc` returns.
- **Keyboard layer** — `?` shows every shortcut; `G` then a letter jumps anywhere (`G Y` today, `G P` projects, `G T` tasks, `G O` documents, `G A` AI…); `/` searches.
- **Workspace pulse** — a 14-day activity rhythm line on the dashboard.

**Everywhere** — ⌘/Ctrl K command palette with global search, ⌘/Ctrl J assistant, live notification centre (assignments, mentions, comments, shares, invites, deadline reminders) with preferences, light/dark/system themes, responsive layouts down to phone width, keyboard focus states, reduced-motion support.

## Configuration

All settings are documented in `.env.example`. Notable ones: `AI_PROVIDER`, provider keys and models, `AI_REQUESTS_PER_MINUTE/DAY`, `MAX_UPLOAD_MB`, `WORKSPACE_QUOTA_MB`, `R2_*` for object storage, `GOOGLE_CLIENT_ID/SECRET`, `LATEX_COMPILER`, `ZYNCKLE_PUBLIC_URL`, `ZYNCKLE_SECRET`.

## Honest boundaries

- **Email delivery is not configured.** Invite, reset and verification links are written to the API log, and in development the reset/verification link is also shown in the UI (`ZYNCKLE_EXPOSE_DEV_LINKS=false` disables this; it is always off when `NODE_ENV=production`).
- **Persistence is a single JSON metadata file** with atomic, coalesced writes — suitable for a team on one server, not for horizontal scaling. The PostgreSQL schema (Flyway V1–V3 in `backend/src`) mirrors every collection, but the Spring Boot service is a foundation and is not wired to the UI.
- Sessions are opaque random tokens (stored hashed, revocable) rather than JWTs.
- AI features need a provider key; without one the UI says so and nothing is simulated.
- GitHub integration imports public repositories; private repos and two-way sync would need a GitHub App.
- Embedded previews depend on each site’s framing policy; “Open externally” is always available.
- Run the API behind HTTPS (reverse proxy) before exposing it beyond a trusted network.
