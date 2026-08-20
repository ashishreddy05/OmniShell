import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export interface SSHConfigEntry {
  host: string; // The Host alias (used as connection name)
  hostName: string; // The actual hostname/IP
  user: string;
  port: number;
  identityFile: string; // Resolved absolute path
}

/**
 * Parses an OpenSSH config file and returns importable host entries.
 * Skips wildcard hosts (*, ?) and entries missing HostName or IdentityFile.
 */
export function parseSSHConfig(filePath?: string): SSHConfigEntry[] {
  const configPath = filePath || resolve(homedir(), ".ssh", "config");

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(`Cannot read SSH config file: ${configPath}`);
  }

  return parseSSHConfigContent(content);
}

export function parseSSHConfigContent(content: string): SSHConfigEntry[] {
  const lines = content.split("\n");
  const entries: SSHConfigEntry[] = [];

  // Defaults from Host * blocks
  let defaults: Partial<RawEntry> = {};
  let current: RawEntry | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Parse "Key Value" or "Key=Value"
    const match = line.match(/^(\S+)\s*[=\s]\s*(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const keyLower = key.toLowerCase();

    if (keyLower === "host") {
      // Flush previous entry
      if (current) {
        const entry = resolveEntry(current, defaults);
        if (entry) entries.push(entry);
      }

      // Check for wildcard host
      if (value.includes("*") || value.includes("?")) {
        // This is a defaults block (Host *)
        current = { host: value, isWildcard: true };
      } else {
        // Split multi-host declarations, take the first
        const hosts = value.split(/\s+/);
        current = { host: hosts[0], isWildcard: false };
      }
      continue;
    }

    const target = current || (defaults as RawEntry);
    if (!target) continue;

    switch (keyLower) {
      case "hostname":
        target.hostName = value;
        break;
      case "user":
        target.user = value;
        break;
      case "port":
        target.port = parseInt(value, 10);
        break;
      case "identityfile":
        // Only take the first IdentityFile directive
        if (!target.identityFile) {
          target.identityFile = resolveKeyPath(value);
        }
        break;
    }
  }

  // Flush last entry
  if (current) {
    if (current.isWildcard) {
      defaults = { ...defaults, ...current };
    } else {
      const entry = resolveEntry(current, defaults);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

interface RawEntry {
  host: string;
  isWildcard: boolean;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

function resolveEntry(raw: RawEntry, defaults: Partial<RawEntry>): SSHConfigEntry | null {
  if (raw.isWildcard) return null;

  const hostName = raw.hostName || defaults.hostName || raw.host;
  const user = raw.user || defaults.user;
  const identityFile = raw.identityFile || defaults.identityFile;

  // Must have at minimum a user and identity file to be importable
  if (!user || !identityFile) return null;

  return {
    host: raw.host,
    hostName,
    user,
    port: raw.port || defaults.port || 22,
    identityFile,
  };
}

function resolveKeyPath(keyPath: string): string {
  if (keyPath.startsWith("~/")) {
    return resolve(homedir(), keyPath.slice(2));
  }
  return resolve(keyPath);
}
