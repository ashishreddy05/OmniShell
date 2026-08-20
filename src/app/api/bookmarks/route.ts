import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { bookmarkSchema } from "@/lib/validators";
import { nanoid } from "nanoid";

export async function GET() {
  try {
    const allBookmarks = await db.select().from(bookmarks);
    return NextResponse.json(allBookmarks);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = bookmarkSchema.parse(body);

    const id = nanoid();
    await db.insert(bookmarks).values({
      id,
      ...parsed,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
