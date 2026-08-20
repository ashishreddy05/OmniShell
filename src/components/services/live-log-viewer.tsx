"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Terminal, Pause, Play, Copy, Trash2, Download, Sparkles, Loader2, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { servicesApi } from "@/lib/api-client";
import { wsClient } from "@/lib/ws-client";
import { cn } from "@/lib/utils";
import { highlightVoiceTools } from "@/lib/gia-tools";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAIStore } from "@/stores/ai-store";
import { LogLineViewer } from "./log-line-viewer";

const MAX_LINES = 5000;
const FLUSH_INTERVAL_MS = 50;
const HISTORY_PRESETS: { label: string; lines: number }[] = [
  { label: "Default", lines: 0 },
  { label: "500", lines: 500 },
  { label: "1,000", lines: 1000 },
  { label: "2,000", lines: 2000 },
  { label: "5,000", lines: 5000 },
];

interface LiveLogViewerProps {
  connectionId: string;
  serviceName: string;
}

function HistoryPopover({
  value,
  onChange,
}: {
  value: number;
  onChange: (lines: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const activeLabel =
    HISTORY_PRESETS.find((p) => p.lines === value)?.label ??
    (value > 0 ? `${value.toLocaleString()}` : "Default");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn(
            "h-7 text-[10px] gap-1 mr-1.5 border-slate-800/80",
            value > 0 && "border-emerald-500/40 text-emerald-300",
          )}
          title="Load older log history"
        >
          <History className="h-3 w-3" />
          {activeLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium">Log history</div>
          <div className="text-[10px] text-muted-foreground">
            How many lines to load before streaming live (Default: 200).
          </div>
          <div className="flex flex-wrap gap-1">
            {HISTORY_PRESETS.map((p) => (
              <Button
                key={p.lines}
                variant={value === p.lines ? "default" : "outline"}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => onChange(p.lines)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              placeholder="Custom lines"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-6 text-[10px] px-2"
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-6 text-[10px] px-2 shrink-0"
              disabled={!custom || parseInt(custom, 10) <= 0}
              onClick={() => {
                const v = parseInt(custom, 10);
                if (v > 0) {
                  onChange(v);
                  setCustom("");
                }
              }}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function LiveLogViewer({ connectionId, serviceName }: LiveLogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"connecting" | "streaming" | "paused" | "closed" | "error">("connecting");
  const [autoScroll, setAutoScroll] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [historyLines, setHistoryLines] = useState(0);
  const historyLinesRef = useRef(historyLines);
  useEffect(() => {
    historyLinesRef.current = historyLines;
  }, [historyLines]);
  const [restartKey, setRestartKey] = useState(0);
  // Only re-subscribe on reconnect when the tab is visible (hidden tabs stay suspended)
  useEffect(() => {
    const unsub = wsClient.on("ws:connected", () => {
      if (document.visibilityState === "visible") {
        setRestartKey((k) => k + 1);
      }
    });
    return () => { unsub(); };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const pendingChunksRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const autoScrollRef = useRef(autoScroll);
  const isAtBottomRef = useRef(true);
  const statusRef = useRef(status);
  const userPausedRef = useRef(false);
  const visibilitySuspendedRef = useRef(false);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const flushedLinesRef = useRef<string[]>([]);
  useEffect(() => {
    flushedLinesRef.current = lines;
  }, [lines]);

  const flush = useCallback(() => {
    if (pendingChunksRef.current.length === 0) return;
    const incoming = pendingChunksRef.current;
    pendingChunksRef.current = "";
    const newLines = incoming.split("\n").filter((l) => l.length > 0 || incoming.endsWith("\n"));
    if (newLines.length === 0) return;
    setLines((prev) => {
      const combined = [...prev, ...newLines];
      if (combined.length > MAX_LINES) {
        return combined.slice(combined.length - MAX_LINES);
      }
      return combined;
    });
    setLineCount((c) => c + newLines.length);
  }, []);

  useEffect(() => {
    flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    };
  }, [flush]);

  useEffect(() => {
    let isMounted = true;
    let currentStop: (() => void) | null = null;

    setLines([]);
    setLineCount(0);
    pendingChunksRef.current = "";
    setErrorMsg(null);
    userPausedRef.current = false;
    visibilitySuspendedRef.current = false;

    const attach = (opts?: { historyLines?: number }) => {
      const handle = servicesApi.streamLogs(
        connectionId,
        serviceName,
        {
          onChunk: (chunk) => {
            if (!isMounted) return;
            pendingChunksRef.current += chunk;
          },
          onError: (err) => {
            if (!isMounted) return;
            setErrorMsg(err);
            setStatus("error");
          },
          onClose: () => {
            if (!isMounted) return;
            flush();
            setStatus("closed");
          },
        },
        { historyLines: opts?.historyLines },
      );
      currentStop = handle.stop;
      stopRef.current = handle.stop;
      handle.ready.then(() => {
        if (isMounted) setStatus("streaming");
      });
    };

    const detach = () => {
      currentStop?.();
      currentStop = null;
      stopRef.current = null;
    };

    if (document.visibilityState === "visible") {
      setStatus("connecting");
      attach({ historyLines: historyLines || undefined });
    } else {
      visibilitySuspendedRef.current = true;
      setStatus("paused");
    }

    const onVisibility = () => {
      if (!isMounted) return;
      if (document.visibilityState === "hidden") {
        if (statusRef.current === "streaming" || statusRef.current === "connecting") {
          visibilitySuspendedRef.current = true;
          flush();
          detach();
          setStatus("paused");
        }
      } else if (visibilitySuspendedRef.current && !userPausedRef.current) {
        // Resume without re-dumping history — keep buffer intact
        visibilitySuspendedRef.current = false;
        setStatus("connecting");
        setErrorMsg(null);
        attach({ historyLines: 0 });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      isMounted = false;
      flush();
      detach();
      document.removeEventListener("visibilitychange", onVisibility);
      stopRef.current = null;
    };
  }, [connectionId, serviceName, flush, historyLines, restartKey]);

  useEffect(() => {
    if (autoScrollRef.current && isAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const onScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
  }, []);

  const togglePause = useCallback(() => {
    if (status === "streaming") {
      userPausedRef.current = true;
      visibilitySuspendedRef.current = false;
      stopRef.current?.();
      flush();
      setStatus("paused");
    } else if (status === "paused" || status === "closed") {
      userPausedRef.current = false;
      visibilitySuspendedRef.current = false;
      pendingChunksRef.current = "";
      setStatus("connecting");
      setErrorMsg(null);
      const handle = servicesApi.streamLogs(
        connectionId,
        serviceName,
        {
          onChunk: (chunk) => { pendingChunksRef.current += chunk; },
          onError: (err) => { setErrorMsg(err); setStatus("error"); },
          onClose: () => { flush(); setStatus("closed"); },
        },
        { historyLines: historyLinesRef.current || undefined },
      );
      stopRef.current = handle.stop;
      handle.ready.then(() => setStatus("streaming"));
    }
  }, [status, connectionId, serviceName, flush]);

  const clear = useCallback(() => {
    setLines([]);
    setLineCount(0);
  }, []);

  const copyAll = useCallback(() => {
    navigator.clipboard.writeText(lines.join("\n"));
  }, [lines]);

  const download = useCallback(() => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${serviceName}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lines, serviceName]);

  const hasErrors = lines.some(
    (l) => {
      const lower = l.toLowerCase();
      if (lower.includes("no error") || lower.includes("error code 0") || lower.includes("error 0")) return false;
      return lower.includes("error") || lower.includes("fatal") || lower.includes("traceback") || lower.includes("exception");
    }
  );

  const analyzeLogs = useCallback(() => {
    const aiStore = useAIStore.getState();
    const recentLines = flushedLinesRef.current.slice(-150).join("\n");

    // Seed the connection, service, and logs context in GIA
    aiStore.setContext({
      connectionId,
      service: { name: serviceName },
      logs: { serviceName, content: recentLines, lines: 150 }
    });

    // Open GIA
    aiStore.setOpen(true);

    // Auto-trigger analysis prompt
    aiStore.setPendingPrompt(
      `Analyze these logs from service "${serviceName}" and identify:\n1. Any errors or warnings\n2. Root causes\n3. Suggested fixes`
    );
  }, [connectionId, serviceName]);

  const statusBadge = {
    connecting: { color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30", label: "Connecting" },
    streaming: { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", label: "Live" },
    paused: { color: "bg-slate-500/20 text-slate-300 border-slate-500/30", label: "Paused" },
    closed: { color: "bg-red-500/20 text-red-300 border-red-500/30", label: "Disconnected" },
    error: { color: "bg-red-500/20 text-red-300 border-red-500/30", label: "Error" },
  }[status];

  const filteredLines = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) {
      return lines.map((line, index) => ({ line, index }));
    }
    const result: Array<{ line: string; index: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query)) {
        result.push({ line: lines[i], index: i });
      }
    }
    return result;
  }, [lines, filterQuery]);

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between gap-2 flex-shrink-0 pb-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium">Live Logs</span>
          <Badge variant="outline" className={statusBadge.color}>{statusBadge.label}</Badge>
          <Badge variant="secondary" className="text-xs">{lineCount.toLocaleString()} lines</Badge>
          {hasErrors && (
            <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
              errors detected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-xs text-muted-foreground">Follow</span>
            <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
          </div>
          <Input 
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter logs..."
            className="h-7 text-xs w-28 focus-visible:w-44 transition-all duration-300 mr-1.5 bg-muted/50 border-border/60"
          />
          <HistoryPopover value={historyLines} onChange={setHistoryLines} />
          {lines.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] gap-1 border-violet-500/30 text-violet-300 hover:bg-violet-500/10 cursor-pointer"
              onClick={analyzeLogs}
            >
              <Sparkles className="h-3 w-3" />
              Analyze
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={togglePause} title={status === "streaming" ? "Pause" : "Resume"}>
            {status === "streaming" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={copyAll} disabled={lines.length === 0} title="Copy all">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={download} disabled={lines.length === 0} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={lines.length === 0} title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="text-xs text-red-400 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded flex-shrink-0">
          {errorMsg}
        </div>
      )}



      <div ref={containerRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        <LogLineViewer
          lines={filteredLines}
          heightClass="min-h-full"
          className="shadow-[inset_0_2px_8px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(255,255,255,0.02)]"
        />
      </div>
    </div>
  );
}
