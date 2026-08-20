"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Sparkles, X, Send, Square, Trash2, FileText, Terminal as TerminalIcon,
  Activity, ScrollText, Loader2, Copy, Check, Play, RotateCcw, Mic, MicOff,
  RefreshCw, Download, RotateCcwSquare, History, Zap, ChevronDown, Wrench, FileSearch, ListTree, Server,
  Maximize2, Minimize2, Eye, Plus, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAIStore } from "@/stores/ai-store";
import { WriteFileDialog } from "./write-file-dialog";
import { StructuredMessage } from "./structured-message";
import { aiApi, servicesApi, connectionsApi, fsApi, type AIContextPayload } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useWatchStore } from "@/stores/watch-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import type { Connection } from "@/lib/db/schema";
import { formatSearchServiceLogsResult } from "@/lib/search-logs-diagnosis";

/** Tools that only read remote state — still require Approve, never auto-run. */
const READ_ONLY_TOOLS = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "list_services",
  "search_service_logs",
]);

function resolveConnName(queryClient: QueryClient, connId: unknown): string {
  const connList = queryClient.getQueryData<Connection[]>(["connections"]) || [];
  const conn = connList.find((c) => c.id === connId);
  return conn?.name || (typeof connId === "string" ? connId : "unknown");
}

function countLogLines(body: string): number {
  const t = (body || "").trim();
  return t ? t.split("\n").length : 0;
}

const SUGGESTIONS = [
  { label: "Explain current file", icon: FileText, prompt: "Explain this file and any issues you see." },
  { label: "Analyze live logs", icon: ScrollText, prompt: "Analyze the recent logs and identify any errors, root causes, and fixes." },
  { label: "Diagnose service", icon: Activity, prompt: "Investigate why this service might be failing. Use seeded state/logs first; if thin, propose approved tools (status/journal/RSS). Summarize root cause + fix — do not restart unless I ask." },
  { label: "Investigate memory", icon: Activity, prompt: "Investigate memory for the current or watched service. Use seeded Memory if present; if thin, propose approved tools for systemctl status / journal / RSS. Classify leak vs spike vs OOM vs normal. Do NOT restart unless I ask." },
  { label: "Restart H&G agents", icon: RotateCcw, prompt: "Restart all H&G / Hoops & Gears voice agents. Resolve names from Watched Services; if none pinned, list_services and filter hg/hoops/gears/gia_hg. Then restart once and summarize." },
  { label: "Find call_id in logs", icon: ScrollText, prompt: "Find a call_id in service logs using search_service_logs on the Active Service (ask me for the call_id if missing). Say you used search_service_logs, then diagnose duration, errors, voice tools, and outcome — cite status codes/tool names only, do not paste raw logs." },
  { label: "List running services", icon: Server, prompt: "List all systemd services and identify any that are failed or inactive." },
  { label: "Find config files", icon: FileSearch, prompt: "Search the server for configuration files (*.conf, *.yaml, *.cfg) and summarize what services they configure." },
];

