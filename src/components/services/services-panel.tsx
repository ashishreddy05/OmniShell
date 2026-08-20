"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { servicesApi, fsApi } from "@/lib/api-client";
import type { LogSearchResult } from "@/lib/api-client";
import { useConnectionStore } from "@/stores/connection-store";
import { useEditorStore } from "@/stores/editor-store";
import { useUIStore } from "@/stores/ui-store";
import { useWatchStore } from "@/stores/watch-store";
import { useAIStore } from "@/stores/ai-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { highlightVoiceTools, extractJobIds, extractVoiceTools, VOICE_TOOL_REGEX } from "@/lib/gia-tools";
import { getLanguageFromExtension } from "@/lib/constants";
import { ensureConnection } from "@/lib/ensure-connection";
import { parseUnitPaths, type ProfileCandidate } from "@/lib/systemd-unit";
import { ServiceMonitor } from "./service-monitor";
import { WatchedDashboard } from "./watched-dashboard";
import { LiveLogViewer } from "./live-log-viewer";
import { LogLineViewer } from "./log-line-viewer";
import {
  Activity, Loader2, Play, Square, RotateCcw, FileText, ArrowLeft, Pencil,
  Search, Pin, PinOff, Filter, X, Terminal, Eye, EyeOff, RefreshCw, Check, Wrench, Copy,
  Plus, Timer, Minus, Sparkles, FolderOpen, ChevronDown, FilePlus2,
} from "lucide-react";

