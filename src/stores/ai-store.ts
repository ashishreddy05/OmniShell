"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  context?: AIContext;
  /** Estimated tokens in this message (approx 4 chars/token) */
  estTokens?: number;
}

export interface AIContext {
  connectionId?: string;
  file?: { path: string; content?: string; language?: string };
  terminal?: { output?: string; tail?: number };
  service?: { name: string };
  logs?: { serviceName: string; lines?: number; content?: string };
}

export type AiPhase = "idle" | "thinking" | "tool_use";

export interface AIChat {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const MAX_CHATS = 20;

function newId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const raw = (firstUser?.content || "New chat").replace(/\s+/g, " ").trim();
  return raw.length > 42 ? `${raw.slice(0, 42)}…` : raw || "New chat";
}

function emptyChat(): AIChat {
  const id = newId();
  return { id, title: "New chat", messages: [], updatedAt: Date.now() };
}

interface AIStore {
  open: boolean;
  /** All chats (browser localStorage only — no VM load) */
  chats: AIChat[];
  activeChatId: string;
  /** Convenience: messages of the active chat */
  messages: ChatMessage[];
  currentContext: AIContext | null;
  streaming: boolean;
  phase: AiPhase;
  pendingPrompt: string | null;
  regenerateCount: number;
  lastResponseTruncated: boolean;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setContext: (ctx: AIContext | null) => void;
  addMessage: (msg: ChatMessage) => void;
  appendToLast: (chunk: string) => void;
  setStreaming: (streaming: boolean) => void;
  setPhase: (phase: AiPhase) => void;
  /** Clear active chat messages (keep the chat slot) */
  clearHistory: () => void;
  deleteMessage: (id: string) => void;
  clearLastMessage: () => void;
  setPendingPrompt: (prompt: string | null) => void;
  popLastAssistant: () => string | undefined;
  incrementRegenerate: () => void;
  setLastResponseTruncated: (truncated: boolean) => void;
  /** Start a fresh chat; archives the current one if it has messages */
  newChat: () => void;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => void;
}

function syncActive(chats: AIChat[], activeChatId: string): { chats: AIChat[]; activeChatId: string; messages: ChatMessage[] } {
  let list = chats;
  let active = list.find((c) => c.id === activeChatId);
  if (!active) {
    if (list.length === 0) {
      const c = emptyChat();
      list = [c];
      active = c;
    } else {
      active = list[0];
    }
  }
  return { chats: list, activeChatId: active.id, messages: active.messages };
}

function updateActive(
  s: { chats: AIChat[]; activeChatId: string },
  updater: (chat: AIChat) => AIChat,
): { chats: AIChat[]; activeChatId: string; messages: ChatMessage[] } {
  const chats = s.chats.map((c) => (c.id === s.activeChatId ? updater(c) : c));
  return syncActive(chats, s.activeChatId);
}