export function AIPanel() {
  const queryClient = useQueryClient();
  const {
    open, toggle, setOpen,
    messages, addMessage, appendToLast, clearLastMessage, setStreaming, streaming,
    phase, setPhase,
    currentContext, setContext, clearHistory,
    pendingPrompt, setPendingPrompt,
    lastResponseTruncated, setLastResponseTruncated,
    chats, activeChatId, newChat, switchChat, deleteChat,
  } = useAIStore();
  const activeChatTitle = chats.find((c) => c.id === activeChatId)?.title || "New chat";
  const chatList = useMemo(
    () => [...chats].sort((a, b) => b.updatedAt - a.updatedAt),
    [chats],
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingFunctionCalls, setPendingFunctionCalls] = useState<Array<{ name: string; args: Record<string, any> }>>([]);
  const pendingFunctionCall = pendingFunctionCalls[0] ?? null;
  const [writeFileDraft, setWriteFileDraft] = useState<{ path: string; content: string; connectionId: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Accumulates tool results until the whole approval queue is drained, then continueConversation once. */
  const toolResultsRef = useRef<Array<{ name: string; args: Record<string, unknown>; result: string }>>([]);
  /** Tools already succeeded this user turn — skip re-queue if the model re-emits them. */
  const completedToolKeysRef = useRef<Set<string>>(new Set());

  const handleNewChat = useCallback(() => {
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
    }
    setPendingFunctionCalls([]);
    toolResultsRef.current = [];
    completedToolKeysRef.current = new Set();
    newChat();
    setInput("");
    setError(null);
  }, [streaming, newChat, setStreaming]);

  const handleSwitchChat = useCallback((id: string) => {
    if (streaming) return;
    setPendingFunctionCalls([]);
    toolResultsRef.current = [];
    completedToolKeysRef.current = new Set();
    switchChat(id);
    setInput("");
    setError(null);
  }, [streaming, switchChat]);
  /** Live pending-approval count — avoids stale React state in stream finally / continue guards. */
  const pendingFcLenRef = useRef(0);
  /** Queue continueConversation if a stream is still in flight (never silently drop). */
  const continueQueueRef = useRef<Array<{ name: string; args: Record<string, unknown>; result: string }> | null>(null);
  /** Stable handle so send()'s finally can drain the queue without a circular hook dep. */
  const continueConversationRef = useRef<(
    functionResponses: Array<{ name: string; args: Record<string, unknown>; result: string }>,
  ) => Promise<void>>(async () => {});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const setPendingFc = useCallback((
    updater: (prev: Array<{ name: string; args: Record<string, unknown> }>) => Array<{ name: string; args: Record<string, unknown> }>,
  ) => {
    setPendingFunctionCalls((prev) => {
      const next = updater(prev);
      pendingFcLenRef.current = next.length;
      return next;
    });
  }, []);

  /** If the last assistant bubble is still empty and nothing is awaiting approval, show a fallback + toast. */
  const ensureAssistantReply = useCallback((fallback: string) => {
    if (pendingFcLenRef.current > 0) return;
    const last = useAIStore.getState().messages.at(-1);
    if (!last || last.role !== "assistant" || last.content.trim()) return;
    appendToLast(fallback);
    toast.error("GIA returned an empty reply");
  }, [appendToLast]);

  const buildToolSummaryFallback = useCallback((
    responses: Array<{ name: string; args: Record<string, unknown>; result: string }>,
  ) => {
    const lines = responses.map((fr) => {
      const failed = fr.result.startsWith("Error:") || fr.result.startsWith("[CANCELLED");
      const detail =
        fr.name === "service_action"
          ? ` ${(fr.args.action as string) || ""} ${(Array.isArray(fr.args.serviceNames) ? fr.args.serviceNames : []).join(", ")}`
          : fr.name === "daemon_reload"
            ? " systemctl daemon-reload"
            : fr.name === "list_services"
              ? " list systemd units"
              : fr.name === "search_service_logs"
                ? ` ${String(fr.args.serviceName || "")} ${String(fr.args.query || "")}`
                : fr.name === "read_file"
                  ? ` ${String(fr.args.path || "")}`
                  : "";
      return `- ${failed ? "❌" : "✅"} \`${fr.name}\`${detail.trim() ? ` — ${detail.trim()}` : ""}: ${failed ? fr.result.slice(0, 160) : "ok"}`;
    });
    const anyFail = responses.some((fr) => fr.result.startsWith("Error:") || fr.result.startsWith("[CANCELLED"));
    return `\n\n**Result:** ${anyFail ? "❌ Some tools failed" : "✅ Tools completed"}\n**STEPS TAKEN**\n${lines.join("\n")}`;
  }, []);

  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";

        rec.onstart = () => {
          setIsListening(true);
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onresult = (e: any) => {
          const text = e.results[0][0].transcript;
          setInput((prev) => prev ? `${prev} ${text}` : text);
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onerror = (e: any) => {
          console.error("Speech recognition error", e);
          toast.error(`Voice input error: ${e.error}`);
          setIsListening(false);
        };

        rec.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = rec;
      }
    }
  }, []);

  const toggleListen = () => {
    if (!recognitionRef.current) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggle, setOpen]);

  // Handle automatic diagnosis/prompt triggers
  useEffect(() => {
    if (pendingPrompt) {
      const p = pendingPrompt;
      setPendingPrompt(null);
      if (!streaming) {
        send(p);
      }
    }
  }, [pendingPrompt, streaming, setPendingPrompt]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setPhase(pendingFcLenRef.current > 0 ? "tool_use" : "idle");
  }, [setStreaming, setPhase]);

  const send = useCallback(async (promptOverride?: string) => {
    const text = (promptOverride ?? input).trim();
    if (!text || streaming) return;

    setError(null);
    setInput("");
    setPendingFc(() => []);
    toolResultsRef.current = [];
    continueQueueRef.current = null;
    completedToolKeysRef.current = new Set();

    const userMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: "user" as const,
      content: text,
      ts: Date.now(),
      context: currentContext ?? undefined,
    };
    addMessage(userMsg);

    const assistantId = `msg-${Date.now() + 1}-${Math.random().toString(36).slice(2)}`;
    addMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      ts: Date.now(),
    });

    setStreaming(true);
    setPhase("thinking");
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const history = messages
        .filter((m) => m.id !== userMsg.id && m.id !== assistantId)
        .map((m) => ({ role: m.role, content: m.content }));

      // Extract current connections, dashboard watch list, and explorer path
      const connList = queryClient.getQueryData<Connection[]>(["connections"]) || [];
      const connStoreState = useConnectionStore.getState();
      const connectionsPayload = connList.map((c) => ({
        id: c.id,
        name: c.name,
        status: connStoreState.activeConnections.get(c.id)?.status || "disconnected",
      }));

      const watchedList = useWatchStore.getState().watched;
      const watchedPayload = watchedList.map((w) => ({
        connectionId: w.connectionId,
        serviceName: w.serviceName,
      }));

      const explorerStore = useExplorerStore.getState();
      const activeConnId = connStoreState.activeTabId;
      const currentPath = activeConnId ? explorerStore.getExplorer(activeConnId)?.currentPath : undefined;

      const contextPayload: AIContextPayload | undefined = currentContext
        ? {
            connectionId: currentContext.connectionId,
            file: currentContext.file,
            terminal: currentContext.terminal,
            service: currentContext.service,
            logs: currentContext.logs,
            currentPath,
          }
        : undefined;

      await aiApi.ask(
        text,
        history,
        contextPayload,
        (chunk) => appendToLast(chunk),
        ctrl.signal,
        (fc) => {
          const key = fc.name + JSON.stringify(fc.args);
          if (completedToolKeysRef.current.has(key)) return;
          setPendingFc((prev) => {
            if (prev.some((p) => p.name + JSON.stringify(p.args) === key)) return prev;
            return [...prev, fc];
          });
          setPhase("tool_use");
        },
        () => clearLastMessage(),
        connectionsPayload,
        watchedPayload,
      );
    } catch (e) {
      const err = e as Error & { truncated?: boolean };
      if (err.name === "AbortError") {
        appendToLast("\n\n_[stopped]_");
        setLastResponseTruncated(false);
      } else if (err.truncated) {
        appendToLast(`\n\n_⚠️ ${err.message}_`);
        setLastResponseTruncated(true);
      } else {
        setError(err.message);
        appendToLast(`\n\n_Error: ${err.message}_`);
        setLastResponseTruncated(false);
      }
    } finally {
      setStreaming(false);
      setPhase(pendingFcLenRef.current > 0 ? "tool_use" : "idle");
      abortRef.current = null;
      ensureAssistantReply("_No response from GIA. Try rephrasing or tap Regenerate._");
      const queued = continueQueueRef.current;
      if (queued) {
        continueQueueRef.current = null;
        setTimeout(() => continueConversationRef.current(queued), 0);
      }
    }
  }, [input, streaming, currentContext, messages, addMessage, appendToLast, setStreaming, setPhase, setLastResponseTruncated, queryClient, setPendingFc, ensureAssistantReply]);

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const continueConversation = useCallback(async (
    functionResponses: Array<{
      name: string;
      args: Record<string, unknown>;
      result: string;
    }>
  ) => {
    // Never silently drop — if a stream is still open, queue and drain in finally.
    if (useAIStore.getState().streaming) {
      continueQueueRef.current = [
        ...(continueQueueRef.current ?? []),
        ...functionResponses,
      ];
      return;
    }

    setStreaming(true);
    setPhase("thinking");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const contentBefore = useAIStore.getState().messages.at(-1)?.content ?? "";

    try {
      const allMessages = useAIStore.getState().messages;
      const history = allMessages.map((m) => ({ role: m.role, content: m.content }));

      const connList = queryClient.getQueryData<Connection[]>(["connections"]) || [];
      const connStoreState = useConnectionStore.getState();
      const connectionsPayload = connList.map((c) => ({
        id: c.id,
        name: c.name,
        status: connStoreState.activeConnections.get(c.id)?.status || "disconnected",
      }));

      const watchedList = useWatchStore.getState().watched;
      const watchedPayload = watchedList.map((w) => ({
        connectionId: w.connectionId,
        serviceName: w.serviceName,
      }));

      const explorerStore = useExplorerStore.getState();
      const activeConnId = connStoreState.activeTabId;
      const currentPath = activeConnId ? explorerStore.getExplorer(activeConnId)?.currentPath : undefined;

      const contextPayload: AIContextPayload | undefined = currentContext
        ? {
            connectionId: currentContext.connectionId,
            file: currentContext.file,
            terminal: currentContext.terminal,
            service: currentContext.service,
            logs: currentContext.logs,
            currentPath,
          }
        : undefined;

      const continuationParts = functionResponses.map((fr) => {
        const argsStr = JSON.stringify(fr.args, null, 2);
        return `[Function Result: ${fr.name}]\nArguments:\n\`\`\`json\n${argsStr}\n\`\`\`\nResult:\n\`\`\`\n${fr.result}\n\`\`\``;
      }).join("\n\n");

      const continuationPrompt = `${continuationParts}\n\nFunction results are above. Continue ONLY if the original user request is still incomplete.
Rules:
- Do not repeat any tool with the same arguments that already succeeded above.
- daemon_reload at most once per connection unless a unit file was written after the last reload.
- ALWAYS reply — never empty. Required format:
  **Result:** ✅ or ❌ one-line outcome
  **STEPS TAKEN:** bullets (tool + service/path names + ok/fail)
  Then diagnosis/next steps grounded in the tool output.
- If the last tool was search_service_logs, your reply MUST diagnose relative to the user question (e.g. appointment not booked → GIA_BOOK_APPOINTMENT / book_appointment success/fail). Cite tool names + status codes + key events only — NEVER paste raw logs into the reply. If the user pasted a call transcript, reconcile transcript claims vs log truth. Suggest Service Manager → Search logs for the full window. Open with that you used \`search_service_logs\`.
- If cohort resolution needed names and Watched was empty, list_services results above are authoritative — filter and act (or ask once if zero matches).
- If the request is complete, reply with Result + STEPS TAKEN and call no tools.
- At most one verification step after mutations, then stop.`;

      await aiApi.ask(
        continuationPrompt,
        history,
        contextPayload,
        (chunk) => appendToLast(chunk),
        ctrl.signal,
        (fc) => {
          const key = fc.name + JSON.stringify(fc.args);
          if (completedToolKeysRef.current.has(key)) return;
          setPendingFc((prev) => {
            if (prev.some((p) => p.name + JSON.stringify(p.args) === key)) return prev;
            return [...prev, fc];
          });
          setPhase("tool_use");
        },
        // Don't wipe tool-status lines already appended to this message.
        () => {
          const last = useAIStore.getState().messages.at(-1);
          if (last?.role === "assistant" && /_(✅|❌|⏳|⚙️|📂|📋|📝|🔍|🚫|🔌)/.test(last.content)) return;
          clearLastMessage();
        },
        connectionsPayload,
        watchedPayload,
      );
    } catch (e) {
      const err = e as Error & { truncated?: boolean };
      if (err.name === "AbortError") {
        appendToLast("\n\n_[stopped]_");
        setLastResponseTruncated(false);
      } else if (err.truncated) {
        appendToLast(`\n\n_⚠️ ${err.message}_`);
        setLastResponseTruncated(true);
      } else {
        setError(err.message);
        appendToLast(`\n\n_Error: ${err.message}_`);
        setLastResponseTruncated(false);
      }
    } finally {
      setStreaming(false);
      setPhase(pendingFcLenRef.current > 0 ? "tool_use" : "idle");
      abortRef.current = null;
      // Model returned nothing new after tools — force a visible STEPS TAKEN summary.
      if (pendingFcLenRef.current === 0) {
        const last = useAIStore.getState().messages.at(-1);
        if (last?.role === "assistant" && last.content.trim() === contentBefore.trim()) {
          appendToLast(buildToolSummaryFallback(functionResponses));
          if (!contentBefore.trim()) toast.error("GIA returned an empty reply");
        }
      }
      const queued = continueQueueRef.current;
      if (queued) {
        continueQueueRef.current = null;
        setTimeout(() => continueConversationRef.current(queued), 0);
      }
    }
  }, [currentContext, appendToLast, clearLastMessage, setPhase, setLastResponseTruncated, queryClient, setPendingFc, buildToolSummaryFallback, setStreaming]);

  continueConversationRef.current = continueConversation;
  /** Dequeue current approval; only resume the model once the whole batch is done. */
  const finishPendingTool = useCallback((
    entry: { name: string; args: Record<string, unknown>; result: string } | null,
  ) => {
    if (entry) {
      toolResultsRef.current.push(entry);
      const failed = entry.result.startsWith("Error:") || entry.result.startsWith("[CANCELLED");
      if (!failed) {
        completedToolKeysRef.current.add(entry.name + JSON.stringify(entry.args));
      }
    }
    setPendingFc((prev) => {
      const next = prev.slice(1);
      if (next.length === 0 && toolResultsRef.current.length > 0) {
        const batch = [...toolResultsRef.current];
        toolResultsRef.current = [];
        setTimeout(() => continueConversationRef.current(batch), 50);
      }
      return next;
    });
  }, [setPendingFc]);

  /** Ensures the given connection is active. Auto-connects if needed. */
  const ensureConnection = useCallback(async (targetConnectionId: string) => {
    const connStore = useConnectionStore.getState();
    const active = connStore.activeConnections.get(targetConnectionId);
    if (active?.status === "connected") return;
    const connList = queryClient.getQueryData<Connection[]>(["connections"]) || [];
    const connection = connList.find((c) => c.id === targetConnectionId);
    if (!connection) throw new Error(`Connection not found: ${targetConnectionId}`);
    toast.info(`Connecting to ${connection.name}...`);
    connStore.setConnectionStatus(targetConnectionId, connection, "connecting");
    await connectionsApi.connect(targetConnectionId);
    connStore.setConnectionStatus(targetConnectionId, connection, "connected");
    connStore.setActiveTab(targetConnectionId);
    toast.success(`Connected to ${connection.name}`);
  }, [queryClient]);

  const handleApproveAction = useCallback(async () => {
    const fc = pendingFunctionCall;
    if (!fc) return;
    const { name, args } = fc;
    let functionResult: string | null = null;

    if (name === "service_action") {
      const action = args.action as "start" | "stop" | "restart" | "enable" | "disable";
      const serviceNames: string[] = Array.isArray(args.serviceNames) ? args.serviceNames : [args.serviceNames];
      const targetConnectionId = args.connectionId as string;

      if (!targetConnectionId) {
        toast.error("No server connection specified for this service action");
        appendToLast(`\n\n_❌ ${action} action failed: No server connection specified._`);
        functionResult = `Error: No server connection specified.`;
      } else {
        try {
          const connList = queryClient.getQueryData<Connection[]>(["connections"]) || [];
          const connection = connList.find((c) => c.id === targetConnectionId);
          if (!connection) throw new Error(`Server connection details not found for ID: ${targetConnectionId}`);

          await ensureConnection(targetConnectionId);
          appendToLast(`\n\n_⚙️ Running ${action} on services: ${serviceNames.map(n => `\`${n}\``).join(", ")}_`);

          const results: string[] = [];
          for (const svc of serviceNames) {
            try {
              appendToLast(`\n\n_⏳ Executing ${action} on \`${svc}\`..._`);
              await servicesApi.act(targetConnectionId, svc, action);
              appendToLast(`\n_✅ \`${svc}\` completed successfully._`);
              results.push(`${svc}: ok`);
            } catch (err) {
              appendToLast(`\n_❌ \`${svc}\` failed: ${(err as Error).message}_`);
              results.push(`${svc}: fail — ${(err as Error).message}`);
            }
          }

          const failCount = results.filter((r) => r.includes(": fail")).length;
          const okCount = results.length - failCount;
          if (failCount === 0) toast.success(`All ${okCount} service action(s) completed`);
          else toast.error(`${failCount} of ${results.length} service action(s) failed`);

          functionResult = `Action: ${action}\nConnection: ${connection.name} (${targetConnectionId})\nServices: ${serviceNames.join(", ")}\nPer-service:\n${results.join("\n")}\nSummary: ${okCount} ok, ${failCount} failed.`;
        } catch (err) {
          toast.error(`Action failed: ${(err as Error).message}`);
          functionResult = `Error: ${(err as Error).message}`;

          const connList = queryClient.getQueryData<Connection[]>(["connections"]) || [];
          const connection = connList.find((c) => c.id === targetConnectionId);
          if (connection && useConnectionStore.getState().activeConnections.get(targetConnectionId)?.status !== "connected") {
            useConnectionStore.getState().setConnectionStatus(targetConnectionId, connection, "error", (err as Error).message);
          }
        }
      }
    } else if (name === "read_file") {
      const { path, connectionId } = args;
      if (!path || !connectionId) {
        toast.error("Invalid file read parameters");
        appendToLast(`\n\n_❌ Read file failed: Invalid parameters._`);
        functionResult = `Error: Invalid parameters. path=${path}, connectionId=${connectionId}`;
      } else {
        const filePath = (path as string).toLowerCase();
        const isEnv = filePath.endsWith(".env") || filePath.includes("/.env") || filePath.includes("\\.env");
        if (isEnv) {
          toast.error("Reading .env files is blocked for security");
          appendToLast(`\n\n_❌ Read file blocked: Reading .env files is restricted._`);
          functionResult = `Error: Reading .env files is blocked.`;
        } else {
          try {
            await ensureConnection(connectionId as string);

            toast.info(`Reading file \`${path}\`...`);
            appendToLast(`\n\n_⏳ Reading file \`${path}\`..._`);
            
            const res = await fsApi.read(connectionId as string, path as string);
            
            toast.success(`Read ${(path as string).split("/").pop()} completed`);
            
            const BINARY_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".mp4", ".webm", ".mov", ".avi", ".mp3", ".wav", ".flac", ".aac", ".m4a", ".pdf", ".zip", ".gz", ".tar", ".bin", ".exe", ".dmg", ".pkg", ".so", ".dll", ".o", ".a", ".lib"];
            const fileExt = "." + (path as string).split(".").pop()?.toLowerCase();
            const isBinary = BINARY_EXTS.includes(fileExt) || (res.content || "").includes("\x00") || (res.content || "").includes("\uFFFD");

            let content = res.content || "";
            if (isBinary) {
              content = content.slice(0, 500);
            }
            if (content.length > 5000) {
              content = content.slice(0, 5000) + "\n... [truncated for chat view]";
            }

            if (isBinary) {
              appendToLast(`\n_⚠️ File \`${path}\` appears to be binary. Showing preview in editor instead._`);
              functionResult = `[Binary file: ${path}. Content cannot be displayed in chat. The user can open it in the editor to view. File size: ${res.content?.length ?? "?"} bytes.]`;
            } else {
              appendToLast(`\n_✅ File read successfully._\n\n\`\`\`path=${path}\n${content}\n\`\`\``);
              functionResult = `File ${path} content:\n${content}`;
            }
          } catch (err) {
            toast.error(`Read file failed: ${(err as Error).message}`);
            appendToLast(`\n_❌ Read file failed: ${(err as Error).message}_`);
            functionResult = `Error reading ${path}: ${(err as Error).message}`;
          }
        }
      }
    } else if (name === "write_file") {
      const { path, content, connectionId: targetConnectionId } = args;
      if (!path || !targetConnectionId) {
        toast.error("Invalid write parameters");
        appendToLast(`\n\n_❌ Write failed: Missing path or connectionId._`);
        finishPendingTool({
          name,
          args,
          result: "Error: Missing path or connectionId.",
        });
        return;
      }
      const lower = (path as string).toLowerCase();
      const isEnv = lower.endsWith(".env") || lower.includes("/.env") || lower.includes("\\.env") || lower.includes("/.ssh/") || lower.includes("\\.ssh\\");
      if (isEnv) {
        toast.error("Writing .env / credential files is blocked");
        appendToLast(`\n\n_❌ Write blocked: writing to .env or ~/.ssh paths is not allowed._`);
        finishPendingTool({
          name,
          args,
          result: "Error: Writing to .env or ~/.ssh paths is not allowed.",
        });
        return;
      }
      // Keep write_file at queue head until dialog apply/cancel — avoids flushing the batch early
      appendToLast(`\n\n_📝 Opening diff preview for \`${path}\`..._`);
      setWriteFileDraft({ path: path as string, content: content as string, connectionId: targetConnectionId as string });
      return;
    } else if (name === "daemon_reload") {
      const targetConnectionId = args.connectionId as string;
      if (!targetConnectionId) {
        toast.error("No server connection specified");
        appendToLast(`\n\n_❌ daemon-reload failed: No server connection specified._`);
        functionResult = "Error: No server connection specified.";
      } else {
        try {
          await ensureConnection(targetConnectionId);
          toast.info("Reloading systemd daemon...");
          appendToLast(`\n\n_⏳ Running systemctl daemon-reload..._`);
          await servicesApi.daemonReload(targetConnectionId);
          toast.success("Daemon reloaded");
          appendToLast(`\n_✅ systemctl daemon-reload completed._`);
          functionResult = "systemctl daemon-reload completed successfully.";
        } catch (err) {
          toast.error(`Daemon reload failed: ${(err as Error).message}`);
          appendToLast(`\n_❌ daemon-reload failed: ${(err as Error).message}_`);
          functionResult = `Error: ${(err as Error).message}`;
        }
      }
    } else if (name === "run_command") {
      const { command, connectionId: targetConnectionId } = args;
      if (!command || !targetConnectionId) {
        toast.error("Invalid run command parameters");
        appendToLast(`\n\n_❌ Run command failed: Invalid parameters._`);
        functionResult = `Error: Invalid parameters. command=${command}, connectionId=${targetConnectionId}`;
      } else {
        try {
          await ensureConnection(targetConnectionId as string);

          toast.info(`Running command...`);
          appendToLast(`\n\n_⏳ Running: \`${command}\`_`);
          const output = await servicesApi.runCommand(targetConnectionId as string, command as string);
          const stdout = output.stdout?.trim();
          const stderr = output.stderr?.trim();
          if (stdout) {
            appendToLast(`\n\n\`\`\`\n${stdout.slice(0, 3000)}\n\`\`\``);
          }
          if (stderr) {
            appendToLast(`\n\n_⚠️ stderr:_\n\`\`\`\n${stderr.slice(0, 1000)}\n\`\`\``);
          }
          if (!stdout && !stderr) {
            appendToLast(`\n_✅ Command completed (no output)._`);
          }
          toast.success("Command completed");
          functionResult = `Command: ${command}\nstdout:\n${stdout || "(empty)"}\nstderr:\n${stderr || "(empty)"}`;
        } catch (err) {
          toast.error(`Command failed: ${(err as Error).message}`);
          appendToLast(`\n_❌ Command failed: ${(err as Error).message}_`);
          functionResult = `Error: ${(err as Error).message}`;
        }
      }
    } else if (name === "list_directory") {
      const { path: dirPath, connectionId: targetConnectionId } = args;
      const listPath = (dirPath as string) || "/";
      if (!targetConnectionId) {
        toast.error("No server connection specified");
        appendToLast(`\n\n_❌ list_directory failed: No server connection specified._`);
        functionResult = "Error: No server connection specified.";
      } else {
        try {
          await ensureConnection(targetConnectionId as string);
          appendToLast(`\n\n_📂 Listing \`${listPath}\`..._`);
          const res = await fsApi.list(targetConnectionId as string, listPath);
          const entries = (res.entries || []).map((e: { name: string; type: string; size?: number; permissions?: string }) =>
            `- ${e.type === "directory" ? "📁" : "📄"} \`${e.name}\`${e.size !== undefined ? ` (${e.size} bytes)` : ""}${e.permissions ? ` [${e.permissions}]` : ""}`
          );
          const dirCount = (res.entries || []).filter((e: { type: string }) => e.type === "directory").length;
          const fileCount = (res.entries || []).filter((e: { type: string }) => e.type === "file").length;
          appendToLast(`\n\n_✅ ${res.entries?.length || 0} entries (${dirCount} dirs, ${fileCount} files):_\n\n${entries.slice(0, 80).join("\n")}${entries.length > 80 ? `\n\n_…and ${entries.length - 80} more_` : ""}`);
          functionResult = `Directory: ${listPath}\n${dirCount} directories, ${fileCount} files (${res.entries?.length || 0} total)\n\nEntries:\n${entries.join("\n")}`;
        } catch (err) {
          toast.error(`List failed: ${(err as Error).message}`);
          appendToLast(`\n_❌ List failed: ${(err as Error).message}_`);
          functionResult = `Error: ${(err as Error).message}`;
        }
      }
    } else if (name === "search_files") {
      const { pattern, path: searchPath, connectionId: targetConnectionId } = args;
      if (!pattern || !targetConnectionId) {
        toast.error("Invalid search_files parameters");
        appendToLast(`\n\n_❌ Search failed: Missing pattern or connectionId._`);
        functionResult = `Error: Missing pattern or connectionId.`;
      } else {
        try {
          await ensureConnection(targetConnectionId as string);
          const searchRoot = (searchPath as string) || "/";
          appendToLast(`\n\n_🔍 Searching for \`${pattern}\` in \`${searchRoot}\`..._`);
          const res = await fsApi.search(targetConnectionId as string, pattern as string, searchRoot, "name");
          const results = (res.results || []).slice(0, 50);
          const summary = results.length > 0
            ? results.map((r: { path: string; type: string }) => `- ${r.type === "directory" ? "📁" : "📄"} \`${r.path}\``).join("\n")
            : "_No files matched._";
          appendToLast(`\n\n_✅ ${results.length} match${results.length === 1 ? "" : "es"} (capped at 50):_\n\n${summary}`);
          functionResult = `Search pattern: ${pattern}\nSearch root: ${searchRoot}\nMatches: ${results.length}\n\nPaths:\n${results.map((r: { path: string }) => r.path).join("\n")}`;
        } catch (err) {
          toast.error(`Search failed: ${(err as Error).message}`);
          appendToLast(`\n_❌ Search failed: ${(err as Error).message}_`);
          functionResult = `Error: ${(err as Error).message}`;
        }
      }
    } else if (name === "list_services") {
      const targetConnectionId = args.connectionId as string;
      if (!targetConnectionId) {
        toast.error("No server connection specified");
        appendToLast(`\n\n_❌ list_services failed: No server connection specified._`);
        functionResult = "Error: No server connection specified.";
      } else {
        try {
          await ensureConnection(targetConnectionId as string);
          appendToLast(`\n\n_📋 Listing all systemd services..._`);
          const res = await servicesApi.list(targetConnectionId as string);
          const services = res.services || [];
          const byState = services.reduce<Record<string, typeof services>>((acc, s) => {
            (acc[s.state] ||= []).push(s);
            return acc;
          }, {});
          const stateSummary = Object.entries(byState)
            .map(([state, list]) => `  ${state}: ${list.length}`)
            .join("\n");
          const failedNames = (byState.failed || []).map((s) => s.name);
          const agentLike = services.filter((s) => /agent/i.test(s.name) || /-inbound-agent/i.test(s.name));
          const hgLike = agentLike.filter((s) => /hg|hoops|gears|gia_hg/i.test(s.name));
          const summary = services
            .slice(0, 60)
            .map((s) => `- \`${s.name}\` (${s.state})${s.description ? ` — ${s.description.slice(0, 60)}` : ""}`)
            .join("\n");
          appendToLast(`\n\n_✅ ${services.length} services total_\n\n${stateSummary}${services.length > 0 ? `\n\n${summary}${services.length > 60 ? `\n\n_…and ${services.length - 60} more_` : ""}` : ""}${failedNames.length > 0 ? `\n\n⚠️ **Failed services:** ${failedNames.map(n => `\`${n}\``).join(", ")}` : ""}${hgLike.length > 0 ? `\n\n**H&G-like agents:** ${hgLike.map(s => `\`${s.name}\` (${s.state})`).join(", ")}` : ""}`);
          functionResult = [
            `Total: ${services.length} services`,
            stateSummary,
            `Agent-like (*agent* / *-inbound-agent*): ${agentLike.length}`,
            agentLike.slice(0, 40).map((s) => `${s.name}: ${s.state}`).join("\n") || "(none)",
            `H&G-like (hg|hoops|gears|gia_hg): ${hgLike.length}`,
            hgLike.map((s) => `${s.name}: ${s.state}`).join("\n") || "(none)",
            failedNames.length ? `Failed: ${failedNames.join(", ")}` : "Failed: (none)",
            "All services:",
            services.map((s) => `${s.name}: ${s.state} — ${s.description || ""}`).join("\n"),
          ].join("\n\n");
        } catch (err) {
          toast.error(`List services failed: ${(err as Error).message}`);
          appendToLast(`\n_❌ List services failed: ${(err as Error).message}_`);
          functionResult = `Error: ${(err as Error).message}`;
        }
      }
    } else if (name === "search_service_logs") {
      const serviceName = args.serviceName as string;
      const query = (args.query as string) || (args.search as string);
      const targetConnectionId = args.connectionId as string;
      if (!serviceName || !query || !targetConnectionId) {
        toast.error("Invalid search_service_logs parameters");
        appendToLast(`\n\n_❌ Log search failed: Missing serviceName, query, or connectionId._`);
        functionResult = "Error: Missing serviceName, query, or connectionId.";
      } else {
        try {
          await ensureConnection(targetConnectionId);
          appendToLast(`\n\n_🔍 Searching logs for \`${query}\` in \`${serviceName}\` via \`search_service_logs\`..._`);
          const data = await servicesApi.logs(targetConnectionId, serviceName, { search: query });
          if ("context" in data && "startTimestamp" in data) {
            const body = data.context || "";
            const n = countLogLines(body);
            if (!body.trim()) {
              appendToLast(
                `\n\n_❌ \`search_service_logs\`: no matching logs for \`${query}\` on \`${serviceName}\`._`,
              );
            } else {
              appendToLast(
                `\n\n_🔍 \`search_service_logs\` \`${serviceName}\` / \`${query}\` ok (${n} lines, \`${data.startTimestamp}\` → \`${data.endTimestamp}\`)_`,
              );
            }
            functionResult = formatSearchServiceLogsResult({
              serviceName,
              query,
              start: data.startTimestamp,
              end: data.endTimestamp,
              body,
            });
          } else {
            const logs = ("logs" in data ? data.logs : "") || "";
            const n = countLogLines(logs);
            if (!logs.trim()) {
              appendToLast(
                `\n\n_❌ \`search_service_logs\`: no matching logs for \`${query}\` on \`${serviceName}\`._`,
              );
            } else {
              appendToLast(
                `\n\n_🔍 \`search_service_logs\` \`${serviceName}\` / \`${query}\` ok (${n} lines)_`,
              );
            }
            functionResult = formatSearchServiceLogsResult({ serviceName, query, body: logs });
          }
          toast.success("Log search completed");
        } catch (err) {
          toast.error(`Log search failed: ${(err as Error).message}`);
          appendToLast(`\n_❌ Log search failed: ${(err as Error).message}_`);
          functionResult = `Error: ${(err as Error).message}`;
        }
      }
    }

    finishPendingTool(
      functionResult !== null ? { name, args, result: functionResult } : null,
    );
  }, [pendingFunctionCall, appendToLast, queryClient, finishPendingTool, ensureConnection]);

  const handleRejectAction = useCallback(() => {
    const fc = pendingFunctionCall;
    if (!fc) return;
    const { name, args } = fc;
    appendToLast(`\n\n_🚫 Action cancelled by user._`);
    finishPendingTool({
      name,
      args,
      result: "[CANCELLED: User rejected this action. Try a different approach or ask what they'd like to do.]",
    });
  }, [pendingFunctionCall, appendToLast, finishPendingTool]);

  // Regenerate last assistant response: pop the last assistant message, re-send the previous user message
  const handleRegenerate = useCallback(() => {
    const { messages: msgs, popLastAssistant, incrementRegenerate } = useAIStore.getState();
    if (streaming) return;
    if (msgs.length < 2) return;
    // Find the last user message
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserPrompt = msgs[lastUserIdx].content;
    popLastAssistant();
    incrementRegenerate();
    setInput("");
    setTimeout(() => send(lastUserPrompt), 50);
  }, [streaming, send]);

  // Export conversation as Markdown
  const handleExport = useCallback(() => {
    const msgs = useAIStore.getState().messages;
    if (msgs.length === 0) {
      toast.info("Nothing to export yet");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const md = [
      `# GIA Conversation — ${new Date().toLocaleString()}`,
      "",
      ...msgs.flatMap((m) => {
        const role = m.role === "user" ? "## 👤 You" : "## ✨ GIA";
        const ts = new Date(m.ts).toLocaleString();
        return [`${role} _(${ts})_`, "", m.content, ""];
      }),
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gia-conversation-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Conversation exported");
  }, []);

  // Continue a truncated response: ask GIA to pick up where it left off.
  // We just re-send the same conversation (which includes the partial response),
  // prefixed with a "continue from where you stopped" instruction. GIA sees the
  // partial text in history and resumes naturally.
  const handleContinue = useCallback(() => {
    if (streaming) return;
    const { messages: msgs } = useAIStore.getState();
    if (msgs.length === 0) return;
    // Find last user prompt
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    // Strip any error/truncation markers from the last assistant message
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role === "assistant") {
      const cleaned = lastMsg.content
        .replace(/\n\n_⚠️ GIA response was cut off[\s\S]*$/, "")
        .replace(/\n\n_⚠️ Response timed out[\s\S]*$/, "")
        .replace(/\n\n_Error:[\s\S]*$/, "")
        .replace(/\n\n_\[stopped\]_$/, "");
      if (cleaned !== lastMsg.content) {
        useAIStore.setState((s) => {
          const messages = [...s.messages];
          messages[messages.length - 1] = { ...lastMsg, content: cleaned };
          return { messages, lastResponseTruncated: false };
        });
      } else {
        setLastResponseTruncated(false);
      }
    }
    // Send a "continue" prompt
    setTimeout(() => send("Continue from where you stopped. Pick up exactly where the previous response was cut off — do not restart or repeat what you already said."), 50);
  }, [streaming, send, setLastResponseTruncated]);

  // Approx token count for the whole conversation
  const totalEstTokens = useMemo(
    () => messages.reduce((sum, m) => sum + (m.estTokens || 0), 0),
    [messages]
  );

  // Count tool use events by scanning assistant content for function-result patterns
  // (We don't persist this separately, but the count is approximated from currentContext)
  const toolUseCount = useMemo(() => {
    let count = 0;
    for (const m of messages) {
      if (m.role === "assistant") {
        // Heuristic: count code blocks + function-result markers
        const matches = m.content.match(/\[Function Result:|✅|⚙️|🔌|⏳|📂|🔍|📋/g);
        if (matches) count += matches.length;
      }
    }
    return count;
  }, [messages]);

  // Handle pasting code: detect multi-line pastes and format as code block
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (text.includes("\n") && text.length > 60) {
      e.preventDefault();
      const current = input;
      const selection = window.getSelection()?.toString() || "";
      const newVal = current.includes(selection)
        ? current.replace(selection, `\`\`\`\n${text}\n\`\`\``)
        : `${current}\n\`\`\`\n${text}\n\`\`\``;
      setInput(newVal);
    }
  }, [input]);

  const [maximized, setMaximized] = useState(false);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed right-0 top-0 bottom-0 z-50 flex flex-col",
        maximized
          ? "w-full"
          : "w-[500px] max-w-[90vw]",
        "bg-background border-l border-border shadow-2xl",
        "animate-in slide-in-from-right duration-300 ease-out",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0 bg-gradient-to-r from-muted/30 to-transparent">
        <div className="h-6 w-6 rounded-md bg-violet-500/20 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <h2 className="text-sm font-semibold">GIA</h2>
        {phase !== "idle" && (
          <span className={cn(
            "flex items-center gap-1 text-[10px] font-medium ml-1",
            phase === "thinking" && "text-violet-400",
            phase === "tool_use" && "text-amber-400",
          )}>
            {phase === "thinking" ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
                Thinking
              </>
            ) : (
              <>
                <Wrench className="h-2.5 w-2.5" />
                Tool use
              </>
            )}
          </span>
        )}
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 font-mono flex items-center gap-1.5">
            <span>{messages.length} msg · ~{totalEstTokens.toLocaleString()} tok</span>
            {toolUseCount > 0 && (
              <span className="flex items-center gap-0.5 text-violet-400" title={`${toolUseCount} tool events`}>
                <Wrench className="h-2.5 w-2.5" />{toolUseCount}
              </span>
            )}
          </span>
        )}
        <div className="flex-1" />
        {lastResponseTruncated && !streaming && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] gap-1.5 text-amber-400 hover:text-amber-300 border border-amber-500/30 bg-amber-500/[0.08] hover:bg-amber-500/[0.15] px-2.5 animate-glow-once"
                onClick={handleContinue}
                title="The previous response was cut off. Click to ask GIA to continue from where it stopped."
                aria-label="Continue truncated response"
              >
                <Play className="h-3 w-3" />
                <span>Continue</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Resume from where it stopped</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-[9rem] gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              disabled={streaming}
              title="Switch chat"
            >
              <MessageSquare className="h-3 w-3 shrink-0" />
              <span className="truncate">{activeChatTitle}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
            <DropdownMenuItem
              onClick={() => handleNewChat()}
              className="text-xs gap-2"
              disabled={streaming}
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {chatList.map((c) => (
              <DropdownMenuItem
                key={c.id}
                className={cn(
                  "text-xs gap-2 group",
                  c.id === activeChatId && "bg-accent",
                )}
                onClick={() => handleSwitchChat(c.id)}
              >
                <MessageSquare className="h-3 w-3 shrink-0 opacity-60" />
                <span className="flex-1 truncate">{c.title || "New chat"}</span>
                <span className="text-[9px] text-muted-foreground tabular-nums">{c.messages.length}</span>
                {chats.length > 1 && (
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(c.id);
                    }}
                    title="Delete chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => handleNewChat()}
              disabled={streaming}
              title="New chat (keeps this one in history)"
              aria-label="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleRegenerate}
              disabled={streaming || messages.length < 2}
              title="Regenerate last response"
              aria-label="Regenerate last response"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Regenerate</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleExport}
              disabled={messages.length === 0}
              title="Export conversation as Markdown"
              aria-label="Export conversation"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Export .md</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={clearHistory} title="Clear this chat">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Clear this chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setMaximized((m) => !m)}
              title={maximized ? "Restore panel size" : "Maximize panel"}
              aria-label={maximized ? "Restore panel size" : "Maximize panel"}
            >
              {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{maximized ? "Restore" : "Maximize"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} title="Close (Esc)">
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close (Esc)</TooltipContent>
        </Tooltip>
      </div>

      {currentContext && (
        <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Context:</span>
          {currentContext.file && (
            <Badge variant="outline" className="text-[10px] font-mono gap-1 border-violet-500/20">
              <FileText className="h-2.5 w-2.5" />
              {currentContext.file.path.split("/").pop()}
            </Badge>
          )}
          {currentContext.service && (
            <Badge variant="outline" className="text-[10px] gap-1 border-green-500/20">
              <Activity className="h-2.5 w-2.5" />
              {currentContext.service.name}
            </Badge>
          )}
          {currentContext.terminal?.output && (
            <Badge variant="outline" className="text-[10px] gap-1 border-blue-500/20">
              <TerminalIcon className="h-2.5 w-2.5" />
              terminal
            </Badge>
          )}
          {currentContext.logs && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/20">
              <ScrollText className="h-2.5 w-2.5" />
              logs
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-5 text-[10px] ml-auto text-muted-foreground" onClick={() => setContext(null)}>
            clear
          </Button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-4">
            <div className="relative animate-float">
              {/* Pulsing rings behind icon */}
              <div className="absolute inset-0 rounded-xl bg-violet-500/20 animate-ring-pulse" />
              <div className="absolute inset-0 rounded-xl bg-violet-500/10 animate-ring-pulse" style={{ animationDelay: "0.4s" }} />
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/30 via-violet-600/20 to-violet-700/10 flex items-center justify-center relative shadow-[0_0_30px_rgba(139,92,246,0.25)] ring-1 ring-violet-500/20">
                <Sparkles className="h-7 w-7 text-violet-300" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground bg-gradient-to-r from-violet-300 to-violet-500 bg-clip-text text-transparent">GIA — your SSH ops copilot</p>
              <p className="text-xs text-muted-foreground mt-1.5">
                I can read files, manage services, run commands, and explore your servers.
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-2 font-mono">⌘J to toggle · voice input · multi-line paste auto-formats</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full mt-2">
              {SUGGESTIONS.map((s, idx) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    onClick={() => send(s.prompt)}
                    style={{ animationDelay: `${idx * 40}ms` }}
                    className="flex items-center gap-2 text-left text-xs p-2.5 rounded-md border border-border hover:bg-accent/50 hover:border-violet-500/30 hover:shadow-[0_2px_8px_rgba(139,92,246,0.08)] hover:-translate-y-0.5 transition-all duration-150 animate-fade-slide-right"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="leading-tight">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col gap-1 group",
              msg.role === "user" ? "items-end" : "items-start",
            )}
          >
            <div
              className={cn(
                "px-3.5 py-2.5 max-w-[92%] text-sm leading-relaxed transition-all duration-200",
                msg.role === "user"
                  ? "bg-gradient-to-br from-violet-500 via-violet-600 to-violet-800 text-white rounded-2xl rounded-tr-sm shadow-lg shadow-violet-900/20"
                  : "bg-card border border-border rounded-2xl rounded-tl-sm hover:border-violet-500/25 hover:shadow-[0_4px_12px_rgba(139,92,246,0.08)] hover:-translate-y-0.5 transition-all duration-200",
              )}
            >
              {msg.role === "assistant" ? (
                msg.content ? (
                  <StructuredMessage content={msg.content} streaming={streaming} />
                ) : phase === "thinking" ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                    </span>
                    <span>Thinking</span>
                    <span className="inline-flex gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                ) : phase === "tool_use" ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Wrench className="h-3 w-3 text-amber-400" />
                    <span>Awaiting approval</span>
                    <span className="inline-flex gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1 w-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1 w-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                ) : null
              ) : (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
              )}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity px-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground"
                onClick={() => handleCopy(msg.id, msg.content)}
                title="Copy"
              >
                {copiedId === msg.id ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
              </Button>
              {msg.role === "assistant" && msg.id === messages[messages.length - 1]?.id && !streaming && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground"
                  onClick={handleRegenerate}
                  title="Regenerate this response"
                >
                  <RefreshCw className="h-2.5 w-2.5" />
                </Button>
              )}
              {msg.estTokens ? (
                <span className="text-[9px] text-muted-foreground/50 font-mono px-1" title="Estimated tokens">~{msg.estTokens}t</span>
              ) : null}
            </div>
          </div>
        ))}

        {error && !lastResponseTruncated && (
          <div className="text-xs text-red-400 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded">
            {error}
          </div>
        )}

        {lastResponseTruncated && !streaming && (
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-amber-200 bg-amber-500/[0.08] border border-amber-500/25 rounded-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="flex-1">
              Response was cut off before GIA finished.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              onClick={handleContinue}
            >
              <Play className="h-2.5 w-2.5 mr-1" />
              Continue
            </Button>
          </div>
        )}

        {pendingFunctionCall && !writeFileDraft && (() => {
          const fc = pendingFunctionCall;
          const isReadOnly = READ_ONLY_TOOLS.has(fc.name);
          const pendingCount = pendingFunctionCalls.length;
          const connName = resolveConnName(queryClient, fc.args.connectionId);
          const action = String(fc.args.action || "");
          const serviceNames = Array.isArray(fc.args.serviceNames)
            ? fc.args.serviceNames as string[]
            : fc.args.serviceNames ? [String(fc.args.serviceNames)] : [];
          const logQuery = String(fc.args.query || fc.args.search || "");

          return (
            <div
              className={cn(
                "p-3.5 rounded-xl shadow-md animate-in fade-in slide-in-from-bottom-2 duration-200 space-y-3 border",
                isReadOnly
                  ? "border-sky-500/30 bg-sky-500/[0.06]"
                  : "border-amber-500/35 bg-amber-500/[0.07]",
              )}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 shadow-inner",
                    isReadOnly ? "bg-sky-500/15" : "bg-amber-500/15",
                  )}
                >
                  {fc.name === "service_action" && action === "restart" ? (
                    <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                  ) : fc.name === "daemon_reload" ? (
                    <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                  ) : fc.name === "search_service_logs" ? (
                    <ScrollText className="h-3.5 w-3.5 text-sky-400" />
                  ) : isReadOnly ? (
                    <Eye className="h-3.5 w-3.5 text-sky-400" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="text-xs font-semibold text-foreground">
                      {isReadOnly ? "Approve read access" : "Approve action"}
                    </h4>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 h-4 font-medium",
                        isReadOnly
                          ? "border-sky-500/40 text-sky-600 dark:text-sky-300 bg-sky-500/10"
                          : "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10",
                      )}
                    >
                      {isReadOnly ? "Read-only" : "Mutating"}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-mono text-muted-foreground border-border/60">
                      {fc.name}
                    </Badge>
                    {pendingCount > 1 && (
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0 h-4 border-violet-500/35 text-violet-500 dark:text-violet-300 font-mono"
                      >
                        {pendingCount} pending · 1 of {pendingCount}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {fc.name === "service_action" ? (
                      <div className="space-y-1.5">
                        <p>
                          <strong className="text-amber-600 dark:text-amber-300 capitalize">{action || "act on"}</strong>
                          {" "}
                          {serviceNames.length} service{serviceNames.length === 1 ? "" : "s"} on{" "}
                          <strong className="text-foreground">{connName}</strong>
                        </p>
                        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                          {serviceNames.map((n) => (
                            <code key={n} className="bg-muted border border-border px-1.5 py-0.5 rounded text-[10px] text-amber-700 dark:text-amber-200 font-mono">
                              {n}
                            </code>
                          ))}
                        </div>
                      </div>
                    ) : fc.name === "daemon_reload" ? (
                      <p>
                        Run <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-700 dark:text-amber-200">systemctl daemon-reload</code>
                        {" "}on <strong className="text-foreground">{connName}</strong>. Reloads unit definitions — does not restart services by itself.
                      </p>
                    ) : fc.name === "search_service_logs" ? (
                      <div className="space-y-1">
                        <p>
                          Search journal for call_id / query on{" "}
                          <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-sky-700 dark:text-sky-300">{String(fc.args.serviceName || "")}</code>
                          {" "}(<strong className="text-foreground">{connName}</strong>)
                        </p>
                        <code className="block bg-muted/60 border border-border/50 px-2 py-1 rounded text-[10px] font-mono text-foreground break-all">
                          {logQuery || "(empty query)"}
                        </code>
                        <p className="text-[10px] text-muted-foreground/80">Returns the Start → End webhook window for that call_id.</p>
                      </div>
                    ) : fc.name === "read_file" ? (
                      <p>
                        Read <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-sky-700 dark:text-sky-300 break-all">{String(fc.args.path || "")}</code>
                        {" "}on <strong className="text-foreground">{connName}</strong>
                      </p>
                    ) : fc.name === "write_file" ? (
                      <p>
                        Edit <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-700 dark:text-amber-200 break-all">{String(fc.args.path || "")}</code>
                        {" "}on <strong className="text-foreground">{connName}</strong>. A diff preview opens next.
                      </p>
                    ) : fc.name === "run_command" ? (
                      <div className="space-y-1">
                        <p>Run shell on <strong className="text-foreground">{connName}</strong>:</p>
                        <code className="block bg-muted/60 border border-border/50 px-2 py-1 rounded text-[10px] font-mono text-foreground break-all">
                          {String(fc.args.command || "")}
                        </code>
                      </div>
                    ) : fc.name === "list_directory" ? (
                      <p>
                        List <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-sky-700 dark:text-sky-300">{String(fc.args.path || "/")}</code>
                        {" "}on <strong className="text-foreground">{connName}</strong>
                      </p>
                    ) : fc.name === "search_files" ? (
                      <p>
                        Find <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-sky-700 dark:text-sky-300">{String(fc.args.pattern || "")}</code>
                        {" "}under <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-sky-700 dark:text-sky-300">{String(fc.args.path || "/")}</code>
                        {" "}on <strong className="text-foreground">{connName}</strong>
                      </p>
                    ) : fc.name === "list_services" ? (
                      <p>
                        List systemd services on <strong className="text-foreground">{connName}</strong>
                      </p>
                    ) : (
                      <p>Run tool <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">{fc.name}</code></p>
                    )}
                  </div>
                </div>
              </div>
              <div
                className={cn(
                  "flex items-center justify-end gap-2 pt-1 border-t",
                  isReadOnly ? "border-sky-500/15" : "border-amber-500/15",
                )}
              >
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={handleRejectAction}>
                  Reject
                </Button>
                <Button
                  size="sm"
                  className={cn(
                    "h-7 text-xs text-white shadow-sm",
                    isReadOnly
                      ? "bg-sky-600 hover:bg-sky-500 border border-sky-500/30"
                      : "bg-amber-600 hover:bg-amber-500 border border-amber-500/30",
                  )}
                  onClick={handleApproveAction}
                >
                  {fc.name === "service_action" && action === "start" && <Play className="h-3 w-3 mr-1.5" />}
                  {fc.name === "service_action" && action === "stop" && <Square className="h-3 w-3 mr-1.5" />}
                  {fc.name === "service_action" && action === "restart" && <RotateCcw className="h-3 w-3 mr-1.5" />}
                  {fc.name === "service_action" && action === "enable" && <Play className="h-3 w-3 mr-1.5" />}
                  {fc.name === "service_action" && action === "disable" && <Square className="h-3 w-3 mr-1.5" />}
                  {fc.name === "run_command" && <TerminalIcon className="h-3 w-3 mr-1.5" />}
                  {fc.name === "write_file" && <FileText className="h-3 w-3 mr-1.5" />}
                  {fc.name === "daemon_reload" && <RefreshCw className="h-3 w-3 mr-1.5" />}
                  {fc.name === "list_directory" && <ListTree className="h-3 w-3 mr-1.5" />}
                  {fc.name === "search_files" && <FileSearch className="h-3 w-3 mr-1.5" />}
                  {fc.name === "list_services" && <Server className="h-3 w-3 mr-1.5" />}
                  {fc.name === "search_service_logs" && <ScrollText className="h-3 w-3 mr-1.5" />}
                  {fc.name === "read_file" && <FileText className="h-3 w-3 mr-1.5" />}
                  Approve{pendingCount > 1 ? ` (${pendingCount - 1} left)` : ""}
                </Button>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="border-t border-border p-3 shrink-0 bg-background">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-end gap-2"
        >
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask GIA... (Shift+Enter for newline)"
              disabled={streaming}
              rows={1}
              className="flex w-full min-h-[36px] max-h-[200px] rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-violet-500/40 focus-visible:ring-1 focus-visible:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50 resize-none transition-all duration-200"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 200) + "px";
              }}
            />
            {input.includes("```") && (
              <div className="absolute right-2 top-1.5">
                <Badge variant="secondary" className="text-[9px] h-4 bg-violet-500/10 text-violet-300">code</Badge>
              </div>
            )}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={toggleListen}
            className={cn(
              "h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground transition-all duration-300",
              isListening && "bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse glow-red"
            )}
            title={isListening ? "Stop listening" : "Start voice dictation"}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          {streaming ? (
            <Button type="button" size="icon" variant="destructive" onClick={stop} className="h-9 w-9 shrink-0">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} className="h-9 w-9 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
        <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
          ⌘J to toggle · Esc to close · Enter to send · Shift+Enter for newline
        </p>
      </div>

      {writeFileDraft && (
        <WriteFileDialog
          path={writeFileDraft.path}
          content={writeFileDraft.content}
          connectionId={writeFileDraft.connectionId}
          open={!!writeFileDraft}
          onClose={() => {
            const draft = writeFileDraft;
            setWriteFileDraft(null);
            appendToLast(`\n\n_🚫 Write cancelled by user._`);
            finishPendingTool({
              name: "write_file",
              args: { path: draft.path, connectionId: draft.connectionId },
              result: "[CANCELLED: User rejected this action. Try a different approach or ask what they'd like to do.]",
            });
          }}
          onApplied={() => {
            const draft = writeFileDraft;
            setWriteFileDraft(null);
            if (!draft) return;
            finishPendingTool({
              name: "write_file",
              args: { path: draft.path, connectionId: draft.connectionId },
              result: `File written successfully: ${draft.path}`,
            });
          }}
        />
      )}

    </div>
  );
}
