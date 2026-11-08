import type { Client } from "ssh2";
import { execCommand, reserveSlot } from "./exec";
import { debugLog, debugWarn, debugError } from "../debug-log";

export interface ServiceInfo {
  name: string;
  description: string;
  state: "active" | "inactive" | "activating" | "deactivating" | "failed" | "unknown";
  substate: string;
  loaded: "loaded" | "not-found" | "error";
  mainPID: number;
}

export interface ServiceDetail {
  name: string;
  description: string;
  state: string;
  substate: string;
  loaded: string;
  mainPID: number;
  activeEnterTimestamp: string;
  restart: string;
  memoryCurrent?: number;
  unitFileState: string;
}

export function normalizeServiceName(name: string): string {
  return name.endsWith(".service") ? name.slice(0, -8) : name;
}

export async function listServices(client: Client): Promise<ServiceInfo[]> {
  const { stdout } = await execCommand(
    client,
    `systemctl list-units --type=service --all --no-legend --no-pager -o json 2>/dev/null | head -c 100000`,
    15_000,
  );

  if (!stdout.trim()) {
    // Fallback to plain text parsing
    return listServicesPlain(client);
  }

  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return listServicesPlain(client);
    }

    return parsed.map((s: Record<string, unknown>) => ({
      name: (s.unit as string)?.replace(".service", "") ?? "unknown",
      description: (s.description as string) ?? "",
      state: normalizeState(s.active as string),
      substate: (s.sub as string) ?? "",
      loaded: (s.loaded as string) as ServiceInfo["loaded"] ?? "unknown",
      mainPID: typeof s.mainPID === "number" ? s.mainPID : 0,
    }));
  } catch {
    return listServicesPlain(client);
  }
}

async function listServicesPlain(client: Client): Promise<ServiceInfo[]> {
  const { stdout } = await execCommand(
    client,
    `systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | head -200`,
    15_000,
  );

  const services: ServiceInfo[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const unit = parts[0];
    if (!unit.endsWith(".service")) continue;

    services.push({
      name: unit.replace(".service", ""),
      description: parts.slice(4).join(" ") || "",
      state: normalizeState(parts[2]),
      substate: parts[3] || "",
      loaded: parts[1] as ServiceInfo["loaded"] ?? "loaded",
      mainPID: 0,
    });
  }

  return services;
}

function normalizeState(state: string | undefined): ServiceInfo["state"] {
  switch (state) {
    case "active": return "active";
    case "inactive": return "inactive";
    case "activating": return "activating";
    case "deactivating": return "deactivating";
    case "failed": return "failed";
    default: return "unknown";
  }
}

/**
 * Build a bash one-liner that fetches MemoryCurrent for a service,
 * falling back to VmRSS from /proc/$PID/status when cgroup memory is unavailable.
 */
function buildMemoryBashCommand(service: string): string {
  return `m=$(systemctl show --property=MemoryCurrent --value '${service}.service' 2>/dev/null); ` +
    `if [ -n "$m" ] && [ "$m" != "[not set]" ] && [ "$m" != "0" ] && [ "$m" != "infinity" ]; then ` +
    `  awk -v b="$m" 'BEGIN {printf "%.2f", b/1024/1024}'; ` +
    `else ` +
    `  p=$(systemctl show --property=MainPID --value '${service}.service' 2>/dev/null); ` +
    `  if [ -n "$p" ] && [ "$p" != "0" ]; then awk '/VmRSS/ {printf "%.2f", $2/1024}' /proc/$p/status 2>/dev/null; fi; ` +
    `fi`;
}

/** Parse a MemoryCurrent float from a bash one-liner output. */
function parseMemoryMB(stdout: string): number | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const mb = parseFloat(trimmed);
  return !isNaN(mb) && mb > 0 ? mb : null;
}