function useServiceAction(connectionId: string, serviceName: string) {
  const [acting, setActing] = useState(false);
  const handleAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setActing(true);
    try {
      await servicesApi.act(connectionId, serviceName, action);
      toast.success(`${action} ${serviceName}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setActing(false);
    }
  }, [connectionId, serviceName]);
  return { acting, handleAction };
}

const EXTEND_PRESETS = [5, 10, 30, 60];

function ExtendWindowPopover({
  startPad,
  endPad,
  onExtend,
}: {
  startPad: number;
  endPad: number;
  onExtend: (side: "start" | "end", secs: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const [direction, setDirection] = useState<"start" | "end">("start");
  const currentPad = direction === "start" ? startPad : endPad;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground",
            (startPad > 0 || endPad > 0) && "text-primary"
          )}
          title="Extend window"
        >
          <Timer className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3" align="end">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">Extend window</span>
            <span className="text-[10px] text-muted-foreground">
              {startPad > 0 && `▲${startPad}s`}
              {startPad > 0 && endPad > 0 && " · "}
              {endPad > 0 && `▼${endPad}s`}
            </span>
          </div>
          <div className="flex gap-1">
            <Button
              variant={direction === "start" ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2 flex-1"
              onClick={() => setDirection("start")}
            >
              Before start
            </Button>
            <Button
              variant={direction === "end" ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2 flex-1"
              onClick={() => setDirection("end")}
            >
              After end
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              +{currentPad}s
            </span>
            <div className="flex flex-wrap gap-1 flex-1">
              {EXTEND_PRESETS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => onExtend(direction, s)}
                >
                  +{s}s
                </Button>
              ))}
              {EXTEND_PRESETS.map((s) => (
                <Button
                  key={`neg-${s}`}
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => onExtend(direction, -s)}
                >
                  -{s}s
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              placeholder="± secs"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-6 text-[10px] px-2"
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-6 text-[10px] px-2 shrink-0"
              disabled={!custom || parseInt(custom, 10) === 0}
              onClick={() => {
                const v = parseInt(custom, 10);
                if (v !== 0) {
                  onExtend(direction, v);
                  setCustom("");
                }
              }}
            >
              {parseInt(custom, 10) < 0 ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ServiceStateBadge({ state }: { state: string }) {
  const variants: Record<string, string> = {
    active: "bg-green-500/10 text-green-600 border-green-500/20 glow-green",
    inactive: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    failed: "bg-red-500/10 text-red-600 border-red-500/20 glow-red",
    activating: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 animate-pulse glow-yellow",
    deactivating: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 glow-yellow",
  };

  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 py-0 font-mono leading-4", variants[state] || "bg-gray-500/10 text-gray-400")}
    >
      {state}
    </Badge>
  );
}

function ServiceItemSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-5 w-5 rounded" />
      <Skeleton className="h-5 w-5 rounded" />
      <Skeleton className="h-5 w-5 rounded" />
      <Skeleton className="h-5 w-5 rounded" />
    </div>
  );
}

function ServiceItem({
  connectionId, name, description, state, onViewDetail, style,
  selected, onSelect,
}: {
  connectionId: string;
  name: string;
  description: string;
  state: string;
  onViewDetail: (name: string) => void;
  style?: React.CSSProperties;
  selected?: boolean;
  onSelect?: (name: string, selected: boolean) => void;
}) {
  const { acting, handleAction } = useServiceAction(connectionId, name);
  const { isWatched, addWatched, removeWatched } = useWatchStore();
  const watched = isWatched(connectionId, name);

  return (
    <div
      className={cn(
        "service-item flex items-center gap-2 px-2 py-1.5 text-sm animate-stagger transition-colors",
        state === "active" && "card-accent-green",
        state === "failed" && "card-accent-red",
        state !== "active" && state !== "failed" && "card-accent",
        selected && "ring-1 ring-violet-500/40 bg-violet-500/[0.06]",
      )}
      style={style}
    >
      {onSelect && (
        <button
          className={cn(
            "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-all duration-150",
            selected
              ? "bg-violet-500 border-violet-500 text-white"
              : "border-border/60 hover:border-violet-500/40 hover:bg-violet-500/10"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(name, !selected);
          }}
          aria-label={selected ? `Deselect ${name}` : `Select ${name}`}
        >
          {selected && <Check className="h-2.5 w-2.5" />}
        </button>
      )}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onViewDetail(name)}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{name}</span>
          <ServiceStateBadge state={state} />
        </div>
        {description && (
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6", watched && "text-primary")}
          onClick={() => watched ? removeWatched(connectionId, name) : addWatched(connectionId, name)}
          title={watched ? "Remove from watched" : "Save to watched"}
          aria-label={watched ? `Unwatch ${name}` : `Watch ${name}`}
        >
          {watched ? <Eye className="h-3.5 w-3.5 fill-primary" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        {state !== "active" && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleAction("start")} disabled={acting} title="Start" aria-label={`Start ${name}`}>
            {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 text-emerald-500" />}
          </Button>
        )}
        {state === "active" && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleAction("stop")} disabled={acting} title="Stop" aria-label={`Stop ${name}`}>
            {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3 text-destructive" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleAction("restart")} disabled={acting} title="Restart" aria-label={`Restart ${name}`}>
          <RotateCcw className={cn("h-3 w-3", acting && "animate-spin")} />
        </Button>
          {state === "failed" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-violet-400 hover:text-violet-300"
              onClick={(e) => {
                e.stopPropagation();
                const aiStore = useAIStore.getState();
                aiStore.setContext({ connectionId, service: { name }, logs: { serviceName: name, lines: 100 } });
                aiStore.setOpen(true);
                aiStore.setPendingPrompt(
                  `Investigate why "${name}" is unhealthy. Use seeded context (logs/state). Check memory and recent errors; propose approved tools (status/journal/RSS) if needed. Summarize root cause + fix. Do NOT restart unless I ask.`,
                );
              }}
              title="Diagnose with GIA"
              aria-label={`Diagnose ${name} with GIA`}
            >
              <Sparkles className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onViewDetail(name)} title="View details" aria-label={`View details for ${name}`}>
            <FileText className="h-3 w-3" />
          </Button>
      </div>
    </div>
  );
}

export function ServicesPanel({ onBack }: { onBack?: () => void }) {
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const setMainView = useUIStore((s) => s.setMainView);
  const openServiceBuilder = useUIStore((s) => s.openServiceBuilder);
  const queryClient = useQueryClient();

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      setMainView("explorer");
    }
  }, [onBack, setMainView]);

  const connectionId = activeTabId ?? "";
  const active = activeTabId ? activeConnections.get(activeTabId) : null;
  const isConnected = active?.status === "connected";

  const [viewingService, setViewingService] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "failed" | "other">("all");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState<"start" | "stop" | "restart" | null>(null);

  const handleBulkAction = useCallback(async (action: "start" | "stop" | "restart") => {
    const names = Array.from(selectedNames);
    if (names.length === 0) return;
    setBulkActing(action);
    const results: { name: string; ok: boolean; error?: string }[] = [];
    for (const name of names) {
      try {
        await servicesApi.act(connectionId, name, action);
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, error: (err as Error).message });
      }
    }
    setBulkActing(null);
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    if (failCount === 0) {
      toast.success(`${action} on ${okCount} service${okCount === 1 ? "" : "s"}`);
    } else {
      toast.warning(`${okCount} succeeded, ${failCount} failed`);
    }
  }, [connectionId, selectedNames]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["services", connectionId],
    queryFn: () => servicesApi.list(connectionId),
    enabled: isConnected,
    refetchInterval: 15_000,
    // Stagger first fetch to spread out burst with other polls
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });

  if (!connectionId || !isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-4">
        <p>Connect to a server to manage services</p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={goBack}>
          <ArrowLeft className="h-3 w-3 mr-1" /> Back
        </Button>
      </div>
    );
  }

  const services = data?.services ?? [];
  const filtered = services
    .filter((s) => {
      if (filterMode === "all") return true;
      if (filterMode === "active") return s.state === "active";
      if (filterMode === "failed") return s.state === "failed";
      return s.state !== "active" && s.state !== "failed";
    })
    .filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  if (viewingService) {
    return (
      <div key={viewingService} className="h-full animate-reveal-right">
      <ServiceDetailView
        connectionId={connectionId}
        serviceName={viewingService}
        onBack={() => setViewingService(null)}
      />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Single Header — consolidated */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border shrink-0 bg-gradient-to-r from-primary/[0.08] via-muted/30 to-transparent relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent -translate-x-full animate-[shimmer_1.5s_ease-out_0.2s_1_forwards]" />
        <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/15 shadow-sm">
          <Activity className="h-3 w-3 text-primary" />
        </div>
        <div>
          <span className="text-xs font-semibold tracking-wide">Service Manager</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          className="h-6 text-[10px] gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-200 border border-violet-500/25 hover:bg-violet-500/20 shadow-none"
          onClick={openServiceBuilder}
          title="Create a new systemd unit"
        >
          <FilePlus2 className="h-3 w-3" />
          New service
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] text-muted-foreground hover:text-foreground gap-1"
          onClick={goBack}
        >
          <ArrowLeft className="h-3 w-3" />
          Explorer
        </Button>
      </div>

      {/* Search + Active filter */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border shrink-0">
        <div className="relative flex items-center flex-1 min-w-0">
          <Search className="absolute left-2.5 h-3 w-3 text-muted-foreground pointer-events-none shrink-0" />
          <Input
            className="h-7 pl-7 pr-2 text-xs"
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(["all", "active", "failed", "other"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={cn(
                "px-2 py-1 rounded text-[10px] font-medium transition-all",
                filterMode === mode
                  ? "bg-accent text-foreground shadow-sm"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-accent/40"
              )}
            >
              {mode === "all" ? "All" : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        {filtered.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-violet-400 hover:text-violet-300 px-2"
            onClick={() => {
              if (selectedNames.size === filtered.length) {
                setSelectedNames(new Set());
              } else {
                setSelectedNames(new Set(filtered.map((s) => s.name)));
              }
            }}
            title={selectedNames.size === filtered.length ? "Deselect all" : "Select all visible"}
          >
            {selectedNames.size === filtered.length ? "Deselect All" : "Select All"}
          </Button>
        )}
      </div>

      {/* Watched dashboard */}
      <div className="border-b border-border shrink-0">
        <WatchedDashboard
          connectionId={connectionId}
          onViewService={setViewingService}
        />
      </div>

      {/* Bulk action bar (visible when items are selected) */}
      {selectedNames.size > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-violet-500/[0.08] shrink-0 animate-in slide-in-from-top-2 fade-in duration-200">
          <span className="text-[10px] font-medium text-violet-400">
            {selectedNames.size} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-emerald-500"
            onClick={() => handleBulkAction("start")}
            disabled={bulkActing !== null}
          >
            {bulkActing === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            <span className="ml-1">Start</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => handleBulkAction("restart")}
            disabled={bulkActing !== null}
          >
            {bulkActing === "restart" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            <span className="ml-1">Restart</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-destructive"
            onClick={() => handleBulkAction("stop")}
            disabled={bulkActing !== null}
          >
            {bulkActing === "stop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            <span className="ml-1">Stop</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-muted-foreground"
            onClick={() => setSelectedNames(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Quick status bar */}
      {!isLoading && services.length > 0 && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-emerald-400">{services.filter(s => s.state === "active").length}</span>
            <span>active</span>
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="font-mono text-red-400">{services.filter(s => s.state === "failed").length}</span>
            <span>failed</span>
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
            <span className="font-mono">{services.filter(s => s.state !== "active" && s.state !== "failed").length}</span>
            <span>other</span>
          </span>
          <div className="flex-1" />
          <span className="font-mono">{services.length} total</span>
        </div>
      )}

      {/* Service list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-1 space-y-0.5">
          {isLoading && (
            <div className="space-y-0.5 px-2 py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <ServiceItemSkeleton key={i} />
              ))}
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive px-2 py-4 text-center">{(error as Error).message}</p>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-2 py-8 text-xs text-muted-foreground">
              {search ? (
                <>
                  <Search className="h-4 w-4" />
                  <p>No services match &ldquo;{search}&rdquo;</p>
                </>
              ) : (
                <>
                  <Filter className="h-4 w-4" />
                  <p>No active services found</p>
                </>
              )}
            </div>
          )}
          {filtered.map((svc, idx) => (
            <ServiceItem
              key={svc.name}
              connectionId={connectionId}
              name={svc.name}
              description={svc.description}
              state={svc.state}
              onViewDetail={setViewingService}
              selected={selectedNames.has(svc.name)}
              onSelect={(name, selected) => {
                setSelectedNames((prev) => {
                  const next = new Set(prev);
                  if (selected) next.add(name);
                  else next.delete(name);
                  return next;
                });
              }}
              style={{ animationDelay: `${idx * 20}ms` }}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ServiceDetailView({
  connectionId, serviceName, onBack,
}: {
  connectionId: string;
  serviceName: string;
  onBack: () => void;
}) {
  const { acting, handleAction } = useServiceAction(connectionId, serviceName);
  const { openFile } = useEditorStore();
  const navigate = useExplorerStore((s) => s.navigate);
  const { isWatched, addWatched, removeWatched } = useWatchStore();
  const watched = isWatched(connectionId, serviceName);
  const [showLiveLogs, setShowLiveLogs] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  // Detail poll: systemctl show only — no systemctl cat / journalctl
  const { data: detail, isLoading, isError, error } = useQuery({
    queryKey: ["service", connectionId, serviceName],
    queryFn: () => servicesApi.get(connectionId, serviceName),
    // Offset from the 15s service list poll to avoid simultaneous bursts
    refetchInterval: 18_000,
    // Keep state polling even with Live Logs on; journalctl is no longer bundled here
    retry: 1,
  });

  // Unit file: load once (stale forever) — Edit in Editor still works
  const { data: fileData } = useQuery({
    queryKey: ["service-file", connectionId, serviceName],
    queryFn: () => servicesApi.getFile(connectionId, serviceName),
    staleTime: Infinity,
  });
  const fileContent = fileData?.fileContent ?? "";
  const unitPaths = useMemo(() => parseUnitPaths(fileContent), [fileContent]);

  const [logQuery, setLogQuery] = useState("");
  const [logResults, setLogResults] = useState<LogSearchResult | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  // Window-extension pads (seconds) — applied on top of the start/end webhook range
  const [startPad, setStartPad] = useState(0);
  const [endPad, setEndPad] = useState(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [localFilter, setLocalFilter] = useState("");
  const logScrollRef = useRef<HTMLDivElement>(null);

  const logParsed = useMemo(() => {
    if (!logResults?.context) return { tools: new Set<string>(), jobIds: new Set<string>(), lines: [] as string[] };
    const lines = logResults.context.split("\n");
    const tools = extractVoiceTools(logResults.context);
    const jobIds = new Set(extractJobIds(logResults.context));
    return { tools, jobIds, lines };
  }, [logResults]);

  const displayLines = useMemo(() => {
    let lines = logParsed.lines;
    if (activeJobId) lines = lines.filter((l) => l.includes(activeJobId));
    if (localFilter.trim()) {
      const q = localFilter.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(q));
    }
    return lines;
  }, [logParsed.lines, activeJobId, localFilter]);

  const toolFirstLine = useMemo(() => {
    const map = new Map<string, number>();
    displayLines.forEach((line, i) => {
      const re = new RegExp(VOICE_TOOL_REGEX.source, VOICE_TOOL_REGEX.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const tool = m[1].toLowerCase();
        if (!map.has(tool)) map.set(tool, i);
      }
    });
    return map;
  }, [displayLines]);

  const scrollToLine = useCallback((index: number) => {
    const el = document.getElementById(`log-line-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Reset job filter when results change
  useEffect(() => { setActiveJobId(null); setLocalFilter(""); }, [logResults]);

  const setAIContext = useAIStore((s) => s.setContext);
  useEffect(() => {
    if (!detail) return;
    setAIContext({
      connectionId,
      service: { name: serviceName },
    });
    // Skip static journalctl when Live Logs WS is already streaming
    if (showLiveLogs) return;
    servicesApi.logs(connectionId, serviceName, { tail: 100 })
      .then((res) => {
        const content = "logs" in res ? res.logs : res.context;
        if (content) {
          setAIContext({
            connectionId,
            service: { name: serviceName },
            logs: { serviceName, content, lines: 100 },
          });
        }
      })
      .catch(() => {});
  }, [detail?.state, connectionId, serviceName, setAIContext, showLiveLogs]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogSearch = async (opts?: { startPad?: number; endPad?: number }) => {
    if (!logQuery.trim()) return;
    const sPad = opts?.startPad ?? startPad;
    const ePad = opts?.endPad ?? endPad;
    setLogLoading(true);
    try {
      const data = await servicesApi.logs(connectionId, serviceName, {
        search: logQuery,
        startPad: sPad,
        endPad: ePad,
      });
      setLogResults(data as LogSearchResult);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLogLoading(false);
    }
  };

  // Re-run the current search with new pad values when extending the window
  const extendWindow = (side: "start" | "end", secs: number) => {
    const newStartPad = side === "start" ? Math.max(0, startPad + secs) : startPad;
    const newEndPad = side === "end" ? Math.max(0, endPad + secs) : endPad;
    setStartPad(newStartPad);
    setEndPad(newEndPad);
    handleLogSearch({ startPad: newStartPad, endPad: newEndPad });
  };

  const handleEditServiceFile = async () => {
    if (!fileContent) return;
    const filePath = `/etc/systemd/system/${serviceName}.service`;
    const firstLine = fileContent.split("\n")[0] || "";
    const pathMatch = firstLine.match(/^#\s*(\/.+\.service)$/);
    const actualPath = pathMatch?.[1] || filePath;

    try {
      const language = "ini";
      openFile(connectionId, actualPath, fileContent, language);
      const store = useUIStore.getState();
      store.setReturnView({ mainView: "services", serviceName });
      store.setMainView("explorer");
      toast.success("Opening in editor...");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleOpenWorkingDirectory = async () => {
    const wd = unitPaths.workingDirectory;
    if (!wd) {
      toast.info("No WorkingDirectory= found in this unit file");
      return;
    }
    setProfileBusy(true);
    try {
      await ensureConnection(connectionId);
      navigate(connectionId, wd);
      const store = useUIStore.getState();
      store.setReturnView({ mainView: "services", serviceName });
      store.setMainView("explorer");
      toast.success(`Opened ${wd}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProfileBusy(false);
    }
  };

  const handleOpenProfilePath = async (candidate: ProfileCandidate) => {
    setProfileBusy(true);
    try {
      await ensureConnection(connectionId);
      const leaf = candidate.path.split("/").pop() || candidate.path;
      const { content } = await fsApi.read(connectionId, candidate.path);
      const language = getLanguageFromExtension(leaf);
      openFile(connectionId, candidate.path, content, language);
      // Also navigate explorer to the parent so context is clear
      const parent = candidate.path.includes("/")
        ? candidate.path.replace(/\/[^/]+$/, "") || "/"
        : "/";
      navigate(connectionId, parent || "/");
      const store = useUIStore.getState();
      store.setReturnView({ mainView: "services", serviceName });
      store.setMainView("explorer");
      toast.success(`Opened ${leaf}`);
    } catch (err) {
      toast.error(`Could not open ${candidate.path}: ${(err as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  };

  const handleOpenProfileMenu = () => {
    if (unitPaths.candidates.length === 0) {
      toast.info(
        "No profile/config paths found. Add Environment=AGENT_CONFIG_PATH=… or EnvironmentFile=… to the unit.",
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 w-48 ml-1" />
        </div>
        <div className="p-3 space-y-4 flex-1">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onBack} title="Back">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center justify-center py-6 px-3 text-xs text-destructive text-center flex-1">
          {error instanceof Error ? error.message : "Failed to load service details"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — split into 2 rows to avoid overlap when many controls */}
      <div className="flex flex-col shrink-0 border-b border-border bg-gradient-to-r from-primary/[0.04] via-transparent to-transparent">
        {/* Row 1: navigation + service name + state */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onBack} title="Back">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>

          {logResults ? (
            <>
              <h4 className="text-xs font-medium truncate flex-1">{serviceName}</h4>
              {logResults.context && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    const text = displayLines.join("\n");
                    navigator.clipboard.writeText(text);
                    toast.success("Logs copied to clipboard");
                  }}
                  title="Copy logs"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => { setLogResults(null); setStartPad(0); setEndPad(0); }}>
                <X className="h-3 w-3 mr-1" />
                Back to detail
              </Button>
            </>
          ) : (
            <>
              {detail && (
                <>
                  <ServiceStateBadge state={detail.state} />
                </>
              )}
              <h4 className="text-sm font-medium truncate flex-1 min-w-0">{serviceName}</h4>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6 shrink-0", watched && "text-primary")}
                onClick={() => watched ? removeWatched(connectionId, serviceName) : addWatched(connectionId, serviceName)}
                title={watched ? "Unwatch" : "Watch this service"}
                aria-label={watched ? `Unwatch ${serviceName}` : `Watch ${serviceName}`}
              >
                {watched ? <Eye className="h-3.5 w-3.5 fill-primary" /> : <EyeOff className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
        </div>

        {/* Row 2: action buttons + log search */}
        {!logResults && (
          <div className="flex items-center gap-1 px-2 pb-1.5 flex-wrap">
            {detail && (
              <>
                {detail.state !== "active" && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2 text-emerald-500" onClick={() => handleAction("start")} disabled={acting} title="Start" aria-label={`Start ${serviceName}`}>
                    {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    <span>Start</span>
                  </Button>
                )}
                {detail.state === "active" && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2 text-destructive" onClick={() => handleAction("stop")} disabled={acting} title="Stop" aria-label={`Stop ${serviceName}`}>
                    {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                    <span>Stop</span>
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => handleAction("restart")} disabled={acting} title="Restart" aria-label={`Restart ${serviceName}`}>
                  <RotateCcw className={cn("h-3 w-3", acting && "animate-spin")} />
                  <span>Restart</span>
                </Button>
                {detail.state === "failed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 px-2 text-violet-400 hover:text-violet-300"
                    onClick={(e) => {
                      const aiStore = useAIStore.getState();
                      aiStore.setContext({ connectionId, service: { name: serviceName }, logs: { serviceName, lines: 100 } });
                      aiStore.setOpen(true);
                      aiStore.setPendingPrompt(
                        `Investigate why "${serviceName}" is unhealthy. Use seeded logs + state. Check memory, recent errors, restart loops. Propose approved tools (status/journal/RSS or search_service_logs for a call_id) if needed. Root cause + fix — do NOT restart unless I ask.`,
                      );
                    }}
                    title="Diagnose with GIA"
                    aria-label={`Diagnose ${serviceName} with GIA`}
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Diagnose</span>
                  </Button>
                )}
              </>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <Input
                className="h-6 w-32 sm:w-40 text-[10px] px-2"
                placeholder="Search logs..."
                value={logQuery}
                onChange={(e) => setLogQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogSearch()}
              />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleLogSearch()} disabled={logLoading || !logQuery.trim()} aria-label="Search logs">
                {logLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              </Button>
              <Button
                variant={showLiveLogs ? "secondary" : "ghost"}
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setShowLiveLogs((v) => !v)}
                title="Live Logs"
              >
                <Terminal className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Timestamp badges when log results are showing */}
        {logResults && (logResults.startTimestamp || logResults.endTimestamp) && (
          <div className="flex flex-col gap-1 px-2 pb-1.5">
            <div className="flex items-center gap-1 text-[9px]">
              {logResults.startTimestamp && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono text-green-500 border-green-500/30 shrink-0">
                  {logResults.startTimestamp}
                </Badge>
              )}
              {logResults.startTimestamp && logResults.endTimestamp && (
                <span className="text-[9px] text-muted-foreground">→</span>
              )}
              {logResults.endTimestamp && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono text-blue-500 border-blue-500/30 shrink-0">
                  {logResults.endTimestamp}
                </Badge>
              )}
            </div>
            {logParsed.tools.size > 0 && (
              <div className="flex items-start gap-1 max-h-14 overflow-y-auto">
                <span className="text-[9px] text-muted-foreground shrink-0 pt-0.5">Tools:</span>
                <div className="flex items-center gap-1 flex-wrap min-w-0">
                  {Array.from(logParsed.tools).map((tool) => (
                    <button
                      key={tool}
                      onClick={() => {
                        const idx = toolFirstLine.get(tool);
                        if (idx !== undefined) scrollToLine(idx);
                      }}
                      title={`Scroll to first ${tool} call`}
                    >
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 h-4 font-mono text-violet-600 dark:text-violet-300 border-violet-500/25 bg-violet-500/[0.06] cursor-pointer hover:bg-violet-500/[0.15] transition-colors inline-flex items-center gap-0.5 max-w-[140px]"
                      >
                        <Wrench className="h-2 w-2 shrink-0" />
                        <span className="truncate">{tool}</span>
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {logParsed.jobIds.size > 0 && (
              <div className="flex items-start gap-1 max-h-14 overflow-y-auto">
                <span className="text-[9px] text-muted-foreground shrink-0 pt-0.5">Job IDs:</span>
                <div className="flex items-center gap-1 flex-wrap min-w-0">
                  {Array.from(logParsed.jobIds).map((jid) => (
                    <button
                      key={jid}
                      onClick={() => setActiveJobId(activeJobId === jid ? null : jid)}
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0 h-4 font-mono cursor-pointer transition-colors max-w-[120px] truncate",
                          activeJobId === jid
                            ? "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/[0.12]"
                            : "text-muted-foreground border-border/50 bg-muted/40 hover:bg-muted/70",
                        )}
                      >
                        {jid}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {displayLines.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="relative flex-1 max-w-[200px]">
                  <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
                  <input
                    value={localFilter}
                    onChange={(e) => setLocalFilter(e.target.value)}
                    placeholder="Filter lines..."
                    className="w-full h-6 pl-6 pr-6 rounded text-[10px] bg-muted/20 border border-border/40 text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-violet-500/40 transition-colors"
                  />
                  {localFilter && (
                    <button
                      onClick={() => setLocalFilter("")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-3.5 w-3.5 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                {localFilter.trim() && (
                  <span className="text-[9px] text-muted-foreground/60 font-mono whitespace-nowrap">
                    {displayLines.length} / {logParsed.lines.length}
                  </span>
                )}
                <ExtendWindowPopover startPad={startPad} endPad={endPad} onExtend={extendWindow} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {showLiveLogs ? (
        <div className="flex-1 min-h-0 p-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <LiveLogViewer
            key={`${connectionId}:${serviceName}`}
            connectionId={connectionId}
            serviceName={serviceName}
          />
        </div>
      ) : detail && !logResults && (
        <ScrollArea key="detail" className="flex-1 min-h-0 animate-reveal-up">
          <div className="p-3 space-y-3">
            <Card className="py-3 animate-reveal-zoom">
              <CardContent className="px-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">State:</span>
                    <span className="font-medium">{detail.state}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Substate:</span>
                    <span className="font-medium">{detail.substate}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">PID:</span>
                    <span className="font-medium font-mono">{detail.mainPID || "\u2014"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Memory:</span>
                    <span className="font-medium font-mono">
                      {detail.memoryCurrent !== null && detail.memoryCurrent !== undefined
                        ? `${detail.memoryCurrent.toFixed(2)} MB`
                        : "\u2014"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Load:</span>
                    <span className="font-medium">{detail.loaded}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Restart:</span>
                    <span className="font-medium">{detail.restart || "\u2014"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-3">
              <CardContent className="px-3">
                <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  Live Memory
                </h5>
                <ServiceMonitor connectionId={connectionId} serviceName={serviceName} />
              </CardContent>
            </Card>

            {fileContent && (
              <Card className="py-3">
                <CardContent className="px-3">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <FileText className="h-3 w-3" />
                      Service File
                    </h5>
                    <div className="inline-flex items-center rounded-md border border-border/50 bg-muted/30 p-0.5 gap-0.5 flex-wrap justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                        disabled={profileBusy || !unitPaths.workingDirectory}
                        onClick={handleOpenWorkingDirectory}
                        title={unitPaths.workingDirectory || "No WorkingDirectory= in unit"}
                      >
                        <FolderOpen className="h-3 w-3 mr-1" />
                        Directory
                      </Button>
                      <DropdownMenu
                        onOpenChange={(open) => {
                          if (open) handleOpenProfileMenu();
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                            disabled={profileBusy}
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            Profile
                            <ChevronDown className="h-3 w-3 ml-0.5 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                          <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                            From Environment= / EnvironmentFile=
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {unitPaths.candidates.length === 0 ? (
                            <div className="px-2 py-2 text-[11px] text-muted-foreground">
                              No paths found in this unit.
                            </div>
                          ) : (
                            unitPaths.candidates.map((c) => (
                              <DropdownMenuItem
                                key={`${c.source}:${c.path}`}
                                className="text-xs flex flex-col items-start gap-0.5 cursor-pointer"
                                onClick={() => handleOpenProfilePath(c)}
                              >
                                <span className="font-medium">{c.label}</span>
                                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full">
                                  {c.path}
                                </span>
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                        onClick={handleEditServiceFile}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    </div>
                  </div>
                  <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto max-h-96 overflow-y-auto font-mono cursor-pointer hover:bg-muted/70 transition-colors leading-relaxed" onClick={handleEditServiceFile}>
                    {fileContent}
                  </pre>
                </CardContent>
              </Card>
            )}

            {!fileContent && (
              <p className="text-xs text-muted-foreground px-1">No service file found</p>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Log results */}
      {logResults && (
        <>
          {logResults.context ? (
            <div className="flex-1 min-h-0 overflow-hidden p-2" ref={logScrollRef}>
              <LogLineViewer
                lines={displayLines.map((line, i) => ({ line, index: i }))}
                filterQuery={localFilter}
                heightClass="h-full"
                className="border border-border/40"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              No matching logs found for this query
            </div>
          )}
        </>
      )}
    </div>
  );
}
