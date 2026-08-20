import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { connectionPool } from "../../../../../../server/ssh/connection-pool";
import { acquireSftp, releaseSftp } from "../../../../../../server/ssh/sftp-pool";
import { decrypt } from "../../../../../../server/crypto";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [connection] = await db.select().from(connections).where(eq(connections.id, id));
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const client = await connectionPool.connect({
      id: connection.id,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      privateKeyPath: connection.privateKeyPath,
      passphrase: connection.passphrase ? decrypt(connection.passphrase) : undefined,
    });

    // Pre-warm the SFTP session so the first listing/read doesn't pay
    // the channel negotiation cost at request time.
    acquireSftp(connection.id, client)
      .then(() => releaseSftp(connection.id))
      .catch(() => {/* non-fatal — will be created on demand */});

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
