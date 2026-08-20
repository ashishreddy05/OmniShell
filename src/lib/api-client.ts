import type { Connection } from "./db/schema";
import type { FileEntry, FileStat } from "../../server/ssh/sftp-operations";
import type { SystemVitals } from "../../server/ssh/vitals";
import type { ServiceInfo, ServiceDetail } from "../../server/ssh/services";
import * as wsClientModule from "./ws-client";
import { toast } from "sonner";
import { useNotificationStore } from "@/stores/notification-store";

export interface LogSearchResult {
  context: string;
  startTimestamp: string;
  endTimestamp: string;
}

let channelSaturationTimer = 0;

const API_BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/api";

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = body.error || `Request failed: ${res.status}`;
    const code = body.code as string | undefined;
    // If connection dropped, notify the store
    if (message === "Connection not active. Please connect first." || code === "SSH_CONNECTION_LOST") {
      const match = url.match(/\/fs\/([^/]+)/);
      if (match) {
        window.dispatchEvent(new CustomEvent("connection:dropped", { detail: { connectionId: match[1] } }));
      }
    }
    // Surface channel-saturation as a one-time toast so the user knows it's transient
    if (code === "SSH_CHANNEL_SATURATION" && (!channelSaturationTimer || Date.now() - channelSaturationTimer > 8000)) {
      channelSaturationTimer = Date.now();
      toast.warning("SSH channel limit hit — too many concurrent operations. Server retried automatically.", { duration: 4000 });
      useNotificationStore.getState().addNotification({
        type: "ssh_channel_saturation",
        title: "SSH channel limit hit",
        message: "Too many concurrent operations. The server retried automatically.",
      });
    }
    throw new Error(message);
  }

  return res.json();
}

// Connection API
export const connectionsApi = {
  list: () => fetchJSON<Connection[]>("/connections"),

  get: (id: string) => fetchJSON<Connection>(`/connections/${id}`),

  create: (data: Omit<Connection, "id" | "createdAt" | "updatedAt">) =>
    fetchJSON<Connection>("/connections", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Connection>) =>
    fetchJSON<Connection>(`/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchJSON<{ success: boolean }>(`/connections/${id}`, { method: "DELETE" }),

  test: (id: string) =>
    fetchJSON<{ success: boolean; message: string }>(`/connections/${id}/test`, {
      method: "POST",
    }),

  connect: (id: string) =>
    fetchJSON<{ success: boolean }>(`/connections/${id}/connect`, {
      method: "POST",
    }),

  disconnect: (id: string) =>
    fetchJSON<{ success: boolean }>(`/connections/${id}/disconnect`, {
      method: "POST",
    }),

  status: (id: string) =>
    fetchJSON<{ status: "connected" | "disconnected" }>(`/connections/${id}/status`),
};

// Filesystem API
export const fsApi = {
  list: (connectionId: string, path: string) =>
    fetchJSON<{ path: string; entries: FileEntry[]; parent: string | null }>(
      `/fs/${connectionId}/list?path=${encodeURIComponent(path)}`
    ),

  stat: (connectionId: string, path: string) =>
    fetchJSON<FileStat>(`/fs/${connectionId}/stat?path=${encodeURIComponent(path)}`),

  read: (connectionId: string, path: string) =>
    fetchJSON<{ content: string; encoding: string }>(
      `/fs/${connectionId}/read?path=${encodeURIComponent(path)}`
    ),

  write: (connectionId: string, path: string, content: string) =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/write`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),

  chmod: (connectionId: string, paths: string[], mode: string) =>
    fetchJSON<{ success: boolean; count: number }>(`/fs/${connectionId}/chmod`, {
      method: "POST",
      body: JSON.stringify({ paths, mode }),
    }),

  mkdir: (connectionId: string, path: string) =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  delete: (connectionId: string, path: string, recursive = false) =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/delete`, {
      method: "DELETE",
      body: JSON.stringify({ path, recursive }),
    }),

  rename: (connectionId: string, oldPath: string, newPath: string) =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/rename`, {
      method: "PATCH",
      body: JSON.stringify({ oldPath, newPath }),
    }),

  copy: (connectionId: string, sourcePath: string, destinationPath: string) =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/copy`, {
      method: "POST",
      body: JSON.stringify({ sourcePath, destinationPath }),
    }),

  search: (connectionId: string, query: string, path = "/", type: "name" | "content" = "name") =>
    fetchJSON<{ results: Array<{ path: string; type: "file" | "directory" }> }>(
      `/fs/${connectionId}/search?query=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}&type=${type}`
    ),

  vitals: (connectionId: string) =>
    fetchJSON<SystemVitals>(`/fs/${connectionId}/vitals`),

  getDownloadUrl: (connectionId: string, path: string) =>
    `${API_BASE}/fs/${connectionId}/download?path=${encodeURIComponent(path)}`,

  getPreviewUrl: (connectionId: string, path: string) =>
    `${API_BASE}/fs/${connectionId}/preview?path=${encodeURIComponent(path)}`,

  upload: async (connectionId: string, path: string, files: File[], relativePath?: string, onProgress?: (loaded: number, total: number) => void) => {
    const formData = new FormData();
    formData.append("path", path);
    if (relativePath) {
      formData.append("relativePath", relativePath);
    }
    for (const file of files) {
      formData.append("files", file);
    }

    return new Promise<{ success: boolean }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/fs/${connectionId}/upload`);

      if (onProgress) {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(formData);
    });
  },
};

