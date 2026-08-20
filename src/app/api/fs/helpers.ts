import { NextResponse } from "next/server";
import { connectionPool } from "../../../../server/ssh/connection-pool";
import type { Client } from "ssh2";

export function getClient(connectionId: string): { client: Client; connectionId: string } | { error: NextResponse } {
  const client = connectionPool.get(connectionId);
  if (!client) {
    return { error: NextResponse.json({ error: "Connection not active. Please connect first." }, { status: 400 }) };
  }
  return { client, connectionId };
}

/**
 * Wraps an SSH operation so that "channel open failure" errors return a 503 with
 * a clear, actionable message instead of a generic 500. The client can show
 * "too many concurrent SSH operations — try again in a moment".
 */
export async function withSshErrorHandling<T>(
  operation: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await operation();
  } catch (err) {
    const e = err as Error;
    const msg = e.message || "";
    const isChannelSaturation =
      /Channel open failure|open failed|MaxSessions|Resource shortage/i.test(msg);
    const isConnectionLost = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|Connection lost|disconnected/i.test(msg);
    if (isChannelSaturation) {
      return NextResponse.json(
        {
          error: "SSH channel limit reached (server MaxSessions). " +
                  "Too many concurrent operations on this connection. " +
                  "Retried automatically — try again in a few seconds.",
          code: "SSH_CHANNEL_SATURATION",
          retriable: true,
        },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }
    if (isConnectionLost) {
      return NextResponse.json(
        {
          error: "SSH connection lost. The server may have closed the connection or the network is unstable.",
          code: "SSH_CONNECTION_LOST",
          retriable: true,
        },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    throw err;
  }
}
