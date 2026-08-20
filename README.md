# OmniShell

A self-hosted SSH operations hub: **files, systemd services, terminal, bookmarks, and GIA** (an approve-gated AI sysadmin) in the browser.

Think VS Code’s explorer + `systemctl` + a shell + an assistant that cannot touch the server until you click **Approve**.

**Full guide (same as in-app GIA Core):** [docs/user-manual.md](docs/user-manual.md)

## What it can do

- **Files** — browse, edit (Monaco), upload/download (up to 1GB), search, bookmarks, chmod, cross-folder clipboard
- **Services** — systemd list, bulk start/stop/restart, watched dashboard + health score, live memory, live `journalctl`, call_id log search
- **Terminal** — xterm.js SSH sessions, multiple tabs per connection
- **GIA** — 9 tools (read + mutate). Every remote call needs **Approve**. Needs `GOOGLE_API_KEY`.
- **Ops** — multi-VM tabs, command palette (`⌘⇧P`), SSH config import, dark/light theme

## Features

- **File Explorer** — Browse remote directories in grid or list view, with sorting, breadcrumb navigation, and hidden file toggles
- **Code Editor** — Monaco editor (same engine as VS Code) with multi-tab editing, syntax highlighting, and Ctrl+S save to remote
- **Web Terminal** — Full SSH shell via xterm.js, with auto-resize, clickable links, and multiple sessions per connection
- **File Transfer** — Drag-and-drop upload (up to 1GB) with progress tracking, streaming downloads
- **Search** — Filename search (via `find`) and content search (via `grep`) across remote filesystems
- **Bookmarks** — Save favorite paths per connection for quick navigation
- **Multi-Connection Tabs** — Connect to multiple VMs simultaneously, each with independent state
- **File Previews** — Inline preview for images, PDF, markdown, video, audio, and syntax-highlighted text
- **System Vitals** — On-demand RAM, disk, CPU load, and uptime stats in the status bar — click to expand full details with per-partition disk usage
- **Service Manager** — Real-time systemd service list with bulk select (start/stop/restart/clear), live memory sparklines, watched service dashboard with drag-reorder, and health score (state × 50 + memory × 30 + uptime × 20)
- **Log Search by call_id** — 3-phase search: grep for `"Start webhook sent for"` → get timestamp, grep `"End webhook sent for"` → get timestamp, `--since @X --until @Y` to fetch full range including multi-line payloads. Extend window with direction (Before start / After end) and seconds presets + custom input
- **Live Logs** — Streaming `journalctl -f` with configurable history depth (Default/500/1000/2000/5000 lines), inline "Analyze" AI button sending last 150 lines to Gemini, client-side filtering
- **GIA (AI Agent)** — Chat interface with 9 function-calling tools (4 mutating + 5 read-only), conversation export as Markdown, per-message copy/regenerate, token estimation, and auto-context from active service details
- **Command Palette** — `⌘⇧P` spotlight-style launcher with 6 categories: navigation, GIA, connections, bookmarks, actions, appearance
- **SSH Config Import** — One-click import from `~/.ssh/config` with key validation and duplicate detection
- **Reverse Proxy Support** — Deploy behind nginx/Traefik at any subpath via `BASE_PATH` env var
- **Dark/Light Theme** — Toggle between themes with one click
- **Keyboard Shortcuts** — `Cmd+K` for search, `Cmd+Shift+K` for terminal, `Cmd+Shift+S` for services, `Cmd+Shift+P` for command palette, `Cmd+J` for GIA

## Architecture & Performance

The codebase has been architected for zero memory leaks, minimal resource waste, and smooth performance under load:

