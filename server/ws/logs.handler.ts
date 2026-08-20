import type { WebSocket } from "ws";
import type { WSMessage } from "./index";
import { connectionPool } from "../ssh/connection-pool";
import { streamServiceLogs, type LogStreamHandle } from "../ssh/services";
import { sendMessage, sendError } from "./index";
import { debugLog } from "../debug-log";

const wsOwners = new Map<string, Set<string>>();
const LOGS_KEY = Symbol("logsKey");

function getWsKey(ws: WebSocket): string {
  return (ws as unknown as { [LOGS_KEY]?: string })[LOGS_KEY]
    ??= `logs-${Math.random().toString(36).slice(2)}`;
}

interface LogSession {
  connectionId: string;
  serviceName: string;
  wsKey: string;
  handle: LogStreamHandle;
}

const logSessions = new Map<string, LogSession>();

function sessionKey(connectionId: string, serviceName: string): string {
  return `${connectionId}:${serviceName}`;
}

function clearLogSession(key: string) {
  const session = logSessions.get(key);
  if (!session) return;
  try { session.handle.abort(); } catch { /* noop */ }
  logSessions.delete(key);
  const owners = wsOwners.get(session.wsKey);
  if (owners) {
    owners.delete(key);
    if (owners.size === 0) wsOwners.delete(session.wsKey);
  }
}

function registerSession(key: string, ws: WebSocket, session: LogSession) {
  logSessions.set(key, session);
  const wsKey = getWsKey(ws);
  session.wsKey = wsKey;
  if (!wsOwners.has(wsKey)) wsOwners.set(wsKey, new Set());
  wsOwners.get(wsKey)!.add(key);
}

export function handleLogsMessage(ws: WebSocket, message: WSMessage) {
  const { type, connectionId, payload, id } = message;
  if (!payload) {
    sendError(ws, "logs:error", "Missing payload", id, connectionId);
    return;
  }

  switch (type) {
    case "logs:start": {
      const serviceName = payload.serviceName as string;
      if (!serviceName) {
        sendError(ws, "logs:error", "Missing serviceName", id, connectionId);
        return;
      }
      const historyLines =
        typeof payload.historyLines === "number" ? payload.historyLines : undefined;
      const key = sessionKey(connectionId, serviceName);
      clearLogSession(key);

      const client = connectionPool.get(connectionId);
      if (!client) {
        sendError(ws, "logs:error", "Connection not available", id, connectionId);
        return;
      }

      debugLog(`[Logs] Starting stream for ${serviceName} on ${connectionId}`);

      const wsKey = getWsKey(ws);
      const bufferChunks: string[] = [];
      let bufferLen = 0;
      const flushBuffer = () => {
        if (bufferChunks.length === 0) return;
        sendMessage(ws, {
          type: "logs:data",
          connectionId,
          payload: { serviceName, chunk: bufferChunks.join("") },
        });
        bufferChunks.length = 0;
        bufferLen = 0;
      };

      const pendingSession: LogSession = {
        connectionId,
        serviceName,
        wsKey,
        handle: { stream: { close: () => {} }, abort: () => {} },
      };

      const handle = streamServiceLogs(
        client,
        serviceName,
        (chunk) => {
          bufferChunks.push(chunk);
          bufferLen += chunk.length;
          if (bufferLen > 4096 || chunk.includes("\n")) {
            flushBuffer();
          }
        },
        (err) => {
          flushBuffer();
          sendError(ws, "logs:error", `Stream error: ${err.message}`, id, connectionId);
        },
        () => {
          flushBuffer();
          clearLogSession(key);
          sendMessage(ws, {
            type: "logs:closed",
            id, connectionId,
            payload: { serviceName },
          });
        },
        { historyLines },
      );

      pendingSession.handle = handle;
      registerSession(key, ws, pendingSession);

      sendMessage(ws, {
        type: "logs:started", id, connectionId,
        payload: { serviceName },
      });
      break;
    }

    case "logs:stop": {
      const serviceName = payload.serviceName as string;
      if (!serviceName) {
        sendError(ws, "logs:error", "Missing serviceName", id, connectionId);
        return;
      }
      const key = sessionKey(connectionId, serviceName);
      debugLog(`[Logs] Stopping stream for ${serviceName} on ${connectionId}`);
      clearLogSession(key);
      sendMessage(ws, {
        type: "logs:stopped", id, connectionId,
        payload: { serviceName },
      });
      break;
    }
  }
}

export function cleanupLogSessions(ws: WebSocket) {
  const wsKey = getWsKey(ws);
  const owned = wsOwners.get(wsKey);
  if (!owned) return;
  for (const key of owned) {
    const session = logSessions.get(key);
    if (session) {
      try { session.handle.abort(); } catch { /* noop */ }
      logSessions.delete(key);
    }
  }
  wsOwners.delete(wsKey);
}
