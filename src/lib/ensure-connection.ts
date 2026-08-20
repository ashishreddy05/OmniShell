import { toast } from "sonner";
import { connectionsApi } from "@/lib/api-client";
import type { Connection } from "@/lib/db/schema";
import { useConnectionStore } from "@/stores/connection-store";

/**
 * Ensure SSH connection is active. Auto-connects if needed and sets active tab.
 * Pass connections from TanStack Query when available; otherwise fetches the list.
 */
export async function ensureConnection(
  targetConnectionId: string,
  connections?: Connection[],
): Promise<void> {
  const connStore = useConnectionStore.getState();
  const active = connStore.activeConnections.get(targetConnectionId);
  if (active?.status === "connected") {
    connStore.setActiveTab(targetConnectionId);
    return;
  }

  let connection = connections?.find((c) => c.id === targetConnectionId);
  if (!connection) {
    const list = await connectionsApi.list();
    connection = list.find((c) => c.id === targetConnectionId);
  }
  if (!connection) throw new Error(`Connection not found: ${targetConnectionId}`);

  toast.info(`Connecting to ${connection.name}...`);
  connStore.setConnectionStatus(targetConnectionId, connection, "connecting");
  try {
    await connectionsApi.connect(targetConnectionId);
    connStore.setConnectionStatus(targetConnectionId, connection, "connected");
    connStore.setActiveTab(targetConnectionId);
    toast.success(`Connected to ${connection.name}`);
  } catch (err) {
    connStore.setConnectionStatus(targetConnectionId, connection, "error", (err as Error).message);
    throw err;
  }
}
