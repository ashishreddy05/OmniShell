import type { WebSocket } from "ws";
import type { WSMessage } from "./index";
import { sendMessage } from "./index";

// Transfer progress is primarily pushed from the API routes during upload/download
// This handler manages client-side transfer control (cancel, pause)

const TRANSFER_TTL_MS = 30 * 60 * 1000; // 30 minutes

const activeTransfers = new Map<string, { cancelled: boolean; createdAt: number }>();

export function registerTransfer(transferId: string): { cancelled: boolean; createdAt: number } {
  const state = { cancelled: false, createdAt: Date.now() };
  activeTransfers.set(transferId, state);
  return state;
}

export function unregisterTransfer(transferId: string) {
  activeTransfers.delete(transferId);
}

export function cleanupStaleTransfers() {
  const now = Date.now();
  for (const [id, state] of activeTransfers) {
    if (now - state.createdAt > TRANSFER_TTL_MS) {
      activeTransfers.delete(id);
    }
  }
}

export function emitTransferProgress(
  ws: WebSocket,
  connectionId: string,
  transferId: string,
  fileName: string,
  direction: "upload" | "download",
  bytesTransferred: number,
  totalBytes: number
) {
  const percentage = totalBytes > 0 ? Math.round((bytesTransferred / totalBytes) * 100) : 0;
  sendMessage(ws, {
    type: "transfer:progress",
    connectionId,
    payload: {
      transferId,
      fileName,
      direction,
      bytesTransferred,
      totalBytes,
      percentage,
    },
  });
}

export function emitTransferComplete(ws: WebSocket, connectionId: string, transferId: string, fileName: string) {
  unregisterTransfer(transferId);
  sendMessage(ws, {
    type: "transfer:complete",
    connectionId,
    payload: { transferId, fileName },
  });
}

export function emitTransferError(ws: WebSocket, connectionId: string, transferId: string, message: string) {
  unregisterTransfer(transferId);
  sendMessage(ws, {
    type: "transfer:error",
    connectionId,
    payload: { transferId, message },
  });
}

export async function handleTransferMessage(ws: WebSocket, message: WSMessage) {
  const { type, payload, id } = message;

  switch (type) {
    case "transfer:cancel": {
      const transferId = payload.transferId as string;
      const state = activeTransfers.get(transferId);
      if (state) {
        state.cancelled = true;
        sendMessage(ws, {
          type: "transfer:cancelled",
          connectionId: message.connectionId,
          id,
          payload: { transferId },
        });
      }
      break;
    }
  }
}