// Services API
export const servicesApi = {
  list: (connectionId: string) =>
    fetchJSON<{ services: ServiceInfo[] }>(`/fs/${connectionId}/services`),

  getStatusBatch: (connectionId: string, names: string[]) =>
    fetchJSON<{ services: Array<{ name: string; state: string; substate: string; memoryCurrent?: number }> }>(
      `/fs/${connectionId}/services?names=${encodeURIComponent(names.join(","))}`
    ),

  get: (connectionId: string, name: string) =>
    fetchJSON<ServiceDetail>(`/fs/${connectionId}/services/${encodeURIComponent(name)}`),

  getFile: (connectionId: string, name: string) =>
    fetchJSON<{ fileContent: string }>(`/fs/${connectionId}/services/${encodeURIComponent(name)}?file=1`),

  memory: (connectionId: string, name: string) =>
    fetchJSON<{ memoryMB: number | null }>(`/fs/${connectionId}/services/${encodeURIComponent(name)}/memory`),

  act: (connectionId: string, name: string, action: "start" | "stop" | "restart" | "enable" | "disable") =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/services/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  runCommand: (connectionId: string, command: string) =>
    fetchJSON<{ stdout: string; stderr: string }>(`/fs/${connectionId}/services/run`, {
      method: "POST",
      body: JSON.stringify({ command }),
    }),

  daemonReload: (connectionId: string) =>
    fetchJSON<{ success: boolean }>(`/fs/${connectionId}/services`, {
      method: "POST",
      body: JSON.stringify({ action: "daemon-reload" }),
    }),

  logs: (connectionId: string, name: string, params: { search?: string; tail?: number; startPad?: number; endPad?: number }) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.tail) query.set("tail", String(params.tail));
    if (params.startPad) query.set("startPad", String(params.startPad));
    if (params.endPad) query.set("endPad", String(params.endPad));
    return fetchJSON<LogSearchResult | { logs: string }>(`/fs/${connectionId}/services/${encodeURIComponent(name)}/logs?${query}`);
  },

  streamLogs: (
    connectionId: string,
    name: string,
    callbacks: {
      onChunk: (chunk: string) => void;
      onError?: (err: string) => void;
      onClose?: () => void;
    },
    options?: { historyLines?: number },
  ): { stop: () => void; ready: Promise<void> } => {
    const { wsClient } = wsClientModule;

    const unsubData = wsClient.on("logs:data", (msg) => {
      if (msg.connectionId === connectionId && msg.payload.serviceName === name) {
        callbacks.onChunk(msg.payload.chunk as string);
      }
    });
    const unsubError = wsClient.on("logs:error", (msg) => {
      if (msg.connectionId === connectionId && msg.payload.serviceName === name) {
        callbacks.onError?.(msg.error || "Stream error");
      }
    });
    const unsubClosed = wsClient.on("logs:closed", (msg) => {
      if (msg.connectionId === connectionId && msg.payload.serviceName === name) {
        callbacks.onClose?.();
      }
    });

    const ready = new Promise<void>((resolve) => {
      const unsubStarted = wsClient.on("logs:started", (msg) => {
        if (msg.connectionId === connectionId && msg.payload.serviceName === name) {
          unsubStarted();
          resolve();
        }
      });
      wsClient.send({
        type: "logs:start",
        connectionId,
        payload: { serviceName: name, historyLines: options?.historyLines },
      });
    });

    const stop = () => {
      unsubData();
      unsubError();
      unsubClosed();
      wsClient.send({
        type: "logs:stop",
        connectionId,
        payload: { serviceName: name },
      });
    };

    return { stop, ready };
  },
};

