import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../helpers";
import { getSystemVitals } from "../../../../../../server/ssh/vitals";
import { coalesce } from "../../../../../../server/lib/inflight";

export async function GET(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  return withSshErrorHandling(async () => {
    // Coalesce: status bar poll + popover refresh share one SSH call
    const vitals = await coalesce(
      `vitals:${connectionId}`,
      () => getSystemVitals(result.client),
      3000,
    );
    return NextResponse.json(vitals);
  });
}