export async function getServiceDetail(client: Client, serviceName: string): Promise<ServiceDetail> {
  const service = normalizeServiceName(serviceName);
  // Single exec: systemctl show + conditional VmRSS fallback (non-cgroup-v2).
  // Appends MemoryCurrent=<bytes> when MemoryCurrent is unset so parseSystemdShow picks it up.
  const { stdout } = await execCommand(
    client,
    `out=$(systemctl show "${service}.service" --property=Description,ActiveState,SubState,LoadState,MainPID,ActiveEnterTimestamp,Restart,MemoryCurrent,UnitFileState 2>/dev/null); ` +
    `printf '%s\\n' "$out"; ` +
    `m=$(printf '%s\\n' "$out" | sed -n 's/^MemoryCurrent=//p'); ` +
    `if [ -z "$m" ] || [ "$m" = "[not set]" ] || [ "$m" = "18446744073709551615" ] || [ "$m" = "0" ]; then ` +
    `  p=$(printf '%s\\n' "$out" | sed -n 's/^MainPID=//p'); ` +
    `  if [ -n "$p" ] && [ "$p" != "0" ]; then ` +
    `    rss=$(awk '/VmRSS/ {print $2}' /proc/$p/status 2>/dev/null); ` +
    `    if [ -n "$rss" ] && [ "$rss" -gt 0 ] 2>/dev/null; then printf 'MemoryCurrent=%s\\n' "$((rss * 1024))"; fi; ` +
    `  fi; ` +
    `fi`,
    10_000,
  );

  const props = parseSystemdShow(stdout);

  const mainPID = parseInt(props.get("MainPID") || "0", 10);
  let memoryCurrent: number | undefined;
  const memStr = props.get("MemoryCurrent");
  if (memStr && memStr !== "[not set]" && memStr !== "18446744073709551615") {
    const memBytes = parseInt(memStr, 10);
    if (!isNaN(memBytes) && memBytes > 0) {
      memoryCurrent = Math.round(memBytes / 1024 / 1024 * 100) / 100;
    }
  }

  return {
    name: serviceName,
    description: props.get("Description") || "",
    state: props.get("ActiveState") || "unknown",
    substate: props.get("SubState") || "",
    loaded: props.get("LoadState") || "",
    mainPID,
    activeEnterTimestamp: props.get("ActiveEnterTimestamp") || "",
    restart: props.get("Restart") || "",
    memoryCurrent,
    unitFileState: props.get("UnitFileState") || "",
  };
}

export async function getServiceMemory(client: Client, serviceName: string): Promise<number | null> {
  const service = normalizeServiceName(serviceName);
  try {
    const { stdout } = await execCommand(client, buildMemoryBashCommand(service), 5_000);
    const mb = parseMemoryMB(stdout);
    debugLog(`[Services] getServiceMemory(${service}): ${mb !== null ? mb.toFixed(2) + ' MB' : 'null'}`);
    return mb;
  } catch (err) {
    debugError(`[Services] getServiceMemory error for ${serviceName}:`, err);
    return null;
  }
}

export async function getServicesMemory(
  client: Client,
  serviceNames: string[]
): Promise<Array<{ name: string; memoryMB: number | null }>> {
  if (serviceNames.length === 0) return [];

  try {
    // Parallel batches of 3 to reduce wall-clock time while avoiding channel saturation.
    // Each group runs sequentially within itself (to keep stdout clean),
    // but groups execute concurrently via the SSH exec queue (MAX_CONCURRENT=8).
    const BATCH_SIZE = 3;
    const results = new Map<string, number | null>();
    const SVC = "---SVC---";

    for (let i = 0; i < serviceNames.length; i += BATCH_SIZE) {
      const batch = serviceNames.slice(i, i + BATCH_SIZE);
      const cmds = batch.map((n) => {
        const service = normalizeServiceName(n);
        return `printf "${SVC}${service}="; ` + buildMemoryBashCommand(service) + `; printf "\\n";`;
      });
      const { stdout } = await execCommand(client, cmds.join(" "), 15_000);

      for (const line of stdout.split("\n")) {
        if (!line.startsWith(SVC)) continue;
        const rest = line.slice(SVC.length);
        const sepIdx = rest.indexOf("=");
        if (sepIdx === -1) continue;
        const svc = rest.slice(0, sepIdx);
        const raw = rest.slice(sepIdx + 1);
        const mb = parseFloat(raw);
        results.set(svc, !isNaN(mb) && mb > 0 ? mb : null);
      }
    }

    return serviceNames.map((name) => {
      const norm = normalizeServiceName(name);
      const memoryMB = results.get(norm) ?? null;
      debugLog(`[Services] getServicesMemory(${name}): ${memoryMB !== null ? memoryMB + ' MB' : 'null'}`);
      return { name, memoryMB };
    });
  } catch (err) {
    debugError("[Services] getServicesMemory batch error:", err);
    return serviceNames.map((name) => ({ name, memoryMB: null }));
  }
}

