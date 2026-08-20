import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { chmod } from "../../../../../../server/ssh/sftp-operations";

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const body = await request.json().catch(() => ({}));
    const paths = Array.isArray(body.paths) ? body.paths : [body.path].filter(Boolean);
    const mode = String(body.mode || "");

    if (!paths.length || !mode) {
      return NextResponse.json({ error: "paths[] and mode are required" }, { status: 400 });
    }

    await chmod(result.connectionId, result.client, paths, mode);
    return NextResponse.json({ success: true, count: paths.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