// AI API
export interface AIContextPayload {
  connectionId?: string;
  file?: { path: string; content?: string; language?: string };
  terminal?: { output?: string; tail?: number };
  service?: { name: string };
  logs?: { serviceName: string; lines?: number; content?: string };
  currentPath?: string;
}

export const aiApi = {
  ask: async (
    prompt: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    context: AIContextPayload | undefined,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFunctionCall?: (fc: { name: string; args: Record<string, any> }) => void,
    onClearLast?: () => void,
    connections?: Array<{ id: string; name: string; status: string }>,
    watchedServices?: Array<{ connectionId: string; serviceName: string }>,
  ): Promise<void> => {
    const res = await fetch(`${API_BASE}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, history, context, connections, watchedServices }),
      signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDone = false;
    let receivedTruncated = false;
    let lastError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") { receivedDone = true; continue; }
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            // A real error from the server (model failure, etc.)
            lastError = parsed.error;
            if (parsed.truncated) receivedTruncated = true;
            throw new Error(parsed.error);
          }
          if (parsed.truncated) {
            receivedTruncated = true;
            lastError = parsed.error || "Response was cut off";
          }
          if (parsed.done) { receivedDone = true; continue; }
          if (parsed.clearLast && onClearLast) onClearLast();
          if (parsed.chunk) onChunk(parsed.chunk);
          if (parsed.functionCall && onFunctionCall) {
            onFunctionCall(parsed.functionCall);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
            throw e;
          }
        }
      }
    }

    // If the server closed the stream without sending `done: true`, the route was
    // almost certainly killed (e.g. maxDuration exceeded, process crashed, or
    // proxy cut the connection). Surface that as a clear error so the UI can offer
    // a "Continue" button instead of silently ending.
    if (!receivedDone) {
      const elapsedHint = lastError ? `: ${lastError}` : " (stream ended without completion)";
      const err = new Error(
        `GIA response was cut off${elapsedHint}. ` +
        `Click **Continue** in the GIA header to resume generating from where it stopped.`
      );
      (err as Error & { truncated?: boolean }).truncated = true;
      throw err;
    }
  },
};

// Bookmarks API
export const bookmarksApi = {
  list: () =>
    fetchJSON<Array<{ id: string; connectionId: string; path: string; label: string | null; sortOrder: number | null }>>("/bookmarks"),

  create: (data: { connectionId: string; path: string; label?: string }) =>
    fetchJSON<{ id: string }>("/bookmarks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchJSON<{ success: boolean }>(`/bookmarks/${id}`, { method: "DELETE" }),
};
