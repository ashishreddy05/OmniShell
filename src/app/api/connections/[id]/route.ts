import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { connectionUpdateSchema } from "@/lib/validators";
import { encrypt } from "../../../../../server/crypto";
import { eq } from "drizzle-orm";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [connection] = await db.select().from(connections).where(eq(connections.id, id));
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const { passphrase, ...safe } = connection;
    return NextResponse.json({ ...safe, hasPassphrase: !!passphrase });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = connectionUpdateSchema.parse(body);

    const [existing] = await db.select().from(connections).where(eq(connections.id, id));
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const updateData = {
      ...parsed,
      passphrase: parsed.passphrase !== undefined
        ? (parsed.passphrase ? encrypt(parsed.passphrase) : null)
        : undefined,
      updatedAt: new Date().toISOString(),
    };

    await db
      .update(connections)
      .set(updateData)
      .where(eq(connections.id, id));

    const [updated] = await db.select().from(connections).where(eq(connections.id, id));
    const { passphrase, ...safe } = updated;
    return NextResponse.json({ ...safe, hasPassphrase: !!passphrase });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [existing] = await db.select().from(connections).where(eq(connections.id, id));
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await db.delete(connections).where(eq(connections.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