- **SFTP Session Pooling** — A single SFTP channel is reused across all file operations per connection (with ref counting and deduplication), instead of creating/destroying one per request
- **Streaming Uploads** — Files up to 1GB are streamed directly from the browser to the remote server via `@fastify/busboy`, piped through SFTP in 64KB chunks with backpressure handling — never buffered in server memory. Failed uploads automatically clean up partial files on the remote
- **SFTP Acquisition Timeout** — 10-second timeout on SFTP channel handshake prevents hanging connections (data operations run uninterrupted)
- **Virtual Scrolling** — File explorer uses `@tanstack/react-virtual` for both grid and list views, rendering only visible rows even in directories with thousands of files
- **Editor Memory Optimization** — File contents are managed by Monaco models and a lightweight module-level cache, kept out of Zustand to avoid serialization overhead
- **Immer-powered State** — Explorer store uses Zustand + Immer with `enableMapSet()` for structural sharing, eliminating full Map clones on every navigation
- **Cross-store Cleanup** — Disconnecting a connection cleans all 5 stores (connections, explorer, editor, terminal, uploads) via a centralized utility
- **Debounced Terminal Resize** — ResizeObserver throttled at 100ms to prevent resize message floods
- **Transfer Leak Prevention** — Active transfer state is TTL-gated (30 min) and cleaned on WebSocket disconnect
- **Upload GC** — File blob references are nulled after upload completion so the browser can garbage-collect them
- **Bounded History** — Navigation history capped at 200 entries to prevent unbounded growth
- **Safe Shell Commands** — Search paths are properly quoted to prevent issues with spaces/special characters
- **Stable Session IDs** — Terminal sessions use `crypto.randomUUID()` for collision-free identifiers

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router, webpack) |
| **Frontend** | React 19, TypeScript 5, Tailwind CSS 4 |
| **UI Components** | shadcn/ui (Radix primitives), Lucide icons |
| **Editor** | Monaco Editor (`@monaco-editor/react`) |
| **Terminal** | xterm.js v6 with fit, web-links, and search addons |
| **State Management** | Zustand + Immer (client state), TanStack React Query (server state) |
| **Virtual Scrolling** | `@tanstack/react-virtual` |
| **SSH/SFTP** | `ssh2` (pure JS, no native dependencies) — exec queue (max 8 concurrent per connection) |
| **WebSocket** | `ws` for terminal I/O, transfer progress, service monitoring, and log streaming |
| **Database** | SQLite via `better-sqlite3` + Drizzle ORM |
| **Validation** | Zod schemas on all API endpoints |
| **Drag & Drop** | `@dnd-kit` (in-browser), `react-dropzone` (OS uploads) |
| **Upload Streaming** | `@fastify/busboy` (multipart parsing without buffering) |
| **AI** | Gemini API via Google Generative AI SDK (9 function-calling tools) |

## How It Works

```
Browser ──HTTP──> Custom Node.js Server ──> Next.js (pages + API routes)
       ──WS───> WebSocket Server ──────> SSH shell channels (terminal)
                                  ──────> SFTP operations (file transfer)
                                  ──────> journalctl -f streams (live logs)
                                  ──────> Monitor push (service memory, batch)
```
The custom server (`server/index.ts`) wraps Next.js to add WebSocket support — something Next.js doesn't natively provide. All file operations go through REST API routes that call SFTP operations on the server. Service management uses REST for CRUD + WS for real-time monitoring and log streaming.

SSH connections are pooled server-side with a 30-minute idle timeout. Exec calls are queued (max 8 concurrent per connection) to prevent `Channel open failure` from hitting the server's `MaxSessions` limit. SSH keys never leave the server; only the filesystem path is stored in the database.

### Project Structure

