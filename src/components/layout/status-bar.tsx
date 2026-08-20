"use client";

import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useUploadStore } from "@/stores/upload-store";
import { useUIStore } from "@/stores/ui-store";
import { fsApi } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VitalsIndicator, VitalsPopover } from "./vitals-popover";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Activity, Clock, Upload, X } from "lucide-react";

function ConnectionTimer({ connectedAt }: { connectedAt?: number }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!connectedAt) return;
    const tick = () => {
      const diff = Date.now() - connectedAt;
      const secs = Math.floor(diff / 1000);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      if (hours > 0) setElapsed(`${hours}h ${mins % 60}m`);
      else if (mins > 0) setElapsed(`${mins}m ${secs % 60}s`);
      else setElapsed(`${secs}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [connectedAt]);

  if (!connectedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/60">
      <Clock className="h-2.5 w-2.5" />
      {elapsed}
    </span>
  );
}

export function StatusBar() {
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const getExplorer = useExplorerStore((s) => s.getExplorer);
  const mainView = useUIStore((s) => s.mainView);
  const { uploads } = useUploadStore();
  const queryClient = useQueryClient();
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);

  const active = activeTabId ? activeConnections.get(activeTabId) : null;
  const explorer = activeTabId ? getExplorer(activeTabId) : null;
  const activeUploads = uploads.filter((u) => u.status === "uploading");
  const hasUploads = uploads.length > 0;

  const { data: vitals, isLoading: vitalsLoading } = useQuery({
    queryKey: ["vitals", activeTabId],
    queryFn: () => fsApi.vitals(activeTabId!),
    enabled: !!activeTabId && active?.status === "connected",
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const handleRefreshVitals = () => {
    if (activeTabId) {
      queryClient.invalidateQueries({ queryKey: ["vitals", activeTabId] });
    }
  };

  return (
    <>
      {/* Upload Panel — docked above status bar */}
      {uploadPanelOpen && hasUploads && (
        <div className="border-t border-border bg-background px-3 py-2 flex flex-col gap-1.5 max-h-32 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground/70">Uploads</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => useUploadStore.getState().clearCompleted()}
                className="text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                Clear done
              </button>
              <button
                onClick={() => setUploadPanelOpen(false)}
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2 text-[10px]">
              <span className={cn(
                "truncate flex-1",
                u.status === "error" && "text-red-500",
                u.status === "completed" && "text-green-500",
              )}>
                {u.fileName}
              </span>
              <span className="text-muted-foreground/60 font-mono w-10 text-right">
                {u.status === "uploading" ? `${u.progress}%` : u.status}
              </span>
              {u.status === "completed" && (
                <button
                  onClick={() => useUploadStore.getState().removeUpload(u.id)}
                  className="text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex h-6 items-center border-t border-border bg-background px-3 text-xs text-muted-foreground relative z-10">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {active && (
          <>
            <Badge
              variant="outline"
              className={cn(
                "flex items-center gap-1.5 text-[10px] px-2 py-0 font-normal h-4 transition-colors duration-300",
                active.status === "connected" && "border-green-500/30 text-green-600",
                active.status === "connecting" && "border-yellow-500/30 text-yellow-600",
                active.status === "error" && "border-red-500/30 text-red-600",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-300",
                  active.status === "connecting" && "bg-yellow-500 animate-pulse glow-yellow",
                  active.status === "error" && "bg-red-500 glow-red",
                  active.status === "connected" && "bg-green-500 glow-green",
                )}
              />
              {active.connection.username}@{active.connection.host}:{active.connection.port}
            </Badge>
            {active.status === "connected" && (
              <ConnectionTimer connectedAt={active.connectedAt} />
            )}
            {mainView === "services" ? (
              <Badge
                variant="outline"
                className="hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0 h-4 font-normal border-violet-500/25 text-violet-600/80 dark:text-violet-300/70"
              >
                <Activity className="h-2.5 w-2.5" />
                Services
              </Badge>
            ) : (
              explorer?.currentPath && (
                <span className="truncate text-[10px] text-muted-foreground/70 hidden sm:inline">
                  {explorer.currentPath}
                </span>
              )
            )}
            {mainView === "explorer" && explorer && explorer.selectedItems.size > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {explorer.selectedItems.size} selected
              </Badge>
            )}
          </>
        )}
        {!active && <span className="text-[10px] text-muted-foreground/50">No active connection</span>}
      </div>

      {/* Centered brand — quiet, readable */}
      <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1 text-[9px] text-muted-foreground/45 select-none font-mono pointer-events-none tracking-wide">
        Made by <span className="text-violet-600/65 dark:text-violet-400/50 font-semibold tracking-wider">GIA Team</span>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {active && active.status === "error" && (
          <span className="text-[10px] text-red-500 truncate max-w-[200px]">{active.error}</span>
        )}
        {activeUploads.length > 0 && (
          <button
            onClick={() => setUploadPanelOpen(!uploadPanelOpen)}
            className={cn("cursor-pointer transition-opacity", uploadPanelOpen && "opacity-80")}
          >
            <Badge variant="secondary" className={cn(
              "flex items-center gap-1 text-[10px] px-1.5 py-0 h-4 font-normal cursor-pointer hover:bg-secondary/80 transition-colors",
              uploadPanelOpen && "ring-1 ring-violet-500/40 bg-violet-500/10"
            )}>
              <Upload className="h-2.5 w-2.5" />
              {activeUploads.length}
            </Badge>
          </button>
        )}
        {activeTabId && active?.status === "connected" && (
          <VitalsPopover
            vitals={vitals}
            isLoading={vitalsLoading}
            onRefresh={handleRefreshVitals}
          >
            <button className="flex items-center cursor-pointer hover:text-foreground transition-colors">
              <VitalsIndicator vitals={vitals} isLoading={vitalsLoading} />
            </button>
          </VitalsPopover>
        )}
      </div>
    </div>
    </>
  );
}
