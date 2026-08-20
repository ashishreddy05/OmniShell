import type { WebSocket } from "ws";
import type { WSMessage } from "./index";
import { sendMessage, sendError } from "./index";
import { connectionPool } from "../ssh/connection-pool";
import type { ClientChannel } from "ssh2";

// Map: wsKey -> Map<sessionId, ClientChannel>
const terminalSessions = new Map<string, Map<string, ClientChannel>>();

function getSessionKey(ws: WebSocket): string {
  return (ws as unknown as { _sessionKey?: string })._sessionKey ||= Math.random().toString(36).slice(2);
}

function getClientSessions(ws: WebSocket): Map<string, ClientChannel> {
  const key = getSessionKey(ws);
  if (!terminalSessions.has(key)) {
    terminalSessions.set(key, new Map());
  }
  return terminalSessions.get(key)!;
}

export async function handleTerminalMessage(ws: WebSocket, message: WSMessage) {
  const { type, connectionId, payload, id } = message;
  const sessionId = (payload.sessionId as string) || connectionId;

  if (type === "terminal:cleanup") {
    const key = getSessionKey(ws);
    const sessions = terminalSessions.get(key);
    if (sessions) {
      for (const [, channel] of sessions) {
        channel.close();
      }
      sessions.clear();
      terminalSessions.delete(key);
    }
    return;
  }

  switch (type) {
    case "terminal:open": {
      try {
        const conn = connectionPool.get(connectionId);
        if (!conn) {
          sendError(ws, "terminal:error", "Connection not found", id, connectionId);
          return;
        }

        const cols = (payload.cols as number) || 80;
        const rows = (payload.rows as number) || 24;

        conn.shell(
          { term: "xterm-256color", cols, rows },
          (err, stream) => {
            if (err) {
              sendError(ws, "terminal:error", err.message, id, connectionId);
              return;
            }

            const sessions = getClientSessions(ws);
            sessions.set(sessionId, stream);

            sendMessage(ws, {
              type: "terminal:opened",
              id,
              connectionId,
              payload: { sessionId },
            });

            stream.on("data", (data: Buffer) => {
              sendMessage(ws, {
                type: "terminal:output",
                connectionId,
                payload: { sessionId, data: data.toString("base64") },
              });
            });

            stream.on("close", () => {
              sessions.delete(sessionId);
              sendMessage(ws, {
                type: "terminal:closed",
                connectionId,
                payload: { sessionId, reason: "Shell session ended" },
              });
            });

            stream.stderr.on("data", (data: Buffer) => {
              sendMessage(ws, {
                type: "terminal:output",
                connectionId,
                payload: { sessionId, data: data.toString("base64") },
              });
            });
          }
        );
      } catch (err) {
        sendError(ws, "terminal:error", (err as Error).message, id, connectionId);
      }
      break;
    }

    case "terminal:input": {
      const sessions = getClientSessions(ws);
      const channel = sessions.get(sessionId);
      if (!channel) {
        sendError(ws, "terminal:error", "No terminal session", id, connectionId);
        return;
      }
      const data = payload.data as string;
      channel.write(Buffer.from(data, "base64"));
      break;
    }

    case "terminal:resize": {
      const sessions = getClientSessions(ws);
      const channel = sessions.get(sessionId);
      if (!channel) return;
      const cols = (payload.cols as number) || 80;
      const rows = (payload.rows as number) || 24;
      channel.setWindow(rows, cols, rows * 16, cols * 8);
      break;
    }

    case "terminal:close": {
      const sessions = getClientSessions(ws);
      const channel = sessions.get(sessionId);
      if (channel) {
        channel.close();
        sessions.delete(sessionId);
      }
      sendMessage(ws, {
        type: "terminal:closed",
        connectionId,
        payload: { sessionId, reason: "Closed by client" },
      });
      break;
    }
  }
}