```
server/
├── index.ts                 # HTTP + WebSocket server entry point
├── ws/                      # WebSocket handlers (terminal, transfer, monitor, logs)
└── ssh/
    ├── connection-pool.ts   # SSH connection pool with idle timeout
    ├── sftp-pool.ts         # SFTP session pool with ref counting & dedup
    ├── sftp-operations.ts   # All SFTP file operations (list, read, write, etc.)
    ├── exec.ts              # Generic SSH command executor + semaphore (max 8)
    ├── services.ts          # systemd service management + log search + streaming
    ├── vitals.ts            # System stats parser (RAM, disk, CPU, uptime)
    ├── key-manager.ts       # SSH key validation & loading
    └── config-parser.ts     # ~/.ssh/config parser for bulk import

src/
├── app/                     # Next.js pages + 30+ API routes
│   └── api/                 # REST: /connections, /fs/[connId]/*, /bookmarks, /ai, /auth
├── components/
│   ├── layout/              # Sidebar, app-shell, status-bar, connection-tabs, vitals-popover, notification-bridge, user-manual
│   ├── services/            # ServicesPanel, ServiceDetailView, ServiceMonitor, WatchedDashboard, LiveLogViewer, ServiceBuilderDialog
│   ├── ai/                  # AIPanel, ContextBridge, WriteFileDialog, StructuredMessage
│   ├── explorer/            # FileExplorer, FileGrid, BreadcrumbNav, Toolbar, PasteDialog, NewItemDialog, RenameDialog
│   ├── editor/              # CodeEditor
│   ├── terminal/            # TerminalPanel, TerminalInstance
│   ├── command-palette.tsx  # Spotlight-style global launcher (⌘⇧P)
│   ├── search/              # SearchDialog
│   ├── connections/         # ConnectionForm, SshImportDialog
│   ├── dialogs/             # ChmodDialog
│   ├── brand/               # GiaMark, GiaWordmark
│   └── diff/                # FileDiff
├── stores/                  # Zustand + Immer: connection, explorer, editor, terminal, upload, ui, watch, ai, notification, search-presets
└── lib/
    ├── api-client.ts        # REST + WS client + AI SSE parser
    ├── ws-client.ts         # WebSocket singleton with reconnect
    ├── disconnect.ts        # Centralized cross-store cleanup on disconnect
    ├── ensure-connection.ts # Auto-connect helper for GIA / service workflows
    ├── systemd-unit.ts      # Voice-agent unit file parser & builder
    ├── search-logs-diagnosis.ts # Log extraction & analysis formatting
    ├── editor-content.ts    # Editor original-content cache
    ├── gia-tools.tsx        # Voice tool name sync & badge coloring
    ├── constants.ts         # File size limits, preview types, timeouts
    └── db/                  # Drizzle ORM schema & migrations

db/                          # SQLite database file (auto-created)
```

## Prerequisites

