import type { Client } from "ssh2";

const MAX_CONCURRENT = 8;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 400;
const MAX_QUEUE_SIZE = 20;
const QUEUE_TIMEOUT_MS = 20_000;
const queues = new WeakMap<Client, Array<{ run: () => void; reject: (err: Error) => void; queuedAt: number }>>();
const actives = new WeakMap<Client, number>();
const reservedSlots = new WeakMap<Client, number>();

function effectiveActive(client: Client): number {
  return (actives.get(client) || 0) + (reservedSlots.get(client) || 0);
}

function isChannelOpenError(err: Error | undefined): boolean {
  if (!err) return false;
  const msg = err.message || "";
  return /Channel open failure|open failed|ECONNRESET|ETIMEDOUT|Resource shortage|MaxSessions/i.test(msg);
}

export function reserveSlot(client: Client): () => void {
  const current = reservedSlots.get(client) || 0;
  reservedSlots.set(client, current + 1);
  return () => {
    const currentSlots = reservedSlots.get(client) || 0;
    reservedSlots.set(client, Math.max(0, currentSlots - 1));
    getNext(client);
  };
}

function decrActive(client: Client) {
  const current = actives.get(client) || 0;
  actives.set(client, Math.max(0, current - 1));
}

function getNext(client: Client) {
  const q = queues.get(client);
  const ea = effectiveActive(client);
  if (!q || q.length === 0 || ea >= MAX_CONCURRENT) return;
  const entry = q.shift()!;
  const waitMs = Date.now() - entry.queuedAt;
  if (waitMs > QUEUE_TIMEOUT_MS) {
    entry.reject(new Error(`SSH exec timed out in queue after ${waitMs}ms`));
    getNext(client);
    return;
  }
  actives.set(client, (actives.get(client) || 0) + 1);
  entry.run();
}

function execOnce(
  client: Client,
  command: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const run = () => {
      let done = false;
      const finish = () => {
        decrActive(client);
        getNext(client);
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        finish();
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          finish();
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("close", () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          finish();
          resolve({ stdout, stderr });
        });

        stream.on("error", (streamErr: Error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          finish();
          reject(streamErr);
        });
      });
    };

    const ea = effectiveActive(client);
    if (ea >= MAX_CONCURRENT) {
      if (!queues.has(client)) queues.set(client, []);
      const q = queues.get(client)!;
      if (q.length >= MAX_QUEUE_SIZE) {
        reject(new Error("SSH exec queue is full. Too many concurrent operations."));
        return;
      }
      q.push({ run, reject, queuedAt: Date.now() });
    } else {
      actives.set(client, (actives.get(client) || 0) + 1);
      run();
    }
  });
}

export async function execCommand(
  client: Client,
  command: string,
  timeoutMs = 10_000
): Promise<{ stdout: string; stderr: string }> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await execOnce(client, command, timeoutMs);
    } catch (err) {
      const e = err as Error;
      if (!isChannelOpenError(e) || attempt === MAX_RETRIES) {
        throw e;
      }
      lastErr = e;
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("SSH exec failed");
}
