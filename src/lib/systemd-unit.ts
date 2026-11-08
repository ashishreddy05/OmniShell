/** Parse / build simple systemd unit files for voice-agent workflows. */

export type ProfileCandidateKind = "env" | "config" | "prompt" | "other";

export interface ProfileCandidate {
  kind: ProfileCandidateKind;
  label: string;
  path: string;
  source: string;
}

export interface ParsedUnitPaths {
  workingDirectory: string | null;
  environment: Record<string, string>;
  environmentFiles: string[];
  candidates: ProfileCandidate[];
}

const CONFIG_ENV_KEYS = new Set([
  "AGENT_CONFIG_PATH",
  "PROMPT_PATH",
  "PROFILE",
  "PROFILE_PATH",
  "CONFIG_PATH",
  "CONFIG_FILE",
]);

const PATH_LIKE = /(?:^|[=\s])(\.?\.?\/[^\s"']+|[^\s"']+\.(?:json|ya?ml|toml|txt|env|conf|cfg)|configs\/[^\s"']+|profiles\/[^\s"']+)/i;

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function resolvePath(wd: string | null, raw: string): string {
  const p = stripQuotes(raw).replace(/^-/, ""); // EnvironmentFile=-/path
  if (!p) return p;
  if (p.startsWith("/")) return p;
  if (wd) {
    const base = wd.replace(/\/$/, "");
    return `${base}/${p.replace(/^\.\//, "")}`;
  }
  return p;
}

function classifyPath(path: string, key?: string): ProfileCandidateKind {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() || lower;
  if (key === "PROMPT_PATH" || base === "prompt.txt" || lower.includes("/prompt.")) return "prompt";
  if (
    key === "AGENT_CONFIG_PATH" ||
    key === "CONFIG_PATH" ||
    key === "CONFIG_FILE" ||
    lower.includes("/configs/") ||
    base.endsWith(".json") ||
    base.endsWith(".yaml") ||
    base.endsWith(".yml")
  ) {
    return "config";
  }
  if (
    key === "EnvironmentFile" ||
    base === ".env" ||
    base.startsWith(".env.") ||
    lower.includes("/.env") ||
    base.endsWith(".env")
  ) {
    return "env";
  }
  return "other";
}

function labelFor(kind: ProfileCandidateKind, path: string, source: string): string {
  const leaf = path.split("/").filter(Boolean).pop() || path;
  if (kind === "env") return `Open env file — ${leaf}`;
  if (kind === "config") return `Open config — ${leaf}`;
  if (kind === "prompt") return `Open prompt — ${leaf}`;
  return `Open ${leaf} (${source})`;
}

function parseEnvAssignments(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = stripQuotes(raw);
  // Split on spaces that precede KEY= (systemd allows multiple assignments)
  const parts = body.match(/(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*))/g) ?? [body];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = stripQuotes(part.slice(eq + 1));
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Extract WorkingDirectory, Environment*, and openable profile/config/env paths
 * from unit file text (e.g. systemctl cat output). Does not invent paths.
 */
export function parseUnitPaths(content: string): ParsedUnitPaths {
  const environment: Record<string, string> = {};
  const environmentFiles: string[] = [];
  let workingDirectory: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    const wd = trimmed.match(/^WorkingDirectory\s*=\s*(.+)$/i);
    if (wd) {
      workingDirectory = stripQuotes(wd[1]);
      continue;
    }

    const envFile = trimmed.match(/^EnvironmentFile\s*=\s*(.+)$/i);
    if (envFile) {
      environmentFiles.push(stripQuotes(envFile[1]));
      continue;
    }

    const env = trimmed.match(/^Environment\s*=\s*(.+)$/i);
    if (env) {
      Object.assign(environment, parseEnvAssignments(env[1]));
    }
  }

  const candidates: ProfileCandidate[] = [];
  const seen = new Set<string>();

  const push = (kind: ProfileCandidateKind, path: string, source: string) => {
    const resolved = resolvePath(workingDirectory, path);
    if (!resolved || seen.has(resolved)) return;
    // Skip bare slugs with no path separators unless they look like files
    if (!resolved.includes("/") && !resolved.includes(".")) return;
    seen.add(resolved);
    candidates.push({
      kind,
      path: resolved,
      source,
      label: labelFor(kind, resolved, source),
    });
  };

  for (const ef of environmentFiles) {
    push("env", ef, "EnvironmentFile=");
  }

  for (const [key, val] of Object.entries(environment)) {
    if (!val) continue;

    // Profile slugs → derive paths under WorkingDirectory/profiles/<slug>/
    if (
      (key === "CLIENT_PROFILE" || key === "PROFILE") &&
      !val.includes("/") &&
      !/\.(json|ya?ml|toml|txt|env|conf|cfg)$/i.test(val)
    ) {
      if (workingDirectory) {
        push("env", `profiles/${val}/.env`, `Environment=${key}`);
        push("prompt", `profiles/${val}/prompt.txt`, `Environment=${key}`);
      }
      continue;
    }

    if (CONFIG_ENV_KEYS.has(key) || val.includes("/") || PATH_LIKE.test(val)) {
      push(classifyPath(val, key), val, `Environment=${key}`);
    }
  }

  return { workingDirectory, environment, environmentFiles, candidates };
}

export interface UnitTemplateInput {
  description: string;
  user?: string;
  group?: string;
  workingDirectory: string;
  /** Absolute or relative AGENT_CONFIG_PATH value */
  agentConfigPath?: string;
  /** Optional EnvironmentFile= path */
  environmentFile?: string;
  /** Extra Environment= KEY=VALUE pairs */
  extraEnv?: Record<string, string>;
  execStart: string;
  restart?: string;
  restartSec?: number;
  syslogIdentifier: string;
  /** Optional OnFailure= unit, e.g. slack-notify@%n.service */
  onFailure?: string;
  /** Optional MemoryMax=, e.g. 3G */
  memoryMax?: string;
  /** Optional CPUQuota=, e.g. 90% */
  cpuQuota?: string;
}

/** Build a voice-agent-style unit file matching the deployed inbound-agent units. */
export function buildUnitFile(input: UnitTemplateInput): string {
  const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
  const user = oneLine(input.user || "root") || "root";
  const group = oneLine(input.group || user) || user;
  const restart = oneLine(input.restart || "always");
  const restartSec = input.restartSec ?? 10;

  const envLines: string[] = [];
  if (input.agentConfigPath) {
    envLines.push(`Environment=AGENT_CONFIG_PATH=${oneLine(input.agentConfigPath)}`);
  }
  if (input.extraEnv) {
    for (const [k, v] of Object.entries(input.extraEnv)) {
      if (k && v) envLines.push(`Environment=${oneLine(k)}=${oneLine(v)}`);
    }
  }

  const unitLines = [
    "[Unit]",
    `Description=${oneLine(input.description)}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
  ];
  if (input.onFailure) unitLines.push(`OnFailure=${oneLine(input.onFailure)}`);

  const serviceLines = [
    "[Service]",
    "Type=simple",
    `User=${user}`,
    `Group=${group}`,
    `WorkingDirectory=${oneLine(input.workingDirectory)}`,
    ...envLines,
    `ExecStart=${oneLine(input.execStart)}`,
    `Restart=${restart}`,
    `RestartSec=${restartSec}`,
    "StandardOutput=journal",
    "StandardError=journal",
    `SyslogIdentifier=${oneLine(input.syslogIdentifier)}`,
  ];
  if (input.environmentFile) serviceLines.push(`EnvironmentFile=${oneLine(input.environmentFile)}`);
  if (input.memoryMax) serviceLines.push(`MemoryMax=${oneLine(input.memoryMax)}`);
  if (input.cpuQuota) serviceLines.push(`CPUQuota=${oneLine(input.cpuQuota)}`);

  return [
    ...unitLines,
    "",
    ...serviceLines,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

export const DEFAULT_VOICE_AGENT_WD = "/opt/agents/gia-voice-inbound";
export const DEFAULT_ON_FAILURE = "slack-notify@%n.service";
export const DEFAULT_MEMORY_MAX = "3G";
export const DEFAULT_CPU_QUOTA = "90%";

export function defaultExecStart(workingDirectory: string): string {
  const wd = workingDirectory.replace(/\/$/, "") || DEFAULT_VOICE_AGENT_WD;
  return `${wd}/venv/bin/python orchestrator.py dev`;
}

export function unitFilePath(serviceName: string): string {
  const name = serviceName.replace(/\.service$/i, "");
  return `/etc/systemd/system/${name}.service`;
}
