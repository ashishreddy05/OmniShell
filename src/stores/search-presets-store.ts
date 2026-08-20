import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SearchPresetsStore {
  /** connectionId → list of saved paths */
  presets: Record<string, string[]>;
  add: (connectionId: string, path: string) => void;
  remove: (connectionId: string, path: string) => void;
  getPresets: (connectionId: string) => string[];
}

export const useSearchPresetsStore = create<SearchPresetsStore>()(
  persist(
    (set, get) => ({
      presets: {},

      add: (connectionId, path) => {
        const trimmed = path.trim().replace(/\/+$/, "") || "/";
        set((s) => {
          const existing = s.presets[connectionId] ?? [];
          if (existing.includes(trimmed)) return s;
          return {
            presets: {
              ...s.presets,
              [connectionId]: [...existing, trimmed],
            },
          };
        });
      },

      remove: (connectionId, path) => {
        set((s) => ({
          presets: {
            ...s.presets,
            [connectionId]: (s.presets[connectionId] ?? []).filter((p) => p !== path),
          },
        }));
      },

      getPresets: (connectionId) => get().presets[connectionId] ?? [],
    }),
    {
      name: "search-presets",
    }
  )
);
