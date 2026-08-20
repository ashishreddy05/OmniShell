"use client";

import { create } from "zustand";
import { setOriginalContent, removeOriginalContent, removeOriginalContentForConnection } from "@/lib/editor-content";

export interface EditorTab {
  id: string;
  connectionId: string;
  path: string;
  fileName: string;
  isDirty: boolean;
  language: string;
}

interface EditorStore {
  tabs: EditorTab[];
  activeTabId: string | null;

  openFile: (connectionId: string, path: string, content: string, language: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setDirty: (tabId: string, isDirty: boolean) => void;
  getTab: (tabId: string) => EditorTab | undefined;
  getDirtyTabs: () => EditorTab[];
  findTab: (connectionId: string, path: string) => EditorTab | undefined;
  closeAllForConnection: (connectionId: string) => void;
}

function makeTabId(connectionId: string, path: string): string {
  return `${connectionId}:${path}`;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openFile: (connectionId, path, content, language) => {
    const tabId = makeTabId(connectionId, path);
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId });
      return tabId;
    }

    // Store original content outside Zustand
    setOriginalContent(tabId, content);

    const fileName = path.split("/").pop() || path;
    const tab: EditorTab = {
      id: tabId,
      connectionId,
      path,
      fileName,
      isDirty: false,
      language,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tabId,
    }));

    return tabId;
  },

  closeTab: (tabId) =>
    set((state) => {
      removeOriginalContent(tabId);
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      const nextActive =
        state.activeTabId === tabId
          ? newTabs[newTabs.length - 1]?.id ?? null
          : state.activeTabId;
      return { tabs: newTabs, activeTabId: nextActive };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setDirty: (tabId, isDirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.isDirty !== isDirty
          ? { ...t, isDirty }
          : t
      ),
    })),

  getTab: (tabId) => get().tabs.find((t) => t.id === tabId),

  getDirtyTabs: () => get().tabs.filter((t) => t.isDirty),

  findTab: (connectionId, path) =>
    get().tabs.find((t) => t.connectionId === connectionId && t.path === path),

  closeAllForConnection: (connectionId) =>
    set((state) => {
      removeOriginalContentForConnection(connectionId);
      const newTabs = state.tabs.filter((t) => t.connectionId !== connectionId);
      const nextActive =
        state.tabs.find((t) => t.id === state.activeTabId)?.connectionId === connectionId
          ? newTabs[0]?.id ?? null
          : state.activeTabId;
      return { tabs: newTabs, activeTabId: nextActive };
    }),
}));
