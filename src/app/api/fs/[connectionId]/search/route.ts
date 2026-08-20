import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { searchFiles, type SearchFileResult } from "../../../../../../server/ssh/sftp-operations";

export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    const basePath = url.searchParams.get("path") || "/";
    const type = (url.searchParams.get("type") || "name") as "name" | "content";

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const results = await searchFiles(result.connectionId, result.client, basePath, query, type);
    return NextResponse.json({ results } satisfies { results: SearchFileResult[] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
