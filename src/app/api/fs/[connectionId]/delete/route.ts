import { NextResponse } from "next/server";
import { getClient } from "../../helpers";
import { deleteFile, deleteDirectory, statFile } from "../../../../../../server/ssh/sftp-operations";
import { deleteSchema } from "@/lib/validators";

export async function DELETE(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const result = getClient(connectionId);
    if ("error" in result) return result.error;

    const body = await request.json();
    const parsed = deleteSchema.parse(body);

    const stat = await statFile(result.connectionId, result.client, parsed.path);

    if (stat.type === "directory") {
      if (!parsed.recursive) {
        return NextResponse.json(
          { error: "Cannot delete directory without recursive flag" },
          { status: 400 }
        );
      }
      await deleteDirectory(result.connectionId, result.client, parsed.path);
    } else {
      await deleteFile(result.connectionId, result.client, parsed.path);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
