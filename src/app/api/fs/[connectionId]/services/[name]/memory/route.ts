import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../../../helpers";
import { getServiceMemory } from "../../../../../../../../server/ssh/services";
import { coalesce } from "../../../../../../../../server/lib/inflight";

export async function GET(_request: Request, { params }: { params: Promise<{ connectionId: string; name: string }> }) {
  const { connectionId, name } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  return withSshErrorHandling(async () => {
    // Coalesce: multiple components polling memory for the same service share one SSH call
    const memoryMB = await coalesce(
      `svc-mem:${connectionId}:${name}`,
      () => getServiceMemory(result.client, name),
      1500,
    );
    return NextResponse.json({ memoryMB });
  });
}
