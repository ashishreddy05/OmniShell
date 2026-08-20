"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWatchStore } from "@/stores/watch-store";
import { servicesApi } from "@/lib/api-client";
import { wsClient } from "@/lib/ws-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EyeOff, Eye, Activity, GripVertical, Play, Square, RotateCcw, Sparkles, MoreVertical, ChevronDown, ChevronRight } from "lucide-react";
import { useAIStore } from "@/stores/ai-store";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ServiceMemory {
  name: string;
  memoryMB: number | null;
}

export function WatchedDashboard({
  connectionId,
  onViewService,
}: {
  connectionId: string;
  onViewService: (name: string) => void;
}) {
  const allWatched = useWatchStore((s) => s.watched);
  const removeWatched = useWatchStore((s) => s.removeWatched);
  const reorderWatched = useWatchStore((s) => s.reorderWatched);
  const [memoryData, setMemoryData] = useState<Map<string, number | null>>(new Map());
  const [collapsed, setCollapsed] = useState(false);

  const watched = useMemo(
    () => allWatched.filter((w) => w.connectionId === connectionId),
    [allWatched, connectionId]
  );

  const [stateHistory, setStateHistory] = useState<Map<string, string[]>>(new Map());

  const watchedKey = useMemo(
    () => watched.map((w) => w.serviceName).sort().join(","),
    [watched]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = watched.findIndex((w) => w.serviceName === active.id);
    const newIndex = watched.findIndex((w) => w.serviceName === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...watched];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    reorderWatched(connectionId, reordered.map((w) => w.serviceName));
  };

  // Fetch status for all watched services
  const { data: statusData } = useQuery({
    queryKey: ["watched-services-status", connectionId, watchedKey],
    queryFn: async () => {
      if (watched.length === 0) return [];
      const res = await servicesApi.getStatusBatch(connectionId, watched.map((w) => w.serviceName));
      return res.services;
    },
    enabled: watched.length > 0,
    // Offset from the 15s list poll and 18s detail poll to stagger bursts
    refetchInterval: 21_000,
  });

  // Track state history from polled data
  useEffect(() => {
    if (!statusData) return;
    const timer = setTimeout(() => {
      setStateHistory((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const s of statusData) {
          const history = next.get(s.name) || [];
          const currentState = s.state || "unknown";
          const newHistory = [...history, currentState].slice(-15);
          
          // Check if history actually changed to avoid unnecessary renders
          const hasChanged = history.length !== newHistory.length || 
            history.some((val, idx) => val !== newHistory[idx]);
            
          if (hasChanged) {
            next.set(s.name, newHistory);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [statusData]);

  // Subscribe to batch memory updates (suspend SSH work when tab is hidden)
  useEffect(() => {
    if (watched.length === 0) return;

    const serviceNames = watched.map((w) => w.serviceName);

    const startBatch = (interval: number) => {
      wsClient.send({
        type: "monitor:start-batch",
        connectionId,
        payload: { serviceNames, interval },
      });
    };
    const stopBatch = () => {
      wsClient.send({
        type: "monitor:stop-batch",
        connectionId,
        payload: {},
      });
    };

    const unsubMemory = wsClient.on("monitor:batch-memory", (msg) => {
      if (msg.connectionId === connectionId) {
        const services = (msg.payload.services as ServiceMemory[]) || [];
        setMemoryData((prev) => {
          const next = new Map(prev);
          for (const s of services) {
            next.set(s.name, s.memoryMB);
          }
          return next;
        });
      }
    });

    const unsubReconnect = wsClient.on("ws:connected", () => {
      if (document.visibilityState === "visible") {
        startBatch(15000);
      }
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopBatch();
      } else if (wsClient.isConnected) {
        startBatch(3000);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Only send immediately if WS is already connected and tab is visible.
    // Otherwise ws:connected / visibilitychange will start when ready.
    if (wsClient.isConnected && document.visibilityState === "visible") {
      startBatch(3000);
    }

    return () => {
      stopBatch();
      unsubMemory();
      unsubReconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [connectionId, watchedKey]);

  const statusMap = new Map(
    (statusData || []).map((s) => [
      s.name,
      s.state || "unknown",
    ])
  );

  return (
    <div className="px-2 py-1.5">
      <button
        className="flex items-center gap-1.5 mb-1.5 w-full text-left group/toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground/60 group-hover/toggle:text-foreground transition-colors" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 group-hover/toggle:text-foreground transition-colors" />
        )}
        <Eye className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Watched</span>
        {watched.length > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-mono">
            {watched.length}
          </Badge>
        )}
      </button>
      {collapsed ? null : watched.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <Activity className="h-5 w-5 text-muted-foreground/25" />
          <span className="text-[10px] text-muted-foreground/50">Pin a service to track it here</span>
        </div>
      ) : (
        <div className="space-y-0.5">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={watched.map((w) => w.serviceName)} strategy={verticalListSortingStrategy}>
                {watched.map((w, idx) => {
                  const state = (statusMap.get(w.serviceName) as string) || "unknown";
                  const memoryMB = memoryData.get(w.serviceName) ?? null;
                  const history = stateHistory.get(w.serviceName) || [];
                  return (
                    <SortableWatchedItem
                      key={w.serviceName}
                      serviceName={w.serviceName}
                      state={state}
                      memoryMB={memoryMB}
                      history={history}
                      idx={idx}
                      connectionId={connectionId}
                      onViewService={onViewService}
                      onRemove={removeWatched}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          </div>
      )}
    </div>
  );
}

function UptimeTimeline({ history }: { history: string[] }) {
  const paddedHistory = useMemo(() => {
    const padCount = 15 - history.length;
    const padding = Array(Math.max(0, padCount)).fill("unknown");
    return [...padding, ...history];
  }, [history]);

  const activeCount = paddedHistory.filter((s) => s === "active").length;
  const failedCount = paddedHistory.filter((s) => s === "failed").length;
  const uptimePct = paddedHistory.length > 0 ? (activeCount / paddedHistory.length) * 100 : 0;

  return (
    <div className="flex items-center gap-[2px] shrink-0 group/uptime relative" title={`Uptime History (last 15 checks)\n${uptimePct.toFixed(0)}% active · ${failedCount} failed`}>
      {paddedHistory.map((s, i) => (
        <span
          key={i}
          className={cn(
            "h-2 w-1.5 rounded-[1.5px] border-[0.5px] transition-all duration-300",
            s === "active"  && "bg-emerald-500/80 border-emerald-400/20",
            s === "failed"  && "bg-red-500/80 border-red-400/20 animate-pulse",
            s !== "active" && s !== "failed" && "bg-muted dark:bg-slate-800 border-border dark:border-slate-700/50"
          )}
        />
      ))}
    </div>
  );
}

/**
 * HealthScore: 0-100 composite metric for a watched service.
 * - State weight: 50 pts (active=50, other=25, failed=0)
 * - Memory: 0-30 pts (low memory = high score, high memory = low)
 * - Uptime: 0-20 pts (% of recent history that was active × 0.2)
 */
function HealthScore({
  state,
  memoryMB,
  history,
}: {
  state: string;
  memoryMB: number | null;
  history: string[];
}) {
  const score = useMemo(() => {
    let s = 0;
    if (state === "active") s += 50;
    else if (state === "failed") s += 0;
    else s += 25;

    if (memoryMB !== null) {
      if (memoryMB < 100) s += 30;
      else if (memoryMB < 250) s += 22;
      else if (memoryMB < 500) s += 14;
      else if (memoryMB < 1000) s += 6;
      else s += 0;
    } else {
      s += 15; // neutral when unknown
    }

    if (history.length > 0) {
      const activeCount = history.filter((h) => h === "active").length;
      s += Math.round((activeCount / history.length) * 20);
    }

    return Math.max(0, Math.min(100, s));
  }, [state, memoryMB, history]);

  const colorClass =
    score >= 75 ? "text-emerald-400" :
    score >= 50 ? "text-amber-400" :
    score >= 25 ? "text-orange-400" :
    "text-red-400";

  return (
    <span
      className={cn(
        "text-[10px] font-mono font-semibold tabular-nums shrink-0 min-w-[1.25rem] text-right",
        colorClass,
      )}
      title={`Health score: ${score}/100 (state + memory + uptime)`}
    >
      {score}
    </span>
  );
}

function SortableWatchedItem({
  serviceName,
  state,
  memoryMB,
  history,
  idx,
  connectionId,
  onViewService,
  onRemove,
}: {
  serviceName: string;
  state: string;
  memoryMB: number | null;
  history: string[];
  idx: number;
  connectionId: string;
  onViewService: (name: string) => void;
  onRemove: (connectionId: string, serviceName: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: serviceName,
  });
  const [acting, setActing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"start" | "stop" | "restart" | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    animationDelay: `${idx * 40}ms`,
  };

  const handleAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setActing(true);
    setConfirmAction(null);
    try {
      await servicesApi.act(connectionId, serviceName, action);
      toast.success(`${action} ${serviceName}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setActing(false);
    }
  }, [connectionId, serviceName]);

  const handleDiagnose = useCallback(async () => {
    setDiagnosing(true);
    try {
      const logRes = await servicesApi.logs(connectionId, serviceName, { tail: 100 }) as { logs: string };
      const content = logRes.logs || "";
      const aiStore = useAIStore.getState();
      aiStore.setContext({
        connectionId,
        service: { name: serviceName },
        logs: { serviceName, content, lines: 100 }
      });
      aiStore.setOpen(true);
      aiStore.setPendingPrompt(
        `Investigate why "${serviceName}" is unhealthy. Use the seeded logs + service state. Check memory (RSS/cgroup if available), recent errors, and restart loops. If you need more evidence, propose approved tools (systemctl status / journalctl -n 50 / search_service_logs for a call_id). Summarize root cause + concrete fix. Do NOT restart unless I ask.`,
      );
    } catch (err) {
      toast.error("Failed to fetch logs for diagnosis");
    } finally {
      setDiagnosing(false);
    }
  }, [connectionId, serviceName]);

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "group flex flex-col gap-0.5 rounded-md px-1 py-1.5 text-sm transition-all duration-150",
          isDragging ? "opacity-50 shadow-lg ring-1 ring-primary/20 z-10" : "hover:bg-accent/50",
          state === "active" && !isDragging && "bg-gradient-to-r from-transparent to-emerald-500/[0.04]",
          state === "failed" && !isDragging && "bg-gradient-to-r from-transparent to-red-500/[0.04]",
          "animate-stagger cursor-default"
        )}
      >
        {/* Row 1: grip + name + state + health */}
        <div className="flex items-center gap-1">
          <button
            className="h-5 w-4 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
            title="Drag to reorder"
          >
            <GripVertical className="h-3 w-3" />
          </button>
          <div
            className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
            onClick={() => onViewService(serviceName)}
          >
            <span className="truncate text-xs font-medium">{serviceName}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] px-1 py-0 font-mono leading-3",
                state === "active" && "text-green-500 border-green-500/30",
                state === "failed" && "text-red-500 border-red-500/30",
                state !== "active" && state !== "failed" && "text-muted-foreground",
              )}
            >
              {state}
            </Badge>
          </div>
          <HealthScore state={state} memoryMB={memoryMB} history={history} />
        </div>

        {/* Row 2: timeline + memory + Diagnose + menu */}
        <div className="flex items-center gap-1.5 pl-5">
          <UptimeTimeline history={history} />
          {memoryMB !== null ? (
            <span
              className={cn(
                "text-[10px] font-mono px-1.5 py-0.5 rounded-md",
                memoryMB > 200
                  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}
            >
              {memoryMB.toFixed(1)} MB
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/40">—</span>
          )}
          <div className="flex-1" />
          {state === "failed" && (
            <Button
              size="xs"
              variant="outline"
              className="h-5 gap-1 px-1.5 text-[9px] leading-none border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-200 hover:bg-violet-500/20 shrink-0 font-medium shadow-none"
              onClick={(e) => {
                e.stopPropagation();
                handleDiagnose();
              }}
              disabled={diagnosing}
              title="Diagnose with GIA"
              aria-label={`Diagnose ${serviceName} with GIA`}
            >
              <Sparkles className="size-2.5 text-violet-500 dark:text-violet-300" />
              {diagnosing ? "Loading…" : "Diagnose"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 border border-border/40 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-200 shrink-0"
                onClick={(e) => e.stopPropagation()}
                title="Actions"
                disabled={acting}
              >
                {acting ? (
                  <Activity className="h-3 w-3 animate-spin" />
                ) : (
                  <MoreVertical className="h-3 w-3" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onClick={() => setConfirmAction("start")}>
                <Play className="h-3 w-3 mr-2 text-emerald-500" />
                Start
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConfirmAction("stop")}>
                <Square className="h-3 w-3 mr-2 text-destructive" />
                Stop
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmAction("restart")}>
                <RotateCcw className="h-3 w-3 mr-2 text-amber-500" />
                Restart
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-40 hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(connectionId, serviceName);
            }}
            title="Unwatch"
            aria-label={`Unwatch ${serviceName}`}
          >
            <EyeOff className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm capitalize">{confirmAction} {serviceName}?</DialogTitle>
            <DialogDescription className="text-xs">
              {confirmAction === "stop" && "This will stop the service. Connected clients may be affected."}
              {confirmAction === "restart" && "This will restart the service. Brief interruption expected."}
              {confirmAction === "start" && "This will start the service if it is not already running."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              size="sm"
              variant={confirmAction === "stop" ? "destructive" : "default"}
              onClick={() => confirmAction && handleAction(confirmAction)}
              disabled={acting}
            >
              {acting ? "Processing..." : `Yes, ${confirmAction}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
