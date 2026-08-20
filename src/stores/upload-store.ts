"use client";

import { create } from "zustand";

export interface UploadItem {
  id: string;
  connectionId: string;
  fileName: string;
  remotePath: string;
  file: File | null;
  status: "pending" | "uploading" | "completed" | "error";
  progress: number; // 0-100
  bytesUploaded: number;
  totalBytes: number;
  error?: string;
}

interface UploadStore {
  uploads: UploadItem[];

  addUpload: (item: Omit<UploadItem, "status" | "progress" | "bytesUploaded" | "totalBytes">) => void;
  updateProgress: (id: string, bytesUploaded: number, totalBytes: number) => void;
  setStatus: (id: string, status: UploadItem["status"], error?: string) => void;
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
  getPending: () => UploadItem[];
  getActive: () => UploadItem[];
}

export const useUploadStore = create<UploadStore>((set, get) => ({
  uploads: [],

  addUpload: (item) =>
    set((state) => ({
      uploads: [
        ...state.uploads,
        {
          ...item,
          status: "pending",
          progress: 0,
          bytesUploaded: 0,
          totalBytes: item.file?.size ?? 0,
        },
      ],
    })),

  updateProgress: (id, bytesUploaded, totalBytes) =>
    set((state) => ({
      uploads: state.uploads.map((u) =>
        u.id === id
          ? {
              ...u,
              status: "uploading" as const,
              bytesUploaded,
              totalBytes,
              progress: totalBytes > 0 ? Math.round((bytesUploaded / totalBytes) * 100) : 0,
            }
          : u
      ),
    })),

  setStatus: (id, status, error) =>
    set((state) => ({
      uploads: state.uploads.map((u) =>
        u.id === id
          ? {
              ...u,
              status,
              error,
              progress: status === "completed" ? 100 : u.progress,
              file: status === "completed" || status === "error" ? null : u.file,
            }
          : u
      ),
    })),

  removeUpload: (id) =>
    set((state) => ({
      uploads: state.uploads.filter((u) => u.id !== id),
    })),

  clearCompleted: () =>
    set((state) => ({
      uploads: state.uploads.filter((u) => u.status !== "completed"),
    })),

  getPending: () => get().uploads.filter((u) => u.status === "pending"),
  getActive: () => get().uploads.filter((u) => u.status === "uploading"),
}));
