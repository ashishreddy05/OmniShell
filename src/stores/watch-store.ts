"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WatchedService {
  connectionId: string;
  serviceName: string;
  addedAt: number;
}

interface WatchStore {
  watched: WatchedService[];
  addWatched: (connectionId: string, serviceName: string) => void;
  removeWatched: (connectionId: string, serviceName: string) => void;
  isWatched: (connectionId: string, serviceName: string) => boolean;
  getWatchedForConnection: (connectionId: string) => WatchedService[];
  reorderWatched: (connectionId: string, serviceNames: string[]) => void;
}

export const useWatchStore = create<WatchStore>()(
  persist(
    (set, get) => ({
      watched: [],

      addWatched: (connectionId, serviceName) =>
        set((state) => {
          if (state.watched.some((w) => w.connectionId === connectionId && w.serviceName === serviceName)) {
            return state;
          }
          return {
            watched: [...state.watched, { connectionId, serviceName, addedAt: Date.now() }],
          };
        }),

      removeWatched: (connectionId, serviceName) =>
        set((state) => ({
          watched: state.watched.filter(
            (w) => !(w.connectionId === connectionId && w.serviceName === serviceName)
          ),
        })),

      isWatched: (connectionId, serviceName) =>
        get().watched.some((w) => w.connectionId === connectionId && w.serviceName === serviceName),

      getWatchedForConnection: (connectionId) =>
        get().watched.filter((w) => w.connectionId === connectionId),

      reorderWatched: (connectionId, serviceNames) =>
        set((state) => {
          const other = state.watched.filter((w) => w.connectionId !== connectionId);
          const reordered = serviceNames.map((name, idx) => ({
            connectionId,
            serviceName: name,
            addedAt: Date.now() - serviceNames.length + idx,
          }));
          return { watched: [...other, ...reordered] };
        }),
    }),
    { name: "omnishell-watched-services" }
  )
);
