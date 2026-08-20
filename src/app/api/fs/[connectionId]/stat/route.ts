import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { statFile } from "../../../../../../server/ssh/sftp-operations";

export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const stats = await statFile(result.connectionId, result.client, path);
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
