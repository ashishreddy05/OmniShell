"use client";

import { useEffect } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useAIStore } from "@/stores/ai-store";

export function NotificationBridge() {
  const addNotification = useNotificationStore((s) => s.addNotification);

  // Connection drops
  useEffect(() => {
    const onDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail as { connectionId?: string; reason?: string };
      const connId = detail?.connectionId;
      const connStore = useConnectionStore.getState();
      const conn = connId ? connStore.activeConnections.get(connId) : undefined;
      addNotification({
        type: "connection_drop",
        title: "Connection dropped",
        message: conn
          ? `Connection to "${conn.connection.name}" was lost.${detail?.reason ? ` Reason: ${detail.reason}` : ""}`
          : "An SSH connection was lost.",
      });
    };
    window.addEventListener("connection:dropped", onDrop);
    return () => window.removeEventListener("connection:dropped", onDrop);
  }, [addNotification]);

  // GIA errors — watch the AI store for error markers in messages
  useEffect(() => {
    const unsub = useAIStore.subscribe((s, prev) => {
      if (s.messages.length > prev.messages.length) {
        const last = s.messages[s.messages.length - 1];
        if (last?.role === "assistant" && last.content.includes("_Error:")) {
          const errMatch = last.content.match(/_Error: ([^_]+)_/);
          addNotification({
            type: "gia_error",
            title: "GIA error",
            message: errMatch?.[1]?.trim() || "GIA encountered an error during processing.",
          });
        }
      }
    });
    return unsub;
  }, [addNotification]);

  // Service failures — watch connection store for error status changes
  useEffect(() => {
    const unsub = useConnectionStore.subscribe((s, prev) => {
      for (const [id, conn] of s.activeConnections) {
        const prevConn = prev.activeConnections.get(id);
        if (conn.status === "error" && prevConn?.status !== "error" && prevConn?.status !== "connecting") {
          addNotification({
            type: "connection_drop",
            title: "Connection error",
            message: `Connection "${conn.connection.name}" encountered an error.${conn.error ? ` ${conn.error}` : ""}`,
          });
        }
      }
    });
    return unsub;
  }, [addNotification]);

  return null;
}
