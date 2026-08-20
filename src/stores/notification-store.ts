"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type NotificationType =
  | "service_failure"
  | "gia_error"
  | "connection_drop"
  | "ssh_channel_saturation";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  ts: number;
  read: boolean;
}

interface NotificationStore {
  notifications: Notification[];
  addNotification: (n: Omit<Notification, "id" | "ts" | "read">) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

let notifCounter = 0;

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set) => ({
      notifications: [],

      addNotification: (n) =>
        set((s) => ({
          notifications: [
            {
              ...n,
              id: `notif-${Date.now()}-${++notifCounter}`,
              ts: Date.now(),
              read: false,
            },
            ...s.notifications,
          ].slice(0, 100),
        })),

      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
        })),

      clearAll: () => set({ notifications: [] }),
    }),
    {
      name: "omnishell-notifications",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ notifications: s.notifications }),
    },
  ),
);
