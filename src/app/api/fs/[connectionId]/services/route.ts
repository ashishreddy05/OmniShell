import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../helpers";
import { listServices, getServicesStatus, reloadDaemon } from "../../../../../../server/ssh/services";
import { coalesce } from "../../../../../../server/lib/inflight";

export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  const { searchParams } = new URL(request.url);
  const namesParam = searchParams.get("names");

  return withSshErrorHandling(async () => {
    if (namesParam) {
      const names = namesParam.split(",").map((n) => n.trim()).filter(Boolean);
      // Coalesce: many components poll status-batch in parallel. Share the result.
      const services = await coalesce(
        `svc-status:${connectionId}:${namesParam}`,
        () => getServicesStatus(result.client, names),
        2000,
      );
      return NextResponse.json({ services });
    }

    const services = await coalesce(
      `svc-list:${connectionId}`,
      () => listServices(result.client),
      3000,
    );
    return NextResponse.json({ services });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  const body = await request.json().catch(() => ({}));
  const action = body.action as string;

  return withSshErrorHandling(async () => {
    if (action === "daemon-reload") {
      await reloadDaemon(result.client);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  });
}
