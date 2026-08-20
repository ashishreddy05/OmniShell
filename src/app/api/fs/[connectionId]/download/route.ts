import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { createDownloadStream, statFile } from "../../../../../../server/ssh/sftp-operations";
import * as path from "path";

export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const stat = await statFile(result.connectionId, result.client, filePath);
    if (stat.type === "directory") {
      return NextResponse.json({ error: "Cannot download directories directly" }, { status: 400 });
    }

    const { stream } = await createDownloadStream(result.connectionId, result.client, filePath);
    const fileName = path.posix.basename(filePath);

    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        stream.on("end", () => {
          controller.close();
        });
        stream.on("error", (err) => {
          controller.error(err);
        });
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": stat.size.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
