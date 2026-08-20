# OmniShell & GIA System User Manual

Welcome to **OmniShell**, a premium, self-hosted SSH operations hub that provides a powerful desktop-like experience for managing remote servers over SSH and SFTP. From browsing directories and editing code inline to running terminal shells, monitoring system resources, and leveraging an integrated AI assistant (GIA), this manual covers everything you need to know.

> **TL;DR — What is GIA?** GIA = *Garageplug Intelligence Assistant*. It's the floating ✨ violet button in the bottom-right corner. Click it (or press **⌘J**) to open a chat panel that can read files, run shell commands, manage systemd services, and explore your servers — all under your explicit approval. The GIA Core (this manual) is opened from the **GIA Core** pill at the bottom of the sidebar.

---

## 1. Prerequisites & Getting Started

### Run OmniShell
1. **Node.js** 18+ and **npm** 9+.
2. Copy the template and fill secrets: `cp .env.example .env` (use **`.env` only** — not `.env.local`).
3. `npm install && npm run db:push && npm run dev`
4. Open [http://localhost:3000](http://localhost:3000) and paste `AUTH_TOKEN` on the login screen.
5. Add a server: sidebar **+** or import `~/.ssh/config`. You need an SSH private key on *this* machine.

### How to get the keys

| Variable | Required | How to get it | How OmniShell uses it |
|---|---|---|---|
| `AUTH_TOKEN` | Yes | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Web login. Paste the same value on `/login`. Treat it like a password. |
| `ENCRYPTION_KEY` | Yes | `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` | AES-256 for SSH key passphrases stored in SQLite. **Do not change it** after you have saved connections — old passphrases will not decrypt. |
| `GOOGLE_API_KEY` | No | Create a Gemini key in [Google AI Studio](https://aistudio.google.com/apikey). Free tier is enough for GIA. | Powers GIA chat and **Analyze** on live logs. Without it, files/services/terminal still work; GIA returns a config error. |

Restart `npm run dev` after any `.env` change.

`.env.example` is the committed blank template. `.env` is your real secrets (gitignored). You do **not** need `.env.local`.

---

## 2. Command Palette (the fastest way to do anything)

Press **⌘⇧P** (mac) or **Ctrl+Shift+P** (Win/Linux) anywhere in the app to open the **Command Palette** — a Spotlight-style launcher that finds any action in two keystrokes. You can also press **⌘/** to open it.

The palette groups commands by category:

* **Navigation** — jump to Explorer (⌘⇧E), Service Manager (⌘⇧S), toggle the Sidebar, toggle the Terminal (⌘⇧K), or open this manual.
* **GIA Assistant** — open GIA (⌘J), or one-click send common prompts like "Diagnose current service", "Investigate memory", "Find call_id in logs", or "List running services".
* **Connections** — add a new connection, import from `~/.ssh/config`, or **connect to any saved server** (the palette auto-detects all your saved servers and lets you connect with a single click).
* **Bookmarks** — every saved bookmark appears here. Type to filter, hit Enter to jump (it'll auto-connect if needed).
* **Actions** — refresh, search files, new file, new folder, upload, **New agent service** / **Service file builder** (opens the systemd unit wizard).
* **Appearance** — toggle dark/light theme.

**Tip:** Every command shows its keyboard shortcut on the right. The palette is fuzzy-matched — start typing "diag" and you'll see "Diagnose current service" appear.

---

## 3. Connection Management

Saved servers are **local only** — SQLite `db/omnishell.db` (not in git). OmniShell stores a **path** to your private key, never the key bytes. Passphrases are AES-encrypted in that DB.

### What you need (where to get it)

| Need | Where it comes from |
|---|---|
| **Private key** | On this Mac: `~/.ssh/id_ed25519` or `id_rsa`. Create with `ssh-keygen -t ed25519`. Install the matching `.pub` on the VM (`authorized_keys` or cloud SSH-keys UI). |
| **Host** | VM IP / DNS from your cloud console. Confirm with `ssh user@host` in Terminal first. |
| **Port** | `22` unless you use a custom SSH port. |
| **Username** | Same user as `ssh` (`root`, `ubuntu`, `ec2-user`, …). |
| **Passphrase** | Only if `ssh-keygen` asked for one. Otherwise leave blank. |
| **Default path** | First remote folder (`/` or `/home/ubuntu`). |

If Terminal `ssh` already works, use **Import**.

* **Add Connection Manually**: Click **+** in the sidebar. Fill Name, Host, Port (default 22), Username, Private Key Path (absolute, e.g. `/Users/you/.ssh/id_ed25519`), Passphrase (if encrypted), Default Path (`/`). Use **Test** then **Create**.
* **Import from SSH Config**: Click the download/import icon in the Connections header. Parses `~/.ssh/config`, validates `IdentityFile` paths, skips duplicates, import the hosts you tick.
* **Multi-Connection Tabs**: Connect to multiple VMs simultaneously. The top header displays connection tabs. You can switch between active connections; each tab maintains its own independent state (file explorer path, terminal sessions, code editor tabs, etc.).
* **Connection Status Indicator**: Status badges next to connection names feature styled status dots with live glow animations:
  * 🟢 **Green (Glow)**: Connected
  * 🟡 **Yellow (Glow)**: Connecting/Reconnecting
  * 🔴 **Red (Glow)**: Connection Error/Disconnected
* **One-click Connect from the Palette**: Open the Command Palette (**⌘⇧P**) and type a server name — Enter to connect. If you're not on any tab, GIA will also auto-connect to the first available server when you call any tool that needs a connection.
* **Services Button Active State**: The Services icon in the sidebar Connections header lights up violet when you're in the Service Manager view — a quick visual cue for which mode you're in.

---

## 4. File Explorer & Remote Directory Management

The main view offers an efficient directory browser optimized with virtual scrolling to render directories with thousands of items seamlessly without lag.

* **Grid & List Views**: Switch between Grid and List layouts to review folder hierarchies.
* **Breadcrumb Navigation**: Use the breadcrumb bar at the top of the explorer to jump back to any parent folder quickly.
* **Hidden Files Toggle**: Click the hidden files action button to show or hide files starting with a dot (`.`).
* **File Transfers (Upload / Download)**:
  * **Upload**: Drag and drop files from your desktop directly into the browser window (supports files up to 1GB). File data is streamed directly to the remote server using backpressure-safe SFTP chunks to prevent server memory bloat. You can also **drop entire folders** (the folder structure is preserved).
  * **Upload Status Panel**: The upload counter badge in the status bar is **clickable** — click it to reveal a docked panel showing all uploads with progress, status, and per-item dismiss. The badge lights up violet when the panel is open.
  * **Download**: Right-click or use the action menu on any file to stream-download it to your local machine.
* **Folder Clipboard (Copy/Cut/Paste)**: Copy or Cut files and folders across directories (or even across different remote connections) and paste them via the **Cross-folder Clipboard Paste Dialog**.
* **Global Remote Search**: Click the Search button, press `Cmd+K` / `Ctrl+K`, or run **"Search files"** from the Command Palette. If a directory is selected, search starts there; otherwise, it defaults to server-wide directories (e.g. `/opt/livekit-agents` or `/opt/agents` if configured, or `/`). Search supports wildcard file name searching (`find`) and content searching (`grep`).
* **Permissions (chmod)**: Right-click any file or folder and choose **Permissions** to change mode using a built-in dialog. Supports both octal (755, 644) and symbolic (u+x, g-w) syntax. Applies to multiple selected paths in one go.
* **Virtualized Lists**: Both grid and list views are virtualized via TanStack Virtual — directories with 10,000+ entries scroll smoothly without lag.
* **Keyboard Navigation**: In the file grid, use **↑/↓** to move focus, **Enter** to open, **F2** to rename inline, **Esc** to deselect, **Cmd+Click** to multi-select.

---

## 5. Monaco Code Editor

A complete code editing experience powered by the same engine that runs VS Code.

* **Multi-Tab File Editing**: Click on any text file to open it in a tab. Open multiple files side-by-side. The editor keeps track of current edits, active tabs, and cursors.
* **Drag-to-Resize Split**: Drag the `GripVertical` handle between the Explorer and Editor panels to resize them. The ratio persists across sessions via localStorage. Drag the editor below 8% to collapse it; click the collapsed handle to restore.
* **Monaco Features**: Syntax highlighting (auto-detected by file extension), auto-completions, search & replace, folding, and multi-cursor editing.
* **Remote Save**: Press `Cmd+S` (or `Ctrl+S` on Windows/Linux) to save changes. Your changes are sent via an SFTP stream to overwrite the file on the remote server instantly.
* **File Previews**: High-performance previews are supported directly for:
  * Images (rendered inline).
  * PDF files.
  * Markdown documents (rendered as styled HTML).
  * Video and Audio files (native player).
* **AI-Assisted Edits**: With a file open, GIA's context automatically includes the file path and content. Ask GIA "fix the bug in this file" or "refactor this function" and it'll propose a `write_file` action — you'll see a **diff preview** before any change is applied.

---

## 6. Interactive Web Terminal

A full-featured web terminal powered by `xterm.js`, connecting directly to your remote SSH shell over WebSockets.

* **Open Terminal**: 
  * Press **`Cmd + Shift + K`** (or **`Ctrl + Shift + K`**).
  * Or click the **Terminal Icon** in the top header bar (it turns emerald green when active).
* **Multi-Session Support**: Spawn multiple terminal instances for a single connection.
* **Live Terminal Theme Picker**: Under the **Palette (Theme)** icon in the terminal panel, choose between 5 pre-configured dark themes in real-time:
  * **Default Dark**
  * **Monokai**
  * **Solarized Dark**
  * **Dracula**
  * **Nord**
* **Auto-Resize**: Resizes dynamically as you resize your browser window or drag the sidebar handler. The terminal resize calculations are throttled at 100ms to avoid network spam.
* **Heartbeat & Reconnection**: Standard ping/pong events run every 30s over WebSockets to maintain connectivity through gateways, with an automatic reconnect strategy.

---

## 7. System Vitals & Server Metrics

The status bar at the bottom displays real-time vitals for the active remote connection.

* **Real-time Metrics**: Displays CPU load, RAM usage percentage, Disk capacity, and system Uptime.
* **Monospace Timer**: Includes a ticking connection timer with a Clock icon showing how long you have been connected.
* **Vitals Popover**: Click on any metric in the status bar to expand a detailed popover displaying:
  * RAM breakdown (total vs. used vs. free).
  * CPU core utilization.
  * Complete storage list showing all partitions, mount points, file system types, and percentage usage.

---

## 8. Advanced Systemd Service Management

Manage and monitor remote systemd services directly from the dashboard. Click the **Services** pill in the connection tab header (between the sidebar toggle and connection tabs) or press `Cmd+Shift+S` to switch to the services panel. Click **Explorer** to switch back.

* **Auto-Connect**: Accessing the services view will automatically trigger a connection to your first active SSH connection if none is currently active.
* **Quick Status Bar**: A footer below the filter shows live counts of **active**, **failed**, and **other** services so you know the health of the system at a glance.
* **Bulk Selection & Actions**: Tick the checkboxes next to services (or use the **Select All** button) to start, restart, or stop **multiple services in one go**. The bulk action bar appears at the top of the list and reports per-service success/failure.
* **Control Actions**: Start, Stop, and Restart services via the header action bar or list items.
* **Pin / Watch Services**: Click the Pin/Watch icon on any service to add it to the **Watched Dashboard** in the sidebar. This keeps high-priority services pinned to your dashboard.
* **Watched Health Score**: Each pinned service now displays a **0-100 health score** (color-coded emerald/amber/orange/red) that combines:
  * Current state (active = 50 pts, failed = 0 pts)
  * Memory usage (under 100MB = 30 pts, scaling down to 0 at 1GB+)
  * Recent uptime (% of last 15 polls that were active × 20 pts)
  Hover any score to see the breakdown.
* **Drag-to-Reorder**: Inside the Watched Dashboard, grab the handle on the left of any service to drag it into a new position. Order is persisted to localStorage.
* **Batch Status Polling**: Status updates for pinned services are queried in a single batch REST query (`?names=svc1,svc2...`), drastically reducing SSH channel consumption and remote CPU usage compared to individual service polls.
* **Uptime Micro-History Timeline**: Pinned services display a mini history bar consisting of 15 status indicators representing the latest states:
  * 🟩 **Emerald Grid**: Service was running / active.
  * 🟥 **Red Grid**: Service failed / crashed.
  * ⬜ **Gray Grid**: Service was inactive / unknown.
* **Live Memory Monitor & Sparkline**: Toggle the monitoring switch on a service detail page to poll live memory usage. It renders a clean, animated SVG-based sparkline with gradient styling and displays key metrics (Min, Max, and Avg Memory consumed).
* **Background tab suspend**: When this browser tab is hidden, live memory monitors and `journalctl -f` streams pause automatically (less load on the VM). They resume with the same settings when you return — watched cards, log buffer, and sparkline stay intact.
* **Open directory / Open profile** (Service File card on the detail page):
  * **Open directory** — reads `WorkingDirectory=` from the loaded unit and navigates the File Explorer there (switches to Explorer view). Disabled if the unit has no WorkingDirectory.
  * **Open profile** — dropdown of paths parsed from `Environment=` / `EnvironmentFile=` (e.g. `AGENT_CONFIG_PATH`, profile `.env`, prompt files). Pick one to open it in the Monaco editor. Paths are never invented — if nothing is in the unit, you'll see a toast to add those directives.
* **Live Logs**:
  * Displays a real-time `journalctl -f` tail of the service logs with auto-scroll.
  * **Filter input**: Type to filter visible lines locally on-the-fly — narrows down the stream without restarting it.
  * **Timeline Context Search** (by `call_id`): Paste a `call_id` (or other unique token) into the search input. The backend **greps the journal for that call_id first**, then takes Start/End webhook timestamps from those hits and fetches the full window with `--since` / `--until` (plus optional padding). This captures multi-line payloads. **Do not rely on Start/End alone** — grepping Start/End without the call_id returns the latest call on the host, not yours.
  * **Extend Window**: Click the **Timer** button beside the filter input to expand or shrink the search window. Choose **Before start** / **After end** direction, presets (5/10/30/60 seconds), or type a custom value (use negative numbers to subtract). Pads are clamped to 0.
  * **Live Log History**: Click the **History** button to switch between line-count presets (Default/500/1000/2000/5000 + custom). Changing the depth restarts the `journalctl -f -n N` stream immediately.
  * **AI "Analyze" button**: Sends the last 150 log lines to Gemini and renders the diagnosis in a collapsible markdown panel with syntax-highlighted code blocks and one-click copy.

---

## 8b. Service File Builder

Create a voice-agent systemd unit without hand-writing the file. Writes to `/etc/systemd/system/<name>.service` over the active SSH connection (**root SSH is assumed** for that path).

**How to open:**
* Services header → **New service**
* Command Palette (**⌘⇧P**) → **New agent service** or **Service file builder**

**Wizard fields:**
* **Connection** — which server gets the unit
* **Service name** — without `.service` suffix (written as `name.service`)
* **SyslogIdentifier**, **Description**
* **WorkingDirectory** — plus **Discover profiles** to scan the remote tree for configs/profiles
* **AGENT_CONFIG_PATH** / **CLIENT_PROFILE** (optional) / **EnvironmentFile**
* **User** (defaults to `root`), **Restart**, **ExecStart**
* **Preview** — live unit text before write
* Toggles: **daemon-reload after write**, **enable**, **start**

Click **Write unit**. If the file already exists you get an overwrite confirm. After write, optional enable/start runs through the same service APIs as the Service Manager.

---

## 9. GIA — The AI Copilot (Next Level)

GIA is your conversational AI assistant powered by Google Gemini. It has **9 tools** for managing your servers, files, and services. Open GIA via the **✨ floating button** in the bottom-right corner, or press **⌘J** / **Ctrl+J**.

**Security model:** Every remote action requires **Approve** — including read-only tools (`list_services`, `list_directory`, `search_files`, `read_file`, `search_service_logs`) and mutations (`service_action`, `daemon_reload`, `run_command`, `write_file`). Nothing runs on the server until you click Approve. `.env` / `~/.ssh` paths stay blocked.

### 9.1 Header Power-Ups
The GIA panel header now shows several utility buttons:
* **＋ New chat** — start a fresh conversation without deleting the old one (chats stay in your browser only).
* **💬 Chat switcher** — jump between recent chats (title from the first message); delete a chat from the menu.
* **🔄 Regenerate** — re-send the last user prompt to get a new response (handy when the first answer isn't right).
* **⬇️ Export .md** — download the entire conversation as a Markdown file (timestamped, ready to share).
* **🗑 Clear** — wipe messages in the *current* chat only.
* **× Close (Esc)** — close the panel.

The header also shows a **message count + estimated token usage** (e.g. `12 msg · ~4.2k tok`) and a **🔧 tool count** when GIA has called any tools.

**Load note:** Chat history lives in your browser `localStorage`. Opening a new chat uses **no** remote VM CPU/memory. VM load only happens when you **Approve** a tool (SSH) or when Service Manager is already polling/streaming.

### 9.2 Auto-Context Seeding
Opening a service detail page, opening a file tab, or running a terminal automatically seeds GIA's context with the active service name, connection details, last 100 log lines, and current directory. You can see the active context as badges at the top of the chat (📄 file, ⚙️ service, 🖥 terminal, 📜 logs).

### 9.3 Voice Dictation
Click the **Microphone** icon at the bottom of the GIA panel. The button will pulse red, transcribing your speech into the chat input in real-time. Powered by the Web Speech API (Chrome/Edge).

### 9.4 The 9 Tools
When GIA wants to do something, it shows an **approval card**. You click **Approve** to let it run, or **Reject** to cancel. **Every tool** requires approval — including read-only exploration (`list_services`, `list_directory`, `search_files`, `read_file`, `search_service_logs`) and mutations (`service_action`, `daemon_reload`, `run_command`, `write_file`). Cards show a **Read-only** (sky) or **Mutating** (amber) badge so you can tell at a glance — nothing auto-runs. If multiple tools are queued, the card shows **"N pending · 1 of N"** and the Approve button notes how many remain. For reload+restart, expect: Approve daemon-reload → Approve restart → GIA summarizes.

1. **`service_action(action, serviceNames[], connectionId)`** — start, stop, restart, enable (auto-start on boot), or disable one or many services.
2. **`read_file(path, connectionId)`** — read any text file (except `.env`/credentials).
3. **`write_file(path, content, connectionId)`** — open a diff preview before applying any change. NEVER writes to `.env` or `~/.ssh/`.
4. **`daemon_reload(connectionId)`** — `systemctl daemon-reload` after a unit file change.
5. **`run_command(command, connectionId)`** — run any shell command (60s timeout). Prefer read-only diagnostics.
6. **`list_directory(path, connectionId)`** — list directory contents (read-only exploration).
7. **`search_files(pattern, path, connectionId)`** — find files by glob pattern (e.g. `*.conf`) — faster than reading a dir and filtering.
8. **`list_services(connectionId)`** — enumerate all systemd services with their state. GIA uses this to discover what's running before deciding to act.
9. **`search_service_logs(serviceName, query, connectionId)`** — journal search by call_id → Start/End window. GIA gets a diagnosis extract (errors/tools); **GIA summarizes/diagnoses in chat — full logs live in Service Manager → Search logs** (not dumped into the chat).

### 9.4.1 How GIA interprets agent cohorts
Voice-agent phrasing is resolved against **Watched Services** first, then `list_services` if needed:

| You say | GIA resolves |
|---|---|
| **H&G / HG / Hoops & Gears agents** | Agent units whose names look like H&G shops (`hg`, `hoops`, `gears`, `gia_hg`, etc.) |
| **prod agents** | Agent units on the Livekit **prod** (or similarly named) connection |
| **all agents** | Watched inbound/agent pins when present; else `*agent*` / `*-inbound-agent*` on the target host (never every systemd unit) |
| **that / this / current service** | Active service context in GIA; else the sole watched pin; else GIA asks once |

**daemon-reload + restart**: one `daemon_reload`, then one `service_action(restart, [resolved names])`. Approve each card in order — GIA proposes clearly; you click Approve.

**Empty watched list:** If you say "restart H&G agents" with no pins, approve `list_services` first so GIA can discover and filter names, then approve the restart.

### 9.4.2 Empty replies & Result bar
After tools, GIA must reply with **Result** (✅/❌) + **STEPS TAKEN**. If the model returns no text, the UI injects that summary (and a toast on a fully blank reply) so you never get an empty bubble. Tap **Regenerate** if the summary is incomplete.

### 9.4.3 Best practices
* Pin the agents you care about on the Watched Dashboard — GIA resolves cohorts faster from pins.
* For call_id investigations, prefer GIA's `search_service_logs` (Approve the card) or **Search logs** on the service detail page. GIA answers with a diagnosis (tool names, status codes, key events) — it does **not** dump raw logs into chat; open Service Manager → Search logs for the full window.
* Diagnose / Investigate memory prompts seed context and ask for root cause — they do **not** auto-restart.
* One Approve per remote step is intentional: you stay in control of explore, reload, restart, shell, and write.

### 9.5 Auto-Connect Magic
GIA can connect to a server for you if you ask it to do something on a connection that isn't active yet. Watch for the **🔌 Connecting...** lines in the chat.

### 9.6 AI Service Diagnosis
If a watched service enters a `failed` state, a glowing purple **Diagnose** button appears on the Watched Dashboard. Click it to automatically open GIA, seed logs + system status, and run a root-cause diagnosis.

### 9.7 Premium Code Blocks
Markdown code results rendered by GIA feature:
* Language indicators (e.g. `python`, `ini`, `bash`)
* Quick-copy buttons (one click)
* Diff coloring (green for `+`, red for `-`, blue for `@@` hunks)
* Path headers (```path=/etc/systemd/system/foo.service```) so you know which file a block refers to

### 9.8 Multi-line Paste Magic
Pasting more than 60 characters with newlines into the input automatically wraps them in ``` fenced code blocks — perfect for asking "what does this error mean?" about a stack trace.

### 9.9 Smart Suggestions
On the empty state, suggested prompts include Explain file, Analyze logs, Diagnose service, **Investigate memory**, **Restart H&G agents**, **Find call_id in logs**, List services, and Find configs. Click any to send it. Command Palette (⌘⇧P) also has **Investigate memory** and **Find call_id in logs**.

---

## 10. Keyboard Shortcuts Reference

Interact with the manager quickly using global hotkeys:

| Shortcut | Action | Description |
|---|---|---|
| **`Cmd + K`** (or `Ctrl + K`) | **Global Search** | Opens the file and folder search dialog. |
| **`Cmd + Shift + K`** (or `Ctrl + Shift + K`) | **Toggle Terminal** | Shows/hides the interactive SSH terminal pane. |
| **`Cmd + J`** (or `Ctrl + J`) | **Toggle GIA Panel** | Opens or collapses the GIA Chat panel. |
| **`Cmd + Shift + P`** (or `Ctrl + Shift + P`) | **Command Palette** | Open the Spotlight-style command launcher. |
| **`Cmd + /`** (or `Ctrl + /`) | **Command Palette** | Alternate shortcut to open the palette. |
| **`Cmd + S`** (or `Ctrl + S`) | **Save File** | Saves the active tab inside the Monaco Code Editor to the remote server. |
| **`Cmd + Shift + S`** (or `Ctrl + Shift + S`) | **Toggle Main View** | Switches the main view between File Explorer and Service Manager. |
| **`Cmd + Shift + E`** (or `Ctrl + Shift + E`) | **Jump to Explorer** | Directly switches the main view back to the File Explorer. |
| **`Esc`** | **Close Overlays** | Closes active dialogs, dropdowns, or the GIA panel. |
| **`F2`** | **Rename** | Inline-rename a focused file in the grid. |
| **`↑ / ↓ / Enter`** | **Grid Navigation** | Move focus in the file grid; Enter opens. |

---

## 11. Premium UI Features

* **Drag-to-Resize Sidebar**: Adjust your workspace by clicking and dragging the vertical border between the sidebar and the main content area (resizable from 200px up to 600px).
* **Drag-to-Resize Explorer/Editor**: Drag the `GripVertical` handle between the Explorer and Editor panels to resize. The ratio persists in localStorage.
* **Clickable Upload Panel**: The upload count badge in the status bar toggles a docked panel showing all file transfers — progress bars, status indicators, and per-item dismiss.
* **Custom Scrollbars**: Modern thin-line scrollbar aesthetics optimized for dark and light modes, avoiding intrusive default browser scrollbar styling.
* **Spring Animations**: Smooth, elastic, spring-like transition animations applied to badges, floating buttons, and status indicators.
* **Glassmorphism Panels**: Header bars, inputs, and the GIA panel use backdrop-blur and translucency rules to blend with your background workspace.
* **Lightweight Motion Library**: 12+ new motion utilities (subtle-bounce, shake, glow-once, slide-up-fade, pop, breathe, float, cursor-blink, fade-slide-right, fade-slide-up, reveal-zoom, reveal-up, progress-fill) — all under 200ms and **respect `prefers-reduced-motion`**.
* **Glow Effects**: Status dots (green/yellow/red) and service-state badges pulse with color-matched shadows to draw attention without being noisy.
* **Card Accents**: Service items get a left border in the state color (green/red/dimmed) plus a soft gradient background.
* **Gradient Headers**: Service Manager header and GIA panel header use a subtle primary→transparent gradient sweep on load.
* **Noise + Mesh Backgrounds**: A barely-visible SVG noise overlay and four radial-gradient mesh blobs sit behind everything, giving the workspace a premium "glass" look without affecting readability.
