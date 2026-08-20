import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../../helpers";
import {
  startService,
  stopService,
  restartService,
  enableService,
  disableService,
  getServiceDetail,
  getServiceFileContent,
} from "../../../../../../../server/ssh/services";
import { coalesce } from "../../../../../../../server/lib/inflight";

/**
 * GET /api/fs/[cid]/services/[name]
 *
 * Default: service detail only (1 SSH exec). Unit file is NOT polled —
 * pass ?file=1 for a one-shot systemctl cat (React Query caches with
 * staleTime: Infinity on the client).
 *
 * Coalesced: concurrent requests within the coalesce window share one backend call.
 */
export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string; name: string }> }) {
  const { connectionId, name } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const wantFile = url.searchParams.get("file") === "1";

  return withSshErrorHandling(async () => {
    if (wantFile) {
      const cacheKey = `svc-file:${connectionId}:${name}`;
      return coalesce(cacheKey, async () => {
        const fileContent = await getServiceFileContent(result.client, name).catch(() => "");
        return NextResponse.json({ fileContent });
      });
    }

    const cacheKey = `svc-detail:${connectionId}:${name}`;
    return coalesce(cacheKey, async () => {
      const detail = await getServiceDetail(result.client, name);

      if (detail.loaded === "not-found" || detail.state === "unknown") {
        return NextResponse.json({ error: `Service not found: ${name}` }, { status: 404 });
      }

      return NextResponse.json(detail);
    });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string; name: string }> }) {
  const { connectionId, name } = await params;
  const result = getClient(connectionId);
  if ("error" in result) return result.error;

  const body = await request.json().catch(() => ({}));
  const action = body.action as string;

  return withSshErrorHandling(async () => {
    switch (action) {
      case "start":
        await startService(result.client, name);
        break;
      case "stop":
        await stopService(result.client, name);
        break;
      case "restart":
        await restartService(result.client, name);
        break;
      case "enable":
        await enableService(result.client, name);
        break;
      case "disable":
        await disableService(result.client, name);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  });
}
