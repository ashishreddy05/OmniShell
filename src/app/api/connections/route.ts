import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { connectionSchema } from "@/lib/validators";
import { encrypt } from "../../../../server/crypto";
import { nanoid } from "nanoid";

export async function GET() {
  try {
    const allConnections = await db.select().from(connections);
    // Redact sensitive fields
    const safe = allConnections.map(({ passphrase, ...rest }) => ({
      ...rest,
      hasPassphrase: !!passphrase,
    }));
    return NextResponse.json(safe);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = connectionSchema.parse(body);

    const id = nanoid();
    const newConnection = {
      id,
      ...parsed,
      passphrase: parsed.passphrase ? encrypt(parsed.passphrase) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.insert(connections).values(newConnection);

    return NextResponse.json({ ...newConnection, passphrase: undefined }, { status: 201 });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