- **Node.js** 18+ (tested with v20 and v24)
- **npm** 9+
- **SSH key** configured for the remote server(s) you want to manage

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url> omnishell
cd omnishell
npm install
```

### 2. Configure `.env`

Copy the template. **Do not use `.env.local`** — the app reads `.env` only.

```bash
cp .env.example .env
```

| Variable | Required | How to get it | What it’s for |
|----------|----------|---------------|---------------|
| `AUTH_TOKEN` | Yes | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Login token. Paste it on [http://localhost:3000/login](http://localhost:3000/login). Treat like a password. |
| `ENCRYPTION_KEY` | Yes | `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` | AES-256 for SSH passphrases in SQLite. **Never rotate** after you save connections. |
| `GOOGLE_API_KEY` | No | Create a Gemini key at [Google AI Studio](https://aistudio.google.com/apikey) | GIA chat + log **Analyze**. Skip if you don’t need AI. |

Put the generated values in `.env` (no quotes). Restart the server after any change.

`.env.example` is the blank template we commit. `.env` is your secrets (gitignored). That is the only pair you need.

### 3. Initialize the database

```bash
npm run db:push
```

### 4. Start the server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the `AUTH_TOKEN` you set.

### 5. Add connections

### 5. Add an SSH connection

Saved connections are **not** in the source tree. They live in local SQLite (`db/omnishell.db`, gitignored). OmniShell stores the **path** to your private key, not the key file. Passphrases (if any) are AES-encrypted in that DB. The `keys/` folder in the repo is empty on purpose.

**What you need (and where to get it)**

| Need | Where it comes from |
|------|---------------------|
| **SSH private key** on *this Mac* | Usually `~/.ssh/id_ed25519` or `~/.ssh/id_rsa`. Create one with `ssh-keygen -t ed25519 -C "you@example.com"`. Put the **public** half (`*.pub`) on the server (`~/.ssh/authorized_keys`, or your cloud “SSH keys” UI). |
| **Host** | The VM’s IP or DNS from AWS / GCP / your provider. Test with `ssh user@host` in Terminal first. |
| **Port** | `22` unless the server uses another port (`ssh -p`). |
| **Username** | The Linux user you SSH as (`root`, `ubuntu`, `ec2-user`, …). Same as in `ssh ubuntu@host`. |
| **Passphrase** | Only if you set one when running `ssh-keygen`. Leave blank if the key file is not encrypted. |
| **Default path** | First folder to open (often `/` or `/home/ubuntu`). |

If `ssh user@host` already works, the easiest import is **Option A**.

**Option A: Import from SSH config** — Click the download icon in the sidebar’s Connections header. OmniShell reads `~/.ssh/config`, checks that each `IdentityFile` exists, skips duplicates, and lets you pick hosts.

**Option B: Add manually** — Click **+** in the sidebar (or Command Palette → New connection):

| Field | Description |
|-------|-------------|
| **Name** | Label in the UI (e.g. “Prod voice-agent”) |
| **Host** | IP or hostname |
| **Port** | SSH port (default: `22`) |
| **Username** | SSH user (e.g. `root`) |
| **Private Key Path** | Absolute path on *this* machine, e.g. `/Users/you/.ssh/id_ed25519` |
| **Passphrase** | Leave blank if the key is not encrypted |
| **Default Path** | Starting directory on connect (default: `/`) |

Click **Test** before **Create** if you want a handshake check.

> **Encrypted key?** If you see “Encrypted private OpenSSH key detected, but no passphrase given”, enter the passphrase in the form, or strip it:
> ```bash
> ssh-keygen -p -f ~/.ssh/your_key
> # old passphrase, then Enter twice for none
> ```

## Production

```bash
npm run build
npm start
```

The server runs on port 3000 by default. Override with environment variables:

```bash
PORT=8080 HOSTNAME=0.0.0.0 npm start
```

### Reverse Proxy (Subpath)

To serve the app at a subpath (e.g., `https://internal.company.com/files`):

```bash
BASE_PATH=/files npm run build
BASE_PATH=/files npm start
```

Nginx example:

```nginx
location /files/ {
    proxy_pass http://localhost:3000/files/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

All routes, API calls, and WebSocket connections automatically respect the base path.

## Environment Variables

Set these in `.env` at the project root (gitignored). Start from `.env.example`. How to obtain each key is in [Quick Start §2](#2-configure-env) and [GIA Core](docs/user-manual.md).

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_TOKEN` | Yes | Token for web UI authentication |
| `ENCRYPTION_KEY` | Yes | AES-256 key for passphrase encryption at rest |
| `GOOGLE_API_KEY` | No | Google Gemini API key for GIA AI Copilot & inline log analysis |
| `PORT` | No | Server port (default: `3000`) |
| `HOSTNAME` | No | Bind address (default: `localhost`) |
| `BASE_PATH` | No | Subpath for reverse proxy deployment (e.g., `/files`) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Run production server |
| `npm run db:push` | Create/update database tables |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |
| `npm run lint` | Run ESLint |

## Security

- **Nothing sensitive is in the source.** Hosts, usernames, and key *paths* live in `db/omnishell.db` (gitignored). Private key *files* stay wherever you pointed (usually `~/.ssh/`). `.env` is gitignored. `keys/` in the repo is empty (`.gitkeep` only).
- **Do not copy** `db/*.db` or `.env` into a public repo or a zip you share.
- **SSH keys stay on this machine** — the browser never receives key material
- **Passphrase encryption** — AES-256-GCM at rest using `ENCRYPTION_KEY` (the key file itself is not copied into the DB)
- **Path traversal protection** — all remote paths resolved with `path.posix.resolve()` and validated server-side
- **Input validation** — Zod schemas on every API endpoint
- **Auth** — token-based with HTTP-only SameSite=Strict cookie
- **Connection isolation** — each SSH connection is a separate `ssh2.Client` instance

## License

MIT