export async function reloadDaemon(client: Client): Promise<void> {
  const { stderr } = await execCommand(
    client,
    `systemctl daemon-reload 2>&1`,
    30_000,
  );
  if (stderr.trim()) throw new Error(stderr.trim());
}

const CHANGED_ON_DISK = "changed on disk";

async function systemctlAction(
  client: Client,
  serviceName: string,
  action: string,
  retried?: boolean,
): Promise<void> {
  const service = normalizeServiceName(serviceName);
  const { stderr } = await execCommand(
    client,
    `systemctl ${action} "${service}.service"`,
    30_000,
  );
  const msg = stderr.trim();
  if (!msg) return;
  if (!retried && msg.includes(CHANGED_ON_DISK)) {
    await reloadDaemon(client);
    return systemctlAction(client, serviceName, action, true);
  }
  throw new Error(msg);
}

export async function startService(client: Client, serviceName: string): Promise<void> {
  return systemctlAction(client, serviceName, "start");
}

export async function stopService(client: Client, serviceName: string): Promise<void> {
  return systemctlAction(client, serviceName, "stop");
}

export async function restartService(client: Client, serviceName: string): Promise<void> {
  return systemctlAction(client, serviceName, "restart");
}

export async function enableService(client: Client, serviceName: string): Promise<void> {
  const service = normalizeServiceName(serviceName);
  const { stderr } = await execCommand(
    client,
    `systemctl enable "${service}.service"`,
    30_000,
  );
  if (stderr.trim()) throw new Error(stderr.trim());
}

export async function disableService(client: Client, serviceName: string): Promise<void> {
  const service = normalizeServiceName(serviceName);
  const { stderr } = await execCommand(
    client,
    `systemctl disable "${service}.service"`,
    30_000,
  );
  if (stderr.trim()) throw new Error(stderr.trim());
}

/**
 * Delete a service: stop → disable → daemon-reload → rm unit file.
 * Single exec to minimize channel usage. Best-effort on each step —
 * the unit may already be stopped or not exist on disk.
 */
export async function deleteService(client: Client, serviceName: string): Promise<void> {
  const service = normalizeServiceName(serviceName);
  const { stderr } = await execCommand(
    client,
    `systemctl stop "${service}.service" 2>/dev/null; ` +
    `systemctl disable "${service}.service" 2>/dev/null; ` +
    `systemctl daemon-reload 2>/dev/null; ` +
    `rm -f "/etc/systemd/system/${service}.service"`,
    30_000,
  );
  // Only throw on hard errors — "not loaded" / "no such unit" are expected
  const hardErrors = (stderr || "").split("\n").filter(
    (l) => l.trim() && !l.includes("not loaded") && !l.includes("No such file") && !l.includes("not-found"),
  );
  if (hardErrors.length > 0) throw new Error(hardErrors.join("\n"));
}

export async function runCommand(client: Client, command: string): Promise<{ stdout: string; stderr: string }> {
  return execCommand(
    client,
    command,
    60_000,
  );
}

export async function getServiceFileContent(client: Client, serviceName: string): Promise<string> {
  const service = normalizeServiceName(serviceName);
  const { stdout, stderr } = await execCommand(
    client,
    `systemctl cat "${service}.service" 2>/dev/null`,
    10_000,
  );
  if (stderr.trim() && !stdout.trim()) throw new Error(stderr.trim());
  return stdout;
}

export interface LogSearchOptions {
  /** Seconds to extend the window BEFORE the start webhook (shows pre-call logs) */
  startPaddingSec?: number;
  /** Seconds to extend the window AFTER the end webhook (shows post-call logs) */
  endPaddingSec?: number;
}

