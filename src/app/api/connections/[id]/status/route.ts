import { NextResponse } from "next/server";
import { connectionPool } from "../../../../../../server/ssh/connection-pool";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const status = connectionPool.getStatus(id);
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
