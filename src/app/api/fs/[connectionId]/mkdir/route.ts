import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { createDirectory } from "../../../../../../server/ssh/sftp-operations";
import { pathSchema } from "@/lib/validators";

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const body = await request.json();
    const parsed = pathSchema.parse(body);

    await createDirectory(result.connectionId, result.client, parsed.path);
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