/** Escape a string for journalctl --grep (PCRE) and embed in a single-quoted shell arg. */
function journalGrepArg(raw: string): string {
  const pcre = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `'${pcre.replace(/'/g, `'\\''`)}'`;
}

function unixTsFromShortUnixLine(line: string): string | null {
  const ts = line.trim().split(/\s+/)[0];
  if (!ts || Number.isNaN(parseFloat(ts))) return null;
  return ts;
}

/**
 * Extract the voice-agent session id from a log line. The app calls it
 * `session_id`; the agent logs it as `room_id` (LiveKit room). Prefer room_id.
 */
const ROOM_ID_RE =
  /["']?\broom[_-]?id\b["']?\s*[:=]\s*["']?([a-zA-Z0-9_.:-]{4,})/gi;
const SESSION_KEY_ID_RE =
  /["']?\bsession[_-]?id\b["']?\s*[:=]\s*["']?([a-zA-Z0-9_.:-]{4,})/gi;

function firstSessionId(re: RegExp, text: string): string | undefined {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[1].replace(/[.:-]+$/, "");
    if (value && !/^(null|none|undefined|nil)$/i.test(value)) return value;
  }
  return undefined;
}

export function extractSessionId(text: string): string | undefined {
  return firstSessionId(ROOM_ID_RE, text) ?? firstSessionId(SESSION_KEY_ID_RE, text);
}

/**
 * Search logs by call_id (or any unique query).
 *
 * 1) `journalctl --grep=<call_id>` → lines for that call (start / customer / end webhooks, etc.)
 * 2) Prefer Start webhook + End webhook timestamps from those hits; else first/last match
 * 3) Fetch the full journal window between those times (plus optional padding)
 *
 * Do NOT grep Start/End alone without the call_id — that returns the latest call on the host.
 */
export async function searchServiceLogs(
  client: Client,
  serviceName: string,
  query: string,
  options: LogSearchOptions = {},
): Promise<{ context: string; startTimestamp: string; endTimestamp: string; sessionId?: string }> {
  const service = normalizeServiceName(serviceName);
  const startPad = Math.max(0, options.startPaddingSec ?? 0);
  const endPad = Math.max(0, options.endPaddingSec ?? 0);

  const cleanQuery = query.replace(/[….]+$/u, "").replace(/\.{2,}$/, "").trim();
  if (!cleanQuery) {
    return { context: "", startTimestamp: "", endTimestamp: "" };
  }

  // Phase 1: grep ONLY by call_id / query — this is the unique anchor
  const { stdout: matchRaw } = await execCommand(
    client,
    `journalctl -u "${service}.service" --grep=${journalGrepArg(cleanQuery)} -o short-unix --no-pager -n 500 2>/dev/null`,
    30_000,
  );

  const lines = matchRaw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { context: "", startTimestamp: "", endTimestamp: "" };
  }

  const lower = (l: string) => l.toLowerCase();
  const startLine =
    lines.find((l) => lower(l).includes("start webhook")) ||
    lines.find((l) => lower(l).includes("call_start") || lower(l).includes("call start")) ||
    lines[0];
  const endLine =
    [...lines].reverse().find((l) => lower(l).includes("end webhook")) ||
    [...lines].reverse().find((l) => lower(l).includes("call_end") || lower(l).includes("call end")) ||
    lines[lines.length - 1];

  const startTs = unixTsFromShortUnixLine(startLine);
  const endTs = unixTsFromShortUnixLine(endLine);
  if (!startTs) {
    return { context: "", startTimestamp: "", endTimestamp: "" };
  }

  // Phase 2: full window between call_start and call_end (+ padding).
  // +1s on end so same-second trailing lines are included.
  const sinceUnix = (parseFloat(startTs) - startPad).toFixed(6);
  const untilUnix = endTs
    ? (parseFloat(endTs) + Math.max(endPad, 1)).toFixed(6)
    : "";

  let rangeClause = `--since @${sinceUnix}`;
  if (untilUnix) rangeClause += ` --until @${untilUnix}`;

  const { stdout: contextOutput } = await execCommand(
    client,
    `journalctl -u "${service}.service" ${rangeClause} --no-pager 2>/dev/null`,
    15_000,
  );

  const contextLines = contextOutput.split("\n").filter(Boolean);
  const displayStart = contextLines.length > 0 ? contextLines[0].slice(0, 15).trim() : startTs;
  const displayEnd =
    contextLines.length > 1
      ? contextLines[contextLines.length - 1].slice(0, 15).trim()
      : endTs || displayStart;

  // Session id appears as room_id on the call's own log lines; fall back to
  // the full window when the anchor lines don't carry it.
  const sessionId = extractSessionId(contextOutput) ?? extractSessionId(matchRaw);

  return { context: contextOutput, startTimestamp: displayStart, endTimestamp: displayEnd, sessionId };
}

export async function getServiceLogs(client: Client, serviceName: string, lines = 50): Promise<string> {
  const service = normalizeServiceName(serviceName);
  const { stdout } = await execCommand(
    client,
    `journalctl -u "${service}.service" --no-pager -n ${lines} 2>/dev/null`,
    10_000,
  );
  return stdout;
}

export interface LogStreamHandle {
  stream: { close: () => void };
  abort: () => void;
}

export function streamServiceLogs(
  client: Client,
  serviceName: string,
  onChunk: (chunk: string) => void,
  onError: (err: Error) => void,
  onClose: () => void,
  options?: { historyLines?: number },
): LogStreamHandle {
  const service = normalizeServiceName(serviceName);
  const historyLines = options?.historyLines ?? 200;
  const cmd = `journalctl -u "${service}.service" -f -n ${historyLines} --no-pager --output=cat 2>&1`;
  const handle: { stream?: { close: () => void } } = {};
  const release = reserveSlot(client);

  try {
    client.exec(cmd, (err, stream) => {
      if (err) {
        release();
        onError(err);
        onClose();
        return;
      }
      handle.stream = {
        close: () => {
          try { stream.close(); } catch { /* noop */ }
        },
      };
      stream.on("data", (data: Buffer) => {
        onChunk(data.toString("utf8"));
      });
      stream.stderr?.on("data", (data: Buffer) => {
        onChunk(data.toString("utf8"));
      });
      stream.on("close", () => {
        release();
        onClose();
      });
      stream.on("error", (e: Error) => {
        release();
        onError(e);
        onClose();
      });
    });
  } catch (e) {
    release();
    onError(e as Error);
    onClose();
  }

  return {
    get stream() {
      return handle.stream ?? { close: () => {} };
    },
    abort: () => {
      try { handle.stream?.close(); } catch { /* noop */ }
    },
  };
}

function parseSystemdShow(output: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    props.set(key, value);
  }
  return props;
}

export interface ServiceStatus {
  name: string;
  state: string;
  substate: string;
  memoryCurrent?: number;
}

export async function getServicesStatus(
  client: Client,
  serviceNames: string[]
): Promise<ServiceStatus[]> {
  if (serviceNames.length === 0) return [];
  const normalizedNames = serviceNames.map(normalizeServiceName);
  const unitNames = normalizedNames.map(n => `"${n}.service"`).join(" ");
  
  const { stdout } = await execCommand(
    client,
    `systemctl show ${unitNames} --property=Id,ActiveState,SubState,MemoryCurrent 2>/dev/null`,
    15_000
  );

  const results: ServiceStatus[] = [];
  // Split systemctl show output by blank lines (blocks represent units)
  const blocks = stdout.split(/\n\s*\n/).filter(Boolean);

  for (const block of blocks) {
    const props = parseSystemdShow(block);
    const id = props.get("Id") || "";
    if (!id) continue;
    const name = id.endsWith(".service") ? id.slice(0, -8) : id;
    
    if (!normalizedNames.includes(name)) continue;

    const state = props.get("ActiveState") || "unknown";
    const substate = props.get("SubState") || "";
    
    let memoryCurrent: number | undefined;
    const memStr = props.get("MemoryCurrent");
    if (memStr && memStr !== "[not set]" && memStr !== "18446744073709551615") {
      const memBytes = parseInt(memStr, 10);
      if (!isNaN(memBytes) && memBytes > 0) {
        memoryCurrent = Math.round(memBytes / 1024 / 1024 * 100) / 100;
      }
    }

    results.push({ name, state, substate, memoryCurrent });
  }

  const statusMap = new Map(results.map(r => [r.name, r]));
  return normalizedNames.map(name => {
    return statusMap.get(name) || { name, state: "unknown", substate: "unknown" };
  });
}

// Self-check: npx tsx server/ssh/services.ts
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /services\.(ts|js|mjs)$/.test(process.argv[1]);

if (isDirectRun) {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`services selfCheck failed: ${msg}`);
  };
  assert(
    extractSessionId('Start webhook call_id=abc room_id=RM_abc123') === "RM_abc123",
    "plain room_id",
  );
  assert(
    extractSessionId('{"room_id":"RM_json","session_id":"s1"}') === "RM_json",
    "json room_id preferred",
  );
  assert(
    extractSessionId("session_id=abc-123 room baseline") === "abc-123",
    "session_id fallback",
  );
  assert(extractSessionId('room_id="null"') === undefined, "null room_id");
  assert(
    extractSessionId("room_id=null later room_id=RM_real1") === "RM_real1",
    "skips null room_id",
  );
  assert(extractSessionId("no identifiers here") === undefined, "no match");
  console.log("services selfCheck ok");
}
