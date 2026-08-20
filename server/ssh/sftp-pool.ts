import type { Client, SFTPWrapper } from "ssh2";

interface SftpEntry {
  sftp: SFTPWrapper;
  refCount: number;
  closed: boolean;
}

// Use globalThis so the pool is shared between Next.js API routes (Turbopack) and
// the custom server's WebSocket handler, which evaluate this module separately.
const sftpPool: Map<string, SftpEntry> =
  ((globalThis as Record<string, unknown>).__sftpPool as Map<string, SftpEntry>)
  ?? ((globalThis as Record<string, unknown>).__sftpPool = new Map<string, SftpEntry>());
const pendingCreation: Map<string, Promise<SFTPWrapper>> =
  ((globalThis as Record<string, unknown>).__sftpPending as Map<string, Promise<SFTPWrapper>>)
  ?? ((globalThis as Record<string, unknown>).__sftpPending = new Map<string, Promise<SFTPWrapper>>());

const ACQUIRE_TIMEOUT_MS = 10_000;

async function createSftpSession(connectionId: string, client: Client): Promise<SFTPWrapper> {
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("SFTP session acquisition timed out (10s)"));
    }, ACQUIRE_TIMEOUT_MS);

    client.sftp((err, sftp) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve(sftp);
    });
  });

  const entry: SftpEntry = { sftp, refCount: 0, closed: false };

  sftp.on("close", () => {
    entry.closed = true;
    sftpPool.delete(connectionId);
  });

  sftp.on("error", (err: Error) => {
    console.error(`[SFTP Pool] Error on ${connectionId}:`, err.message);
    entry.closed = true;
    sftpPool.delete(connectionId);
  });

  sftpPool.set(connectionId, entry);
  return sftp;
}

export async function acquireSftp(connectionId: string, client: Client): Promise<SFTPWrapper> {
  const existing = sftpPool.get(connectionId);
  if (existing && !existing.closed) {
    existing.refCount++;
    return existing.sftp;
  }

  // If another caller is already creating one, wait for it
  const pending = pendingCreation.get(connectionId);
  if (pending) {
    const sftp = await pending;
    const entry = sftpPool.get(connectionId);
    if (entry && !entry.closed) {
      entry.refCount++;
      return sftp;
    }
  }

  const creationPromise = createSftpSession(connectionId, client);
  pendingCreation.set(connectionId, creationPromise);

  try {
    const sftp = await creationPromise;
    const entry = sftpPool.get(connectionId)!;
    entry.refCount++;
    return sftp;
  } finally {
    pendingCreation.delete(connectionId);
  }
}

export function releaseSftp(connectionId: string): void {
  const entry = sftpPool.get(connectionId);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
}

export function destroySftpForConnection(connectionId: string): void {
  const entry = sftpPool.get(connectionId);
  if (entry && !entry.closed) {
    entry.sftp.end();
    entry.closed = true;
  }
  sftpPool.delete(connectionId);
  pendingCreation.delete(connectionId);
}
