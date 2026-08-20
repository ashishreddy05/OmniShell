import { NextResponse } from "next/server";
import { connectionPool } from "../../../../../../server/ssh/connection-pool";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    connectionPool.disconnect(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
