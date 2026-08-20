import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [existing] = await db.select().from(bookmarks).where(eq(bookmarks.id, id));
    if (!existing) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
    }

    await db.delete(bookmarks).where(eq(bookmarks.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
