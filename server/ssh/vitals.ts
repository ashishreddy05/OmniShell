import type { Client } from "ssh2";
import { execCommand } from "./exec";

export interface SystemVitals {
  os: string;
  uptime: string;
  cpu: { cores: number; loadAvg: [number, number, number] };
  memory: { totalMB: number; usedMB: number; percentage: number };
  disk: Array<{
    mount: string;
    totalGB: number;
    usedGB: number;
    percentage: number;
  }>;
}

// Single combined command to minimize SSH round trips
const VITALS_COMMAND = [
  "echo '---OS---'",
  "(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME || uname -sr)",
  "echo '---UPTIME---'",
  "uptime",
  "echo '---NPROC---'",
  "(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)",
  "echo '---MEMORY---'",
  "free -b 2>/dev/null || vm_stat 2>/dev/null",
  "echo '---DISK---'",
  "df -P 2>/dev/null",
].join("; ");

export async function getSystemVitals(client: Client): Promise<SystemVitals> {
  const { stdout } = await execCommand(client, VITALS_COMMAND, 10_000);

  const sections = splitSections(stdout);

  return {
    os: parseOS(sections["OS"] ?? ""),
    uptime: parseUptime(sections["UPTIME"] ?? ""),
    cpu: {
      cores: parseCores(sections["NPROC"] ?? ""),
      loadAvg: parseLoadAvg(sections["UPTIME"] ?? ""),
    },
    memory: parseMemory(sections["MEMORY"] ?? ""),
    disk: parseDisk(sections["DISK"] ?? ""),
  };
}

function splitSections(output: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = output.split(/---(\w+)---/);
  // parts: ["before", "OS", "os content", "UPTIME", "uptime content", ...]
  for (let i = 1; i < parts.length - 1; i += 2) {
    sections[parts[i]] = parts[i + 1].trim();
  }
  return sections;
}

function parseOS(raw: string): string {
  // PRETTY_NAME="Ubuntu 22.04.3 LTS"
  const match = raw.match(/PRETTY_NAME="?([^"]+)"?/);
  if (match) return match[1].trim();
  // Fallback: raw uname output
  return raw.split("\n")[0]?.trim() || "Unknown";
}

function parseUptime(raw: string): string {
  // " 10:23:45 up 45 days,  3:21,  2 users,  load average: 1.20, 0.80, 0.60"
  const match = raw.match(/up\s+(.+?),\s+\d+\s+user/);
  if (match) return match[1].trim();
  // Fallback: try simpler pattern
  const fallback = raw.match(/up\s+(.+?)(?:,\s+load|$)/);
  if (fallback) return fallback[1].trim();
  return "unknown";
}

function parseLoadAvg(raw: string): [number, number, number] {
  const match = raw.match(/load average[s]?:\s*([\d.]+),?\s*([\d.]+),?\s*([\d.]+)/);
  if (match) {
    return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
  }
  return [0, 0, 0];
}

function parseCores(raw: string): number {
  const n = parseInt(raw.trim(), 10);
  return isNaN(n) ? 1 : n;
}

function parseMemory(raw: string): { totalMB: number; usedMB: number; percentage: number } {
  // Parse `free -b` output
  // Example:
  //               total        used        free      shared  buff/cache   available
  // Mem:     8267309056  3221225472  2147483648   134217728  2898800128  4638564352
  const lines = raw.split("\n");
  const memLine = lines.find((l) => l.startsWith("Mem:"));
  if (memLine) {
    const parts = memLine.split(/\s+/);
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    // If "available" column exists (column 7), use total-available for a more accurate "used"
    const available = parts[6] ? parseInt(parts[6], 10) : NaN;
    const effectiveUsed = !isNaN(available) ? total - available : used;

    const totalMB = Math.round(total / 1024 / 1024);
    const usedMB = Math.round(effectiveUsed / 1024 / 1024);
    const percentage = total > 0 ? Math.round((effectiveUsed / total) * 100) : 0;
    return { totalMB, usedMB, percentage };
  }

  return { totalMB: 0, usedMB: 0, percentage: 0 };
}

function parseDisk(
  raw: string
): Array<{ mount: string; totalGB: number; usedGB: number; percentage: number }> {
  // Parse `df -P` output (POSIX mode — one line per filesystem)
  // Filesystem    1024-blocks      Used Available Capacity Mounted on
  // /dev/sda1       20511356   9437184   9998880      49% /
  const lines = raw.split("\n").slice(1); // skip header
  const disks: Array<{ mount: string; totalGB: number; usedGB: number; percentage: number }> = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const mount = parts[5];
    const filesystem = parts[0];
    // Only include real filesystems (starting with / or containing `:` for NFS)
    if (!filesystem.startsWith("/") && !filesystem.includes(":")) continue;
    // Skip tiny pseudo-mounts
    if (mount.startsWith("/snap") || mount.startsWith("/boot/efi")) continue;

    const totalKB = parseInt(parts[1], 10);
    const usedKB = parseInt(parts[2], 10);
    const capacityStr = parts[4];
    const percentage = parseInt(capacityStr, 10);

    if (isNaN(totalKB) || isNaN(usedKB)) continue;

    disks.push({
      mount,
      totalGB: Math.round((totalKB / 1024 / 1024) * 10) / 10,
      usedGB: Math.round((usedKB / 1024 / 1024) * 10) / 10,
      percentage: isNaN(percentage) ? 0 : percentage,
    });
  }

  return disks;
}
