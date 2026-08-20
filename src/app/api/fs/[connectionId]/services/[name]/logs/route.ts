import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../../../helpers";
import { searchServiceLogs, getServiceLogs } from "../../../../../../../../server/ssh/services";

export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string; name: string }> }) {
  const { connectionId, name } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const search = url.searchParams.get("search");
  const tail = url.searchParams.get("tail");
  const startPad = url.searchParams.get("startPad");
  const endPad = url.searchParams.get("endPad");

  if (search) {
    return withSshErrorHandling(async () => {
      const logs = await searchServiceLogs(result.client, name, search, {
        startPaddingSec: startPad ? parseInt(startPad, 10) || 0 : 0,
        endPaddingSec: endPad ? parseInt(endPad, 10) || 0 : 0,
      });
      return NextResponse.json(logs);
    });
  }

  if (tail) {
    return withSshErrorHandling(async () => {
      const logs = await getServiceLogs(result.client, name, parseInt(tail, 10) || 50);
      return NextResponse.json({ logs });
    });
  }

  return NextResponse.json({ error: "Provide ?search= or ?tail=" }, { status: 400 });
}
