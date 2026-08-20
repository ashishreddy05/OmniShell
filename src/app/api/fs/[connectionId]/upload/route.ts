import { NextResponse } from "next/server";
import { Readable } from "stream";
import Busboy from "@fastify/busboy";
import { getClient } from "../../helpers";
import { uploadFile, deleteFile, ensureDirectory } from "../../../../../../server/ssh/sftp-operations";
import * as path from "path";
import { MAX_FILE_SIZE } from "@/lib/constants";

interface FileUploadResult {
  name: string;
  success: boolean;
  error?: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    if (!request.body) {
      return NextResponse.json({ error: "No request body" }, { status: 400 });
    }

    const { remotePath, results } = await parseAndUpload(
      request.body,
      contentType,
      result.connectionId,
      result.client
    );

    if (!remotePath) {
      return NextResponse.json({ error: "Remote path is required" }, { status: 400 });
    }
    if (results.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const allSuccess = results.every((r) => r.success);
    return NextResponse.json({ success: allSuccess, results }, { status: allSuccess ? 200 : 207 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function parseAndUpload(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  connectionId: string,
  client: import("ssh2").Client
): Promise<{ remotePath: string | null; results: FileUploadResult[] }> {
  return new Promise((resolve, reject) => {
    let remotePath: string | null = null;
    let relativePath: string | null = null;
    const results: FileUploadResult[] = [];
    const uploadPromises: Promise<void>[] = [];

    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: MAX_FILE_SIZE },
    });

    busboy.on("field", (name: string, value: string) => {
      if (name === "path") {
        remotePath = value;
      } else if (name === "relativePath") {
        relativePath = value;
      }
    });

    // @fastify/busboy v3: file(fieldname, stream, filename, encoding, mimeType)
    busboy.on("file", (_name: string, stream: NodeJS.ReadableStream, filename: string) => {
      let truncated = false;

      stream.on("limit", () => {
        truncated = true;
      });

      // Convert Node readable to Web ReadableStream for uploadFile()
      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          stream.on("end", () => {
            controller.close();
          });
          stream.on("error", (err: Error) => {
            controller.error(err);
          });
        },
      });

      const uploadPromise = (async () => {
        // remotePath field is appended before files in the client FormData,
        // so it should already be parsed. Wait briefly as a safety net.
        let waitAttempts = 0;
        while (!remotePath && waitAttempts < 50) {
          await new Promise((r) => setTimeout(r, 10));
          waitAttempts++;
        }

        if (!remotePath) {
          results.push({ name: filename, success: false, error: "Remote path not provided" });
          stream.resume();
          return;
        }

        // Use relativePath for folder uploads, fallback to just filename
        const filePath = relativePath || filename;
        const fullPath = path.posix.join(remotePath, filePath);

        try {
          // Create parent directories if uploading into a subfolder
          const parentDir = path.posix.dirname(fullPath);
          if (parentDir !== remotePath) {
            await ensureDirectory(connectionId, client, parentDir);
          }

          await uploadFile(connectionId, client, fullPath, webStream, 0);

          if (truncated) {
            try { await deleteFile(connectionId, client, fullPath); } catch {}
            results.push({
              name: filename,
              success: false,
              error: `File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`,
            });
          } else {
            results.push({ name: filename, success: true });
          }
        } catch (err) {
          // Clean up partial file on remote
          try { await deleteFile(connectionId, client, fullPath); } catch {}
          results.push({ name: filename, success: false, error: (err as Error).message });
        }
      })();

      uploadPromises.push(uploadPromise);
    });

    busboy.on("finish", () => {
      Promise.all(uploadPromises)
        .then(() => resolve({ remotePath, results }))
        .catch(reject);
    });

    busboy.on("error", (err: Error) => {
      reject(err);
    });

    // Pipe the Web ReadableStream into busboy (Node Writable)
    const nodeReadable = Readable.fromWeb(body as import("stream/web").ReadableStream);
    nodeReadable.pipe(busboy);
  });
}
