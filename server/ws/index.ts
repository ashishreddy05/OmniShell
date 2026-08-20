import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { handleTerminalMessage } from "./terminal.handler";
import { handleTransferMessage, cleanupStaleTransfers } from "./transfer.handler";
import { handleMonitorMessage, cleanupMonitorSessions } from "./monitor.handler";
import { handleLogsMessage, cleanupLogSessions } from "./logs.handler";
import { poolEvents } from "../ssh/connection-pool";

const HEARTBEAT_INTERVAL = 30_000;

export interface WSMessage {
  type: string;
  id?: string;
  connectionId: string;
  payload: Record<string, unknown>;
}

export interface WSResponse {
  type: string;
  id?: string;
  connectionId?: string;
  payload: Record<string, unknown>;
  error?: string;
}

const clients = new Set<WebSocket>();

export function sendMessage(ws: WebSocket, message: WSResponse) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function sendError(ws: WebSocket, type: string, error: string, id?: string, connectionId?: string) {
  sendMessage(ws, { type, error, id, connectionId, payload: {} });
}

function broadcast(message: WSResponse) {
  for (const ws of clients) {
    sendMessage(ws, message);
  }
}

export function handleWebSocketConnection(ws: WebSocket, _request: IncomingMessage) {
  console.log("[WS] Client connected");
  clients.add(ws);

  let alive = true;
  const heartbeatTimer = setInterval(() => {
    if (!alive) {
      console.log("[WS] Heartbeat timeout, terminating connection");
      ws.terminate();
      return;
    }
    alive = false;
    sendMessage(ws, { type: "heartbeat:ping", payload: {} });
  }, HEARTBEAT_INTERVAL);

  ws.on("message", (data) => {
    let message: WSMessage;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendError(ws, "error", "Invalid JSON message");
      return;
    }

    if (!message.type) {
      sendError(ws, "error", "Missing message type");
      return;
    }

    // Handle heartbeat pong
    if (message.type === "heartbeat:pong") {
      alive = true;
      return;
    }

    const [domain] = message.type.split(":");

    switch (domain) {
      case "terminal":
        handleTerminalMessage(ws, message);
        break;
      case "transfer":
        handleTransferMessage(ws, message);
        break;
      case "monitor":
        handleMonitorMessage(ws, message);
        break;
      case "logs":
        handleLogsMessage(ws, message);
        break;
      default:
        sendError(ws, "error", `Unknown message domain: ${domain}`);
    }
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    clearInterval(heartbeatTimer);
    clients.delete(ws);
    handleTerminalMessage(ws, {
      type: "terminal:cleanup",
      connectionId: "__all__",
      payload: {},
    });
    cleanupStaleTransfers();
    cleanupMonitorSessions(ws);
    cleanupLogSessions(ws);
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err.message);
    clearInterval(heartbeatTimer);
    clients.delete(ws);
  });
}

// Subscribe to connection pool events and broadcast to all WS clients
poolEvents.on("connection:connected", (connectionId: string) => {
  broadcast({
    type: "connection:status",
    payload: { connectionId, status: "connected" },
  });
});

poolEvents.on("connection:disconnected", (connectionId: string, reason: string) => {
  broadcast({
    type: "connection:status",
    payload: { connectionId, status: "disconnected", reason },
  });
});
