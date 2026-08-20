import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { readFile, statFile } from "../../../../../../server/ssh/sftp-operations";
import { MAX_EDITOR_FILE_SIZE } from "@/lib/constants";

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

    const stat = await statFile(result.connectionId, result.client, path);
    if (stat.size > MAX_EDITOR_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum is ${MAX_EDITOR_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    const buffer = await readFile(result.connectionId, result.client, path);
    const content = buffer.toString("utf-8");
    return NextResponse.json({ content, encoding: "utf-8" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
