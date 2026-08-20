import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useEditorStore } from "@/stores/editor-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUploadStore } from "@/stores/upload-store";
import { connectionsApi } from "@/lib/api-client";

export async function disconnectAndCleanup(connectionId: string): Promise<void> {
  // Call server disconnect (best-effort)
  await connectionsApi.disconnect(connectionId).catch(() => {});

  // Clean all stores
  useConnectionStore.getState().removeConnection(connectionId);
  useExplorerStore.getState().removeExplorer(connectionId);
  useEditorStore.getState().closeAllForConnection(connectionId);
  useTerminalStore.getState().clearForConnection(connectionId);

  // Remove uploads for this connection
  const { uploads, removeUpload } = useUploadStore.getState();
  for (const upload of uploads) {
    if (upload.connectionId === connectionId) {
      removeUpload(upload.id);
    }
  }
}
