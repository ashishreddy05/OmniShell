import { NextResponse } from "next/server";
import { getClient, withSshErrorHandling } from "../../helpers";
import {
  listServices,
  getServicesStatus,
  reloadDaemon,
  startService,
  stopService,
  restartService,
  enableService,
  disableService,
  deleteService,
  runCommand,
  searchServiceLogs,
  getServiceLogs,
  getServiceMemory,
} from "../../../../../../server/ssh/services";
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
    switch (action) {
      case "daemon-reload":
        await reloadDaemon(result.client);
        return NextResponse.json({ success: true });

      case "start":
      case "stop":
      case "restart":
      case "enable":
      case "disable": {
        const svcName = body.service as string;
        if (!svcName) return NextResponse.json({ error: "Missing service name" }, { status: 400 });
        switch (action) {
          case "start": await startService(result.client, svcName); break;
          case "stop": await stopService(result.client, svcName); break;
          case "restart": await restartService(result.client, svcName); break;
          case "enable": await enableService(result.client, svcName); break;
          case "disable": await disableService(result.client, svcName); break;
        }
        return NextResponse.json({ success: true });
      }

      case "delete": {
        const svcName = body.service as string;
        if (!svcName) return NextResponse.json({ error: "Missing service name" }, { status: 400 });
        await deleteService(result.client, svcName);
        return NextResponse.json({ success: true });
      }

      case "run-command": {
        const command = body.command as string;
        if (!command?.trim()) return NextResponse.json({ error: "Command is required" }, { status: 400 });
        const output = await runCommand(result.client, command);
        return NextResponse.json(output);
      }

      case "logs": {
        const svcName = body.service as string;
        if (!svcName) return NextResponse.json({ error: "Missing service name" }, { status: 400 });
        const { search, tail, startPad, endPad } = body;
        if (search) {
          const logs = await searchServiceLogs(result.client, svcName, search, {
            startPaddingSec: startPad ? parseInt(startPad, 10) || 0 : 0,
            endPaddingSec: endPad ? parseInt(endPad, 10) || 0 : 0,
          });
          return NextResponse.json(logs);
        }
        if (tail) {
          const logs = await getServiceLogs(result.client, svcName, parseInt(tail, 10) || 50);
          return NextResponse.json({ logs });
        }
        return NextResponse.json({ error: "Provide search or tail" }, { status: 400 });
      }

      case "memory": {
        const svcName = body.service as string;
        if (!svcName) return NextResponse.json({ error: "Missing service name" }, { status: 400 });
        const memoryMB = await coalesce(
          `svc-mem:${connectionId}:${svcName}`,
          () => getServiceMemory(result.client, svcName),
          1500,
        );
        return NextResponse.json({ memoryMB });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}
