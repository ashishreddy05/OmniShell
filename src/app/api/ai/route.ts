import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/env";
import { getClient } from "../fs/helpers";
import { readFile, listDirectory, searchFiles } from "../../../../server/ssh/sftp-operations";
import { MAX_EDITOR_FILE_SIZE } from "@/lib/constants";
import { getServiceDetail, getServiceFileContent, getServiceLogs, listServices } from "../../../../server/ssh/services";

export const runtime = "nodejs";
/**
 * Max route execution time. AI tasks that involve tool calls + multi-step reasoning
 * can easily exceed 60s. 5 minutes (300s) is the Next.js streaming-route ceiling
 * and is plenty for any single GIA turn. The client also gets clear timeout errors
 * (see the catch block below) so users know when a response was cut off.
 */
export const maxDuration = 300;

interface AiRequest {
  prompt: string;
  history: Array<{ role: "user" | "assistant" | "model"; content: string }>;
  context?: {
    connectionId?: string;
    file?: { path: string; content?: string; language?: string };
    terminal?: { output?: string; tail?: number };
    service?: { name: string };
    logs?: { serviceName: string; lines?: number; content?: string };
    currentPath?: string;
  };
  connections?: Array<{ id: string; name: string; status: string }>;
  watchedServices?: Array<{ connectionId: string; serviceName: string }>;
}

