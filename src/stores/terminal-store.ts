"use client";

import { create } from "zustand";

export interface TerminalSession {
  id: string;
  connectionId: string;
  isOpen: boolean;
}

export const TERMINAL_THEMES: Record<string, { label: string; theme: { background: string; foreground: string; cursor: string; selectionBackground: string } }> = {
  default: {
    label: "Default Dark",
    theme: {
      background: "#0a0a0a",
      foreground: "#e5e5e5",
      cursor: "#e5e5e5",
      selectionBackground: "rgba(59, 130, 246, 0.5)",
    },
  },
  monokai: {
    label: "Monokai",
    theme: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      selectionBackground: "rgba(73, 72, 62, 0.5)",
    },
  },
  solarized: {
    label: "Solarized Dark",
    theme: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#93a1a1",
      selectionBackground: "rgba(7, 54, 66, 0.5)",
    },
  },
  dracula: {
    label: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      selectionBackground: "rgba(68, 71, 90, 0.5)",
    },
  },
  nord: {
    label: "Nord",
    theme: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "rgba(67, 76, 94, 0.5)",
    },
  },
};

interface TerminalStore {
  sessions: Map<string, TerminalSession[]>;
  activeSessionId: Map<string, string>;
  theme: string;

  setTheme: (theme: string) => void;
  addSession: (connectionId: string) => string;
  removeSession: (connectionId: string, sessionId: string) => void;
  setActiveSession: (connectionId: string, sessionId: string) => void;
  getSessions: (connectionId: string) => TerminalSession[];
  getActiveSession: (connectionId: string) => string | null;
  clearForConnection: (connectionId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: new Map(),
  theme: typeof window !== "undefined" ? localStorage.getItem("terminal-theme") || "default" : "default",

  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("terminal-theme", theme);
    }
    set({ theme });
  },

  addSession: (connectionId) => {
    const id = `term-${crypto.randomUUID()}`;
    set((state) => {
      const sessions = new Map(state.sessions);
      const activeSessionId = new Map(state.activeSessionId);
      const existing = sessions.get(connectionId) ?? [];
      sessions.set(connectionId, [...existing, { id, connectionId, isOpen: true }]);
      activeSessionId.set(connectionId, id);
      return { sessions, activeSessionId };
    });
    return id;
  },

  removeSession: (connectionId, sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const activeSessionId = new Map(state.activeSessionId);
      const existing = sessions.get(connectionId) ?? [];
      const filtered = existing.filter((s) => s.id !== sessionId);
      sessions.set(connectionId, filtered);
      if (activeSessionId.get(connectionId) === sessionId) {
        activeSessionId.set(connectionId, filtered[filtered.length - 1]?.id ?? "");
      }
      return { sessions, activeSessionId };
    }),

  setActiveSession: (connectionId, sessionId) =>
    set((state) => {
      const activeSessionId = new Map(state.activeSessionId);
      activeSessionId.set(connectionId, sessionId);
      return { activeSessionId };
    }),

  getSessions: (connectionId) => get().sessions.get(connectionId) ?? [],

  getActiveSession: (connectionId) => get().activeSessionId.get(connectionId) ?? null,

  clearForConnection: (connectionId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const activeSessionId = new Map(state.activeSessionId);
      sessions.delete(connectionId);
      activeSessionId.delete(connectionId);
      return { sessions, activeSessionId };
    }),
}));