export const useAIStore = create<AIStore>()(
  persist(
    (set, get) => {
      const initial = emptyChat();
      return {
        open: false,
        chats: [initial],
        activeChatId: initial.id,
        messages: [],
        currentContext: null,
        streaming: false,
        phase: "idle",
        pendingPrompt: null,
        regenerateCount: 0,
        lastResponseTruncated: false,

        toggle: () => set((s) => ({ open: !s.open })),
        setOpen: (open) => set({ open }),
        setContext: (currentContext) => set({ currentContext }),

        addMessage: (msg) =>
          set((s) => {
            const withTokens = { ...msg, estTokens: Math.ceil((msg.content?.length || 0) / 4) };
            return updateActive(s, (chat) => {
              const messages = [...chat.messages, withTokens];
              return {
                ...chat,
                messages,
                title: chat.messages.length === 0 ? titleFromMessages(messages) : chat.title,
                updatedAt: Date.now(),
              };
            });
          }),

        appendToLast: (chunk) =>
          set((s) => {
            if (s.messages.length === 0) return s;
            return updateActive(s, (chat) => {
              const messages = [...chat.messages];
              const last = messages[messages.length - 1];
              if (last.role !== "assistant") return chat;
              const content = last.content + chunk;
              messages[messages.length - 1] = {
                ...last,
                content,
                estTokens: Math.ceil(content.length / 4),
              };
              return { ...chat, messages, updatedAt: Date.now() };
            });
          }),

        setStreaming: (streaming) => set({ streaming }),
        setPhase: (phase) => set({ phase }),

        clearHistory: () =>
          set((s) => ({
            ...updateActive(s, (chat) => ({
              ...chat,
              messages: [],
              title: "New chat",
              updatedAt: Date.now(),
            })),
            regenerateCount: 0,
            lastResponseTruncated: false,
          })),

        deleteMessage: (id) =>
          set((s) =>
            updateActive(s, (chat) => ({
              ...chat,
              messages: chat.messages.filter((m) => m.id !== id),
              updatedAt: Date.now(),
            })),
          ),

        clearLastMessage: () =>
          set((s) => {
            if (s.messages.length === 0) return s;
            return updateActive(s, (chat) => {
              const messages = [...chat.messages];
              const last = messages[messages.length - 1];
              if (last.role !== "assistant") return chat;
              messages[messages.length - 1] = { ...last, content: "" };
              return { ...chat, messages };
            });
          }),

        setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),

        popLastAssistant: () => {
          const s = get();
          if (s.messages.length === 0) return undefined;
          const last = s.messages[s.messages.length - 1];
          if (last.role !== "assistant") return undefined;
          set((state) => ({
            ...updateActive(state, (chat) => ({
              ...chat,
              messages: chat.messages.slice(0, -1),
              updatedAt: Date.now(),
            })),
            lastResponseTruncated: false,
          }));
          return last.content;
        },

        incrementRegenerate: () => set((s) => ({ regenerateCount: s.regenerateCount + 1 })),
        setLastResponseTruncated: (lastResponseTruncated) => set({ lastResponseTruncated }),

        newChat: () => {
          const s = get();
          if (s.streaming) return;
          // If active is already empty, just focus it
          if (s.messages.length === 0) {
            set({ regenerateCount: 0, lastResponseTruncated: false, phase: "idle" });
            return;
          }
          const archived = s.chats.map((c) =>
            c.id === s.activeChatId
              ? { ...c, title: titleFromMessages(c.messages), updatedAt: Date.now() }
              : c,
          );
          const next = emptyChat();
          let chats = [next, ...archived];
          if (chats.length > MAX_CHATS) {
            // Drop oldest empty-or-oldest beyond cap (keep newest)
            chats = chats.slice(0, MAX_CHATS);
          }
          set({
            chats,
            activeChatId: next.id,
            messages: [],
            regenerateCount: 0,
            lastResponseTruncated: false,
            phase: "idle",
          });
        },

        switchChat: (id) => {
          const s = get();
          if (s.streaming || id === s.activeChatId) return;
          // Persist title on current before leave
          const chats = s.chats.map((c) =>
            c.id === s.activeChatId
              ? { ...c, title: titleFromMessages(c.messages) || c.title, updatedAt: Date.now(), messages: s.messages }
              : c,
          );
          const synced = syncActive(chats, id);
          set({
            ...synced,
            regenerateCount: 0,
            lastResponseTruncated: false,
            phase: "idle",
          });
        },

        deleteChat: (id) => {
          const s = get();
          if (s.streaming) return;
          let chats = s.chats.filter((c) => c.id !== id);
          if (chats.length === 0) chats = [emptyChat()];
          const nextId = id === s.activeChatId ? chats[0].id : s.activeChatId;
          set({
            ...syncActive(chats, nextId),
            regenerateCount: 0,
            lastResponseTruncated: false,
            phase: "idle",
          });
        },
      };
    },
    {
      name: "ai-assistant",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        chats: s.chats,
        activeChatId: s.activeChatId,
        regenerateCount: s.regenerateCount,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<AIStore> & { messages?: ChatMessage[] };
        // Migrate legacy single-thread persist → multi-chat
        if ((!p.chats || p.chats.length === 0) && Array.isArray(p.messages) && p.messages.length > 0) {
          const id = newId();
          const chat: AIChat = {
            id,
            title: titleFromMessages(p.messages),
            messages: p.messages,
            updatedAt: Date.now(),
          };
          return {
            ...current,
            ...p,
            chats: [chat],
            activeChatId: id,
            messages: p.messages,
          };
        }
        const chats = p.chats?.length ? p.chats : current.chats;
        const activeChatId = p.activeChatId || current.activeChatId;
        const synced = syncActive(chats, activeChatId);
        return { ...current, ...p, ...synced };
      },
    },
  ),
);
