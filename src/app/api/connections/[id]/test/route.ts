import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import { readPrivateKey, validateKeyPath } from "../../../../../../server/ssh/key-manager";
import { decrypt } from "../../../../../../server/crypto";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [connection] = await db.select().from(connections).where(eq(connections.id, id));
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await validateKeyPath(connection.privateKeyPath);
    const privateKey = readPrivateKey(connection.privateKeyPath);

    const result = await new Promise<{ success: boolean; message: string }>((resolve) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        client.end();
        resolve({ success: false, message: "Connection timed out" });
      }, 10000);

      client.on("ready", () => {
        clearTimeout(timeout);
        client.end();
        resolve({ success: true, message: "Connection successful" });
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ success: false, message: err.message });
      });

      client.connect({
        host: connection.host,
        port: connection.port,
        username: connection.username,
        privateKey,
        passphrase: connection.passphrase ? decrypt(connection.passphrase) : undefined,
        readyTimeout: 10000,
      });
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 });
  }
}
