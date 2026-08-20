import type { WebSocket } from "ws";
import type { WSMessage } from "./index";
import { connectionPool } from "../ssh/connection-pool";
import { getServiceMemory, getServicesMemory } from "../ssh/services";
import { sendMessage, sendError } from "./index";
import { debugLog, debugWarn, debugError } from "../debug-log";

// Track which WS owns which monitor sessions
const wsOwners = new Map<string, Set<string>>();
const MONITOR_KEY = Symbol("monitorKey");

function getWsKey(ws: WebSocket): string {
  return (ws as unknown as { [MONITOR_KEY]?: string })[MONITOR_KEY]
    ??= `mon-${Math.random().toString(36).slice(2)}`;
}

interface MonitorSession {
  connectionId: string;
  wsKey: string;
  interval: number;
  timer: ReturnType<typeof setInterval>;
}

const monitorSessions = new Map<string, MonitorSession>();

function clearMonitorSession(sessionKey: string) {
  const session = monitorSessions.get(sessionKey);
  if (!session) return;
  clearInterval(session.timer);
  monitorSessions.delete(sessionKey);
  const owners = wsOwners.get(session.wsKey);
  if (owners) {
    owners.delete(sessionKey);
    if (owners.size === 0) wsOwners.delete(session.wsKey);
  }
}

function registerSession(sessionKey: string, ws: WebSocket, session: MonitorSession) {
  monitorSessions.set(sessionKey, session);
  const wsKey = getWsKey(ws);
  if (!wsOwners.has(wsKey)) wsOwners.set(wsKey, new Set());
  wsOwners.get(wsKey)!.add(sessionKey);
}

export function handleMonitorMessage(ws: WebSocket, message: WSMessage) {
  const { type, connectionId, payload, id } = message;
  if (!payload) {
    sendError(ws, "monitor:error", "Missing payload", id, connectionId);
    return;
  }

  switch (type) {
    case "monitor:start": {
      const serviceName = payload.serviceName as string;
      if (!serviceName) {
        sendError(ws, "monitor:error", "Missing serviceName", id, connectionId);
        return;
      }
      const interval = Math.max(2000, Math.min((payload.interval as number) || 2000, 30000));
      const sessionKey = `${connectionId}:${serviceName}`;

      clearMonitorSession(sessionKey);

      debugLog(`[Monitor] Starting monitor for ${serviceName} on ${connectionId} (every ${interval}ms)`);

      const wsKey = getWsKey(ws);
      const timer = setInterval(async () => {
        try {
          const client = connectionPool.get(connectionId);
          if (!client) {
            debugWarn(`[Monitor] Connection ${connectionId} lost, stopping ${serviceName}`);
            sendError(ws, "monitor:error", "Connection lost", id, connectionId);
            clearMonitorSession(sessionKey);
            return;
          }

          const memoryMB = await getServiceMemory(client, serviceName);
          debugLog(`[Monitor] ${serviceName}: ${memoryMB !== null ? memoryMB.toFixed(2) + ' MB' : 'null'}`);
          sendMessage(ws, {
            type: "monitor:memory",
            connectionId,
            payload: { serviceName, memoryMB: memoryMB ?? null, timestamp: Date.now() },
          });
        } catch (err) {
          debugError(`[Monitor] Error monitoring ${serviceName}:`, err);
        }
      }, interval);

      registerSession(sessionKey, ws, { connectionId, wsKey, interval, timer });

      sendMessage(ws, {
        type: "monitor:started", id, connectionId,
        payload: { serviceName, interval },
      });
      break;
    }

    case "monitor:start-batch": {
      const serviceNames = payload.serviceNames as string[];
      const interval = Math.max(2000, Math.min((payload.interval as number) || 5000, 30000));

      if (!serviceNames || serviceNames.length === 0) {
        sendError(ws, "monitor:error", "No services to monitor", id, connectionId);
        return;
      }

      const sessionKey = `batch:${connectionId}`;
      clearMonitorSession(sessionKey);

      debugLog(`[Monitor] Starting batch monitor for ${serviceNames.length} services on ${connectionId}: ${serviceNames.join(', ')}`);

      const wsKey = getWsKey(ws);
      const timer = setInterval(async () => {
        try {
          const client = connectionPool.get(connectionId);
          if (!client) {
            sendError(ws, "monitor:error", "Connection lost", id, connectionId);
            clearMonitorSession(sessionKey);
            return;
          }

          const results = await getServicesMemory(client, serviceNames);
          sendMessage(ws, {
            type: "monitor:batch-memory", connectionId,
            payload: { services: results, timestamp: Date.now() },
          });
        } catch (err) {
          debugError(`[Monitor] Batch monitoring error:`, err);
        }
      }, interval);

      registerSession(sessionKey, ws, { connectionId, wsKey, interval, timer });

      sendMessage(ws, {
        type: "monitor:started-batch", id, connectionId,
        payload: { serviceNames, interval },
      });
      break;
    }

    case "monitor:stop":
    case "monitor:stop-batch": {
      const serviceName = payload.serviceName as string;
      const sessionKey = serviceName
        ? `${connectionId}:${serviceName}`
        : `batch:${connectionId}`;
      debugLog(`[Monitor] Stopping monitor: ${sessionKey}`);
      clearMonitorSession(sessionKey);
      sendMessage(ws, {
        type: "monitor:stopped", id, connectionId,
        payload: { serviceName: serviceName || "__batch__" },
      });
      break;
    }
  }
}

export function cleanupMonitorSessions(ws: WebSocket) {
  const wsKey = getWsKey(ws);
  const owned = wsOwners.get(wsKey);
  if (!owned) return;
  for (const sessionKey of owned) {
    const session = monitorSessions.get(sessionKey);
    if (session) {
      clearInterval(session.timer);
      monitorSessions.delete(sessionKey);
    }
  }
  wsOwners.delete(wsKey);
}
