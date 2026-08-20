import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { readFile, statFile } from "../../../../../../server/ssh/sftp-operations";
import { MAX_PREVIEW_SIZE, getFileCategory } from "@/lib/constants";
import * as path from "path";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  bmp: "image/bmp", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg",
  mov: "video/quicktime", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
  aac: "audio/aac", m4a: "audio/mp4",
  pdf: "application/pdf",
};

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
    if (stat.size > MAX_PREVIEW_SIZE) {
      return NextResponse.json({ error: "File too large for preview" }, { status: 413 });
    }

    const fileName = path.posix.basename(filePath);
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    const category = getFileCategory(fileName);

    if (category === "unknown") {
      return NextResponse.json({ error: "Unsupported file type for preview" }, { status: 415 });
    }

    const buffer = await readFile(result.connectionId, result.client, filePath);
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
