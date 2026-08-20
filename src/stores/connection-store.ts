"use client";

import { create } from "zustand";
import type { Connection } from "@/lib/db/schema";
import { wsClient, type WSServerMessage } from "@/lib/ws-client";

export type ConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

export interface ActiveConnection {
  connection: Connection;
  status: ConnectionStatus;
  error?: string;
  connectedAt?: number;
}

interface ConnectionStore {
  activeConnections: Map<string, ActiveConnection>;
  activeTabId: string | null;

  setActiveTab: (connectionId: string | null) => void;
  setConnectionStatus: (connectionId: string, connection: Connection, status: ConnectionStatus, error?: string) => void;
  removeConnection: (connectionId: string) => void;
  getActiveConnection: () => ActiveConnection | null;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  activeConnections: new Map(),
  activeTabId: null,

  setActiveTab: (connectionId) => set({ activeTabId: connectionId }),

  setConnectionStatus: (connectionId, connection, status, error) =>
    set((state) => {
      const newMap = new Map(state.activeConnections);
      newMap.set(connectionId, {
        connection,
        status,
        error,
        connectedAt: status === "connected" ? Date.now() : undefined,
      });
      return {
        activeConnections: newMap,
        activeTabId: state.activeTabId || connectionId,
      };
    }),

  removeConnection: (connectionId) =>
    set((state) => {
      const newMap = new Map(state.activeConnections);
      newMap.delete(connectionId);
      const nextTab = state.activeTabId === connectionId
        ? (newMap.keys().next().value ?? null)
        : state.activeTabId;
      return { activeConnections: newMap, activeTabId: nextTab };
    }),

  getActiveConnection: () => {
    const { activeConnections, activeTabId } = get();
    if (!activeTabId) return null;
    return activeConnections.get(activeTabId) ?? null;
  },
}));

// Listen for dropped connections detected by API 400 errors
// Then auto-reconnect with exponential backoff to keep polling healthy
if (typeof window !== "undefined") {
  const reconnectAttempts = new Map<string, number>();
  const RECONNECT_DELAYS = [1000, 2000, 5000, 15000, 30000];

  async function tryReconnect(connectionId: string) {
    const store = useConnectionStore.getState();
    const active = store.activeConnections.get(connectionId);
    if (!active) return;
    // Don't reconnect if the user already manually disconnected/connected
    if (active.status !== "disconnected" && active.status !== "error") return;

    const attempt = reconnectAttempts.get(connectionId) ?? 0;
    if (attempt >= RECONNECT_DELAYS.length) {
      reconnectAttempts.delete(connectionId);
      store.setConnectionStatus(connectionId, active.connection, "error", "Reconnect failed");
      return;
    }

    const delay = RECONNECT_DELAYS[attempt];
    reconnectAttempts.set(connectionId, attempt + 1);

    setTimeout(async () => {
      const current = useConnectionStore.getState().activeConnections.get(connectionId);
      if (!current || (current.status !== "disconnected" && current.status !== "error")) {
        reconnectAttempts.delete(connectionId);
        return;
      }
      try {
        const { connectionsApi } = await import("@/lib/api-client");
        store.setConnectionStatus(connectionId, current.connection, "connecting");
        await connectionsApi.connect(connectionId);
        store.setConnectionStatus(connectionId, current.connection, "connected");
        reconnectAttempts.delete(connectionId);
      } catch {
        // Try again with next backoff
        tryReconnect(connectionId);
      }
    }, delay);
  }

  window.addEventListener("connection:dropped", ((e: CustomEvent<{ connectionId: string }>) => {
    const { connectionId } = e.detail;
    const store = useConnectionStore.getState();
    const active = store.activeConnections.get(connectionId);
    if (active && active.status === "connected") {
      store.setConnectionStatus(connectionId, active.connection, "disconnected", "Reconnecting...");
      import("@/lib/disconnect").then(({ disconnectAndCleanup }) => {
        disconnectAndCleanup(connectionId).catch(() => {});
      });
      tryReconnect(connectionId);
    }
  }) as EventListener);

  // Subscribe to WS-driven connection status updates
  wsClient.on("connection:status", (msg: WSServerMessage) => {
    const { connectionId, status, reason } = msg.payload as {
      connectionId: string;
      status: "connected" | "disconnected";
      reason?: string;
    };
    const store = useConnectionStore.getState();
    const active = store.activeConnections.get(connectionId);
    if (active) {
      if (status === "disconnected") {
        // Skip reconnect for user-initiated disconnects
        if (reason === "user" || reason === "manual") return;
        store.setConnectionStatus(connectionId, active.connection, "disconnected", reason);
        // Also cleanup other stores
        import("@/lib/disconnect").then(({ disconnectAndCleanup }) => {
          disconnectAndCleanup(connectionId).catch(() => {});
        });
        // Auto-reconnect so polling recovers without the user clicking Reconnect
        tryReconnect(connectionId);
      }
    }
  });
}
