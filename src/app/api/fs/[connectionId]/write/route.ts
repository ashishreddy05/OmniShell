import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../helpers";
import { writeFile } from "../../../../../../server/ssh/sftp-operations";
import { writeFileSchema } from "@/lib/validators";

export async function PUT(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  try {
    const body = await request.json();
    const parsed = writeFileSchema.parse(body);

    return withSshErrorHandling(async () => {
      await writeFile(result.connectionId, result.client, parsed.path, parsed.content, parsed.encoding as BufferEncoding);
      return NextResponse.json({ success: true });
    });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
