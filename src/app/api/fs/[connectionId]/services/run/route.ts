import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../../helpers";
import { runCommand } from "../../../../../../../server/ssh/services";

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  try {
    const body = await request.json().catch(() => ({}));
    const command = body.command as string;
    if (!command?.trim()) {
      return NextResponse.json({ error: "Command is required" }, { status: 400 });
    }

    return withSshErrorHandling(async () => {
      const output = await runCommand(result.client, command);
      return NextResponse.json(output);
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
