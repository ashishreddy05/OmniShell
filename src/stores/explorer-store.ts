"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { FileEntry } from "../../server/ssh/sftp-operations";

enableMapSet();

export type ViewMode = "grid" | "list";
export type SortBy = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

export interface ClipboardItem {
  entries: FileEntry[];
  operation: "copy" | "cut";
}

export interface ExplorerState {
  currentPath: string;
  selectedItems: Set<string>;
  viewMode: ViewMode;
  sortBy: SortBy;
  sortDir: SortDir;
  showHidden: boolean;
  clipboard: ClipboardItem | null;
  history: string[];
  historyIndex: number;
}

const MAX_HISTORY = 200;

const defaultExplorerState: ExplorerState = {
  currentPath: "/",
  selectedItems: new Set(),
  viewMode: "list",
  sortBy: "name",
  sortDir: "asc",
  showHidden: false,
  clipboard: null,
  history: ["/"],
  historyIndex: 0,
};

interface ExplorerStore {
  explorers: Map<string, ExplorerState>;

  getExplorer: (connectionId: string) => ExplorerState;
  navigate: (connectionId: string, path: string) => void;
  goBack: (connectionId: string) => void;
  goForward: (connectionId: string) => void;
  setViewMode: (connectionId: string, mode: ViewMode) => void;
  setSort: (connectionId: string, sortBy: SortBy, sortDir?: SortDir) => void;
  toggleHidden: (connectionId: string) => void;
  selectItem: (connectionId: string, path: string, multi?: boolean) => void;
  selectAll: (connectionId: string, paths: string[]) => void;
  clearSelection: (connectionId: string) => void;
  setClipboard: (connectionId: string, entries: FileEntry[], operation: "copy" | "cut") => void;
  clearClipboard: (connectionId: string) => void;
  removeExplorer: (connectionId: string) => void;
}

function getOrCreate(explorers: Map<string, ExplorerState>, connectionId: string): ExplorerState {
  let state = explorers.get(connectionId);
  if (!state) {
    state = { ...defaultExplorerState, selectedItems: new Set(), history: ["/"] };
    explorers.set(connectionId, state);
  }
  return state;
}

export const useExplorerStore = create<ExplorerStore>()(
  immer((set, get) => ({
    explorers: new Map(),

    getExplorer: (connectionId) => {
      return get().explorers.get(connectionId) ?? { ...defaultExplorerState };
    },

    navigate: (connectionId, path) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        let newHistory = current.history.slice(0, current.historyIndex + 1);
        newHistory.push(path);
        let newIndex = newHistory.length - 1;
        if (newHistory.length > MAX_HISTORY) {
          const excess = newHistory.length - MAX_HISTORY;
          newHistory = newHistory.slice(excess);
          newIndex = newHistory.length - 1;
        }
        current.currentPath = path;
        current.selectedItems = new Set();
        current.history = newHistory;
        current.historyIndex = newIndex;
      }),

    goBack: (connectionId) =>
      set((state) => {
        const current = state.explorers.get(connectionId);
        if (!current || current.historyIndex <= 0) return;
        current.historyIndex--;
        current.currentPath = current.history[current.historyIndex];
        current.selectedItems = new Set();
      }),

    goForward: (connectionId) =>
      set((state) => {
        const current = state.explorers.get(connectionId);
        if (!current || current.historyIndex >= current.history.length - 1) return;
        current.historyIndex++;
        current.currentPath = current.history[current.historyIndex];
        current.selectedItems = new Set();
      }),

    setViewMode: (connectionId, mode) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        current.viewMode = mode;
      }),

    setSort: (connectionId, sortBy, sortDir) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        const newDir = sortDir ?? (current.sortBy === sortBy && current.sortDir === "asc" ? "desc" : "asc");
        current.sortBy = sortBy;
        current.sortDir = newDir;
      }),

    toggleHidden: (connectionId) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        current.showHidden = !current.showHidden;
      }),

    selectItem: (connectionId, path, multi = false) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        if (!multi) {
          current.selectedItems = new Set([path]);
        } else if (current.selectedItems.has(path)) {
          current.selectedItems.delete(path);
        } else {
          current.selectedItems.add(path);
        }
      }),

    selectAll: (connectionId, paths) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        current.selectedItems = new Set(paths);
      }),

    clearSelection: (connectionId) =>
      set((state) => {
        const current = state.explorers.get(connectionId);
        if (current) current.selectedItems = new Set();
      }),

    setClipboard: (connectionId, entries, operation) =>
      set((state) => {
        const current = getOrCreate(state.explorers, connectionId);
        current.clipboard = { entries, operation };
      }),

    clearClipboard: (connectionId) =>
      set((state) => {
        const current = state.explorers.get(connectionId);
        if (current) current.clipboard = null;
      }),

    removeExplorer: (connectionId) =>
      set((state) => {
        state.explorers.delete(connectionId);
      }),
  }))
);