const SERVICE_ACTION_TOOL = {
  functionDeclarations: [
    {
      name: "service_action",
      description:
        "Manage systemd services: start, stop, restart, enable, or disable. Bundle all target units into one call. For voice-agent cohorts (H&G / prod / all agents), resolve names from Watched Services or list_services first — never invent names.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start", "stop", "restart", "enable", "disable"],
            description: "What to do with the service(s). 'enable' makes them start on boot, 'disable' removes that.",
          },
          serviceNames: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact unit names without .service (e.g. moorhead-inbound-agent). For H&G filter names containing hg/hoops/gia_hg; for 'all agents' use watched *agent* / *-inbound-agent* names.",
          },
          connectionId: {
            type: "string",
            description: "The server connection ID (from Available Server Connections list).",
          },
        },
        required: ["action", "serviceNames", "connectionId"],
      },
    },
  ],
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const READ_FILE_TOOL = {
  functionDeclarations: [
    {
      name: "read_file",
      description:
        "Read a text file on the server (requires approval). Use for unit files, configs, prompts. Blocked for .env and credential paths.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path of the file to read",
          },
          connectionId: {
            type: "string",
            description: "The ID of the server connection where the file resides.",
          },
        },
        required: ["path", "connectionId"],
      },
    },
  ],
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const DAEMON_RELOAD_TOOL = {
  functionDeclarations: [
    {
      name: "daemon_reload",
      description:
        "Run systemctl daemon-reload. Use when a unit file changed on disk or the user asked to reload. At most once per connection per request unless you write another unit file afterward. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          connectionId: { type: "string", description: "The server connection ID." },
        },
        required: ["connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

const RUN_COMMAND_TOOL = {
  functionDeclarations: [
    {
      name: "run_command",
      description:
        "Run a shell command (requires approval). Prefer read-only diagnostics: systemctl status, journalctl -u <unit> -n 50 --no-pager, free -m, df -h. For call_id timeline search ALWAYS prefer search_service_logs — do not invent journalctl --grep unless that tool is unavailable.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "Shell command, e.g. 'systemctl status foo --no-pager', 'journalctl -u foo -n 50 --no-pager'. Avoid inventing call_id greps — use search_service_logs.",
          },
          connectionId: { type: "string", description: "The server connection ID." },
        },
        required: ["command", "connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

const WRITE_FILE_TOOL = {
  functionDeclarations: [
    {
      name: "write_file",
      description: "Write content to a file on the server. The UI shows a diff preview before applying. NEVER use this on .env files or anywhere containing credentials. Always pass the COMPLETE new file content, not a patch.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The absolute path of the file to write." },
          content: { type: "string", description: "The complete new file content." },
          connectionId: { type: "string", description: "The ID of the server connection where the file resides." },
        },
        required: ["path", "content", "connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

const LIST_DIRECTORY_TOOL = {
  functionDeclarations: [
    {
      name: "list_directory",
      description:
        "List directory contents (read-only, requires approval). Use to explore before reading or writing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The absolute path of the directory to list (default: '/')." },
          connectionId: { type: "string", description: "The ID of the server connection." },
        },
        required: ["connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

const SEARCH_FILES_TOOL = {
  functionDeclarations: [
    {
      name: "search_files",
      description:
        "Search files by glob/name (read-only, requires approval). Returns up to 50 paths. Use to find configs, prompts, or unit files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The filename pattern to search for (e.g. '*.conf', '*.log', 'docker-compose')." },
          path: { type: "string", description: "The directory to search in (default: '/')." },
          connectionId: { type: "string", description: "The ID of the server connection." },
        },
        required: ["pattern", "connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

const LIST_SERVICES_TOOL = {
  functionDeclarations: [
    {
      name: "list_services",
      description:
        "List systemd services with state (read-only, requires approval). REQUIRED when the user asks for H&G / HG / Hoops & Gears / prod / all agents and Watched Services is empty or incomplete — then filter to *agent* / *-inbound-agent* (exclude ssh, cron, docker, and other system units). Never invent unit names.",
      parameters: {
        type: "object",
        properties: {
          connectionId: { type: "string", description: "The ID of the server connection." },
        },
        required: ["connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

const SEARCH_SERVICE_LOGS_TOOL = {
  functionDeclarations: [
    {
      name: "search_service_logs",
      description:
        "Search a service journal by call_id (or other query) and return a diagnosis extract (Start/End + error/tool hits; read-only, requires approval). PREFERRED for call_id diagnose. After success you MUST answer the user's question with a diagnosis (cite tool names/status codes) — never paste raw logs into the chat reply.",
      parameters: {
        type: "object",
        properties: {
          serviceName: {
            type: "string",
            description: "Exact unit name without .service (e.g. moorhead-inbound-agent). Use Active Service or Watched pin when present.",
          },
          query: {
            type: "string",
            description: "call_id or search string to grep in journalctl (e.g. call_abc123). Prefer the bare call_id.",
          },
          connectionId: { type: "string", description: "The server connection ID." },
        },
        required: ["serviceName", "query", "connectionId"],
      },
    },
  ],
} as any; // eslint-disable-next-line @typescript-eslint/no-explicit-any

async function gatherContext(req: AiRequest): Promise<string> {
  const parts: string[] = [];

  if (req.connections && req.connections.length > 0) {
    const connInfo = req.connections.map(c => `- Server Name: "${c.name}", Connection ID: "${c.id}", Status: "${c.status}"`).join("\n");
    parts.push(`## Available Server Connections\n${connInfo}`);
    parts.push(`## Agent ops cheat sheet
- H&G / HG / Hoops & Gears agents → watched pins matching hg|hoops|gears|gia_hg; if none, list_services then filter the same way (never invent names).
- prod agents → agent units on a connection whose name looks like Livekit prod / prod.
- all agents → watched *agent* / *-inbound-agent* pins; else list_services filtered to agent units on the target host (never every systemd unit).
- "that agent" / "this service" / "current service" → Active Service below if present; else the sole watched pin; else ask once.
- daemon-reload + restart cohort → one daemon_reload, then one service_action(restart, [resolved names]), then STOP with STEPS TAKEN.
- call_id logs → search_service_logs then DIAGNOSE from the extract (never paste raw logs; never stop at timestamps).
- memory diagnose → use context Memory + status/logs via approved tools; summarize leak vs spike vs OOM; do not restart unless asked.`);
  }

  if (req.watchedServices && req.watchedServices.length > 0) {
    const watchedInfo = req.watchedServices.map(w => {
      const conn = req.connections?.find(c => c.id === w.connectionId);
      const connName = conn ? conn.name : w.connectionId;
      return `- Service Name: "${w.serviceName}" on Server: "${connName}" (Connection ID: "${w.connectionId}")`;
    }).join("\n");
    parts.push(`## Watched Services (Dashboard Pins)\n${watchedInfo}`);
  } else if (req.connections && req.connections.length > 0) {
    parts.push(`## Watched Services (Dashboard Pins)\n(none pinned — for H&G/prod/all agents you MUST call list_services and filter)`);
  }

  if (!req.context) return parts.join("\n\n");
  const { connectionId } = req.context;

  if (req.context.currentPath) {
    parts.push(`## Current Directory\n${req.context.currentPath}`);
  }

  if (req.context.file?.path && connectionId) {
    const filePath = req.context.file.path.toLowerCase();
    const isEnvFile = filePath.endsWith(".env") || filePath.includes("/.env") || filePath.includes("\\.env");
    
    if (isEnvFile) {
      parts.push(`## File: ${req.context.file.path}\n[Access Denied: Reading .env files is blocked for security]`);
    } else {
      const result = getClient(connectionId);
      if (!("error" in result)) {
        try {
          let content = req.context.file.content;
          if (!content) {
            const buffer = await readFile(result.connectionId, result.client, req.context.file.path);
            if (buffer.length > MAX_EDITOR_FILE_SIZE) {
              content = `[File too large to inline: ${buffer.length} bytes]`;
            } else {
              content = buffer.toString("utf-8");
              if (content.length > 50_000) {
                content = content.slice(0, 50_000) + "\n... [truncated]";
              }
            }
          }
          // Skip binary files by extension — Gemini doesn't support inline image input
          const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".mp4", ".webm", ".mov", ".avi", ".mp3", ".wav", ".flac", ".aac", ".m4a", ".pdf", ".zip", ".gz", ".tar", ".bin", ".exe", ".dmg", ".pkg", ".so", ".dll", ".o", ".a", ".lib"];
          const fileExt = req.context.file.path ? "." + req.context.file.path.split(".").pop()?.toLowerCase() : "";
          if (binaryExts.includes(fileExt)) {
            parts.push(`## File: ${req.context.file.path}\n[Binary file - content not included]`);
          } else if (content && (content.includes("\x00") || content.includes("\uFFFD"))) {
            parts.push(`## File: ${req.context.file.path}\n[Binary file - content not included]`);
          } else {
            parts.push(`## File: ${req.context.file.path}${req.context.file.language ? ` (${req.context.file.language})` : ""}\n\`\`\`\n${content ?? ""}\n\`\`\``);
          }
        } catch (e) {
          parts.push(`## File: ${req.context.file.path}\n[Error reading: ${(e as Error).message}]`);
        }
      }
    }
  }

  if (req.context.terminal?.output) {
    parts.push(`## Terminal Output\n\`\`\`\n${req.context.terminal.output.slice(-20_000)}\n\`\`\``);
  }

  if (req.context.service?.name && connectionId) {
    const result = getClient(connectionId);
    if (!("error" in result)) {
      try {
        const detail = await getServiceDetail(result.client, req.context.service.name);
        const fileContent = await getServiceFileContent(result.client, req.context.service.name).catch(() => "");
        parts.push(`## Active Service: ${req.context.service.name}\n("that agent" / "current service" / "this service" → this unit)\nState: ${detail.state}\nSubstate: ${detail.substate}\nPID: ${detail.mainPID}\nMemory: ${detail.memoryCurrent?.toFixed(2) ?? "?"} MB\n\n### Service File\n\`\`\`ini\n${(fileContent || "").slice(0, 5000)}\n\`\`\``);
      } catch (e) {
        parts.push(`## Active Service: ${req.context.service.name}\n[Error: ${(e as Error).message}]`);
      }
    }
  }

  if (req.context.logs?.content) {
    parts.push(`## Logs: ${req.context.logs.serviceName}\n\`\`\`\n${req.context.logs.content.slice(-20_000)}\n\`\`\``);
  } else if (req.context.logs?.serviceName && connectionId) {
    const result = getClient(connectionId);
    if (!("error" in result)) {
      try {
        const lines = req.context.logs.lines ?? 100;
        const logs = await getServiceLogs(result.client, req.context.logs.serviceName, lines);
        parts.push(`## Logs: ${req.context.logs.serviceName} (last ${lines} lines)\n\`\`\`\n${(logs || "").slice(-20_000)}\n\`\`\``);
      } catch (e) {
        parts.push(`## Logs: ${req.context.logs.serviceName}\n[Error: ${(e as Error).message}]`);
      }
    }
  }

  return parts.join("\n\n");
}

const SYSTEM_INSTRUCTION = `You are a senior systems engineer and coding assistant integrated into OmniShell — an SSH operations hub. You manage Linux servers, systemd services, and remote files through direct tool calls — especially LiveKit voice-agent fleets.

CAPABILITIES (every tool requires user Approve — including read-only):
1. service_action — start/stop/restart/enable/disable systemd services
2. read_file — read text files except .env
3. write_file — write/edit a file with diff preview (NEVER .env or credentials)
4. daemon_reload — reload systemd after unit file changes
5. run_command — shell for diagnostics/fixes (prefer read-only)
6. list_directory — list directory contents (read-only)
7. search_files — find files by name/glob (read-only)
8. list_services — enumerate systemd services with state (read-only)
9. search_service_logs — journal search by call_id → Start/End window (read-only; prefer over inventing journalctl)

DEFINITIONS (voice-agent domain):
- Agent unit: systemd service whose name matches *agent* or *-inbound-agent* (e.g. moorhead-inbound-agent). Not ssh/cron/docker/system units.
- H&G / HG / Hoops & Gears agents: agent units for H&G shops — names containing hg, hoops, gears, or gia_hg. Resolve from Watched Services first; if empty/incomplete you MUST call list_services then filter — never invent names.
- Prod agents: agent units on the Livekit prod (or similarly named) connection.
- All agents: Watched Services that look like agents when present; else list_services filtered to agent units. Never means every unit on the host.
- "that agent" / "this service" / "current service": Active Service in context if present; else the sole watched pin; else ask once.

SUCCESS / DOES NOT COUNT:
- Resolve the exact service name list before mutating. Zero matches → ask once; do not invent names.
- "daemon reload and restart <cohort>": one daemon_reload, then one service_action(restart, [resolved names]), then STOP.
- Empty text after tools does not count — always end with a short Result + STEPS TAKEN summary.
- Restarting every host unit, guessing names, or re-calling a succeeded tool "to be sure" does not count.

COMPLETION RULES (critical — prevent tool loops):
- Finish with the fewest tool calls. Prefer one planned pass, then stop.
- NEVER re-invoke a tool with the same arguments after it already succeeded in this turn.
- daemon_reload: at most ONCE per connection per user request, unless you just wrote/changed a unit file afterward.
- After planned mutations succeed: optional single verification (status/list), then STOP with Result + STEPS TAKEN.
- On failure: diagnose once, retry once if appropriate, then stop and report. Do not loop the same fix.

DIAGNOSE / MEMORY / LOGS:
- Diagnose: investigate first — use Active Service + Logs context; if thin, propose approved tools (status/logs/RSS). Never silent restart; only restart if the user asks.
- Memory: report Memory from context or status; classify likely leak vs spike vs OOM vs normal; suggest concrete next steps. Do not restart unless the user asked.

CALL_ID / LOG DIAGNOSIS PROTOCOL:
- Prefer search_service_logs(serviceName, query=call_id) over inventing journalctl via run_command. Ask for call_id / service / connection if missing. Never invent timestamps.
- Bare call_id (+ optional service/connection hint): call search_service_logs, then ALWAYS answer with a diagnosis from the function result extract — never only restate Start/End timestamps. Cover: duration (Start→End), errors/exceptions, key voice tools (create_customer, book_appointment, check_available_slots, etc.), and success/fail signals. Open with: Used \`search_service_logs\` on <service> for <call_id> …
- Answer relative to the user question (e.g. "appointment wasn't booked" → look for book_appointment / GIA_BOOK_APPOINTMENT success/fail and status codes). Cite tool names, status codes, and key events only.
- NEVER paste raw logs, journal dumps, or long fenced log blocks into the reply. The UI does not show full logs in chat — full window is in Service Manager → Search logs with this call_id. Suggest that if the user wants to read lines.
- If the user pasted a call transcript: reconcile transcript claims vs log truth (e.g. agent said booked vs API status=500) and state the discrepancy clearly.
- User says wrong / failed / bug / diagnose / debug / why (with or without a call_id): after search, analyze deeply. Propose next approved tools if needed. Restart only if evidence warrants AND user intent allows. Never stop at "logs retrieved."
- If the function result says No matching logs / empty: say clearly not found; suggest checking service name, connection, and call_id spelling. Do not invent a timeline.
- Always name \`search_service_logs\` in the natural-language reply (not only in STEPS TAKEN).

THINKING STYLE:
- Think step by step. If something fails, diagnose and try the next logical fix once.
- If "restart X" fails with "unit file changed on disk", daemon_reload once, retry the failed action once — then stop.
- When the user gives multiple actions ("daemon-reload and restart X,Y"), emit needed tools in one response when possible.
- Write code/config changes in fenced blocks with path=filename header.
- Use list_services first if unsure what services exist; use search_files before hunting configs by reading dirs.
- Briefly say what you will do when calling tools; never pretend a remote action already ran before the user Approves.

SECURITY:
- FORBIDDEN to read OR write .env files, credential files, or anything under ~/.ssh/. Refuse politely.
- EVERY remote tool (read-only and mutating) requires user Approve in the UI. Do NOT ask for approval in chat text — call the tool; the UI shows the card. Never claim a tool succeeded before approval.

FILE EDITING:
- write_file: ALWAYS pass the COMPLETE new file content, not a patch.
- Prefer read_file first if unsure of current content.
- For new files, the user must specify the path; don't invent paths.

SERVICE MANAGEMENT:
- connectionId is always from Available Server Connections.
- Bundle multiple services into a single service_action call for the same action.
- Strip .service suffix from names.
- Typical "reload and restart" order: daemon_reload once → service_action(restart, [...]) once → optional verify → stop.
- Do NOT daemon-reload before every restart. Only when asked, unit changed, or systemctl reported "unit file changed on disk".
- "all services" / "restart everything" without an agent filter means Watched Services when present. If no watched services and no cohort filter, ask which — never restart every unit on the host.

REPLY FORMAT after tools:
**Result:** ✅ or ❌ one-line outcome
**STEPS TAKEN:** bullets with tool + key names/ok/fail
Then 1–3 sentences of diagnosis or next steps if useful.

Be concise. Prefer actionable answers grounded in context (watched pins, active service, logs, open file). If context is sparse, ask once or call list_services.`;

export async function POST(request: Request) {
  if (!env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_API_KEY not configured on server. Add it to .env and restart." },
      { status: 503 },
    );
  }

  let body: AiRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const contextString = await gatherContext(body);

  const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [
      SERVICE_ACTION_TOOL,
      READ_FILE_TOOL,
      DAEMON_RELOAD_TOOL,
      RUN_COMMAND_TOOL,
      WRITE_FILE_TOOL,
      LIST_DIRECTORY_TOOL,
      SEARCH_FILES_TOOL,
      LIST_SERVICES_TOOL,
      SEARCH_SERVICE_LOGS_TOOL,
    ],
  });

  const chatHistory = (body.history ?? []).map((m) => ({
    role: m.role === "assistant" ? "model" : m.role,
    parts: [{ text: m.content }],
  })) as Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;

  const userMessage = contextString
    ? `${contextString}\n\n---\n\n${body.prompt}`
    : body.prompt;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startedAt = Date.now();
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may already be closed (e.g. client disconnected) — swallow.
        }
      };

      // Soft-warning timer: if the model is still streaming at (maxDuration - 30s),
      // emit a warning chunk so the user knows it's about to cut off.
      const SOFT_WARN_MS = (maxDuration - 30) * 1000;
      const warnTimer = setTimeout(() => {
        send({ chunk: "\n\n_⏳ Response is taking a while — approaching the 5-minute limit. If this gets cut off, click **Continue** in the header to resume._" });
      }, SOFT_WARN_MS);

      try {
        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessageStream(userMessage);

        const sentFcKeys = new Set<string>();
        for await (const chunk of result.stream) {
          const fcs = chunk.functionCalls?.() ?? [];
          for (const fc of fcs) {
            const key = fc.name + JSON.stringify(fc.args);
            if (sentFcKeys.has(key)) continue;
            sentFcKeys.add(key);
            send({ clearLast: true });
            send({ functionCall: { name: fc.name, args: fc.args } });
          }

          if (fcs.length > 0) continue;

          let chunkText = "";
          try {
            chunkText = chunk.text?.() ?? "";
          } catch {
            // Ignore error when chunk has no text (e.g. function call chunks)
          }

          if (chunkText) {
            send({ chunk: chunkText });
          }
        }

        clearTimeout(warnTimer);
        // If a function call was sent, the client handles the action and may follow up
        send({ done: true });
        controller.close();
      } catch (e) {
        clearTimeout(warnTimer);
        const msg = (e as Error).message;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        // Gemini doesn't support inline image input — show a user-friendly message
        if (msg.includes("does not support image input")) {
          send({ chunk: "_📷 This model does not support image analysis. Please ask about text content only._" });
        } else if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("deadline")) {
          // Server-side timeout: tell the client it was cut off so it can offer "Continue"
          send({ truncated: true, error: `Response timed out after ${elapsed}s. Click Continue in the GIA header to resume.`, elapsed });
        } else {
          send({ error: msg, elapsed });
        }
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // Disable buffering on proxies that buffer long-lived streams
      "X-Accel-Buffering": "no",
    },
  });
}
