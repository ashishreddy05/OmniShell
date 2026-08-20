"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { fsApi, bookmarksApi, connectionsApi } from "@/lib/api-client";
import { BreadcrumbNav } from "./breadcrumb-nav";
import { Toolbar } from "./toolbar";
import { FileGrid } from "./file-grid";
import { UploadZone } from "@/components/upload/upload-zone";
import { toast } from "sonner";
import { Loader2, FolderOpen, Plus, AlertCircle, RefreshCw, Server, Wifi, WifiOff, FileInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUIStore } from "@/stores/ui-store";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { GiaMark } from "@/components/brand/gia-mark";
import type { FileEntry } from "../../../server/ssh/sftp-operations";

export function FileExplorer() {
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const { setActiveTab, setConnectionStatus } = useConnectionStore();
  const { getExplorer, navigate, setSort, setViewMode, toggleHidden } = useExplorerStore();
  const queryClient = useQueryClient();

  const connectionId = activeTabId ?? "";
  const active = activeTabId ? activeConnections.get(activeTabId) : null;
  const explorer = getExplorer(connectionId);
  const uploadOpenRef = useRef<(() => void) | null>(null);
  const uploadFolderRef = useRef<(() => void) | null>(null);

  const { data: connections = [] } = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["fs", "list", connectionId, explorer.currentPath],
    queryFn: () => fsApi.list(connectionId, explorer.currentPath),
    enabled: !!connectionId && active?.status === "connected",
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const entries = useMemo(() => {
    let e: FileEntry[] = data?.entries ?? [];
    if (!explorer.showHidden) {
      e = e.filter((entry) => !entry.isHidden);
    }
    return sortEntries(e, explorer.sortBy, explorer.sortDir);
  }, [data?.entries, explorer.showHidden, explorer.sortBy, explorer.sortDir]);

  const openConnectionForm = useUIStore((s) => s.openConnectionForm);
  const openSSHImport = useUIStore((s) => s.openSSHImport);
  const setUserManualOpen = useUIStore((s) => s.setUserManualOpen);

  const handleQuickConnect = async (connectionId: string) => {
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) return;
    setConnectionStatus(connectionId, connection, "connecting");
    try {
      await connectionsApi.connect(connectionId);
      setConnectionStatus(connectionId, connection, "connected");
      navigate(connectionId, connection.defaultPath || "/");
      setActiveTab(connectionId);
    } catch (err) {
      setConnectionStatus(connectionId, connection, "error", (err as Error).message);
      toast.error(`Failed to connect: ${(err as Error).message}`);
    }
  };

  if (!connectionId || !active || active.status !== "connected") {
    const available = connections.filter((c) => {
      const a = activeConnections.get(c.id);
      return !a || a.status !== "connected";
    });
    const connected = connections.filter((c) => {
      const a = activeConnections.get(c.id);
      return a?.status === "connected";
    });

    return (
      <div className="flex h-full flex-col items-center justify-center gap-7 p-8 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="h-12 w-12 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center mx-auto shadow-[0_0_24px_rgba(139,92,246,0.12)]">
            <FolderOpen className="h-6 w-6 text-violet-500 dark:text-violet-400/80" strokeWidth={1.5} />
          </div>
          <p className="text-base font-semibold text-foreground tracking-tight">Your workspace is ready</p>
          <p className="text-sm text-muted-foreground">Connect to a server to start managing files</p>
        </div>

        {/* Quick connect cards */}
        {(connected.length > 0 || available.length > 0) && (
          <div className="w-full max-w-md space-y-2">
            {connected.map((conn) => (
              <button
                key={conn.id}
                onClick={() => setActiveTab(conn.id)}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-all text-left group"
              >
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 glow-green shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{conn.name}</div>
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400/80">Connected · open explorer</div>
                </div>
                <Wifi className="h-4 w-4 text-emerald-500/60 group-hover:text-emerald-500 transition-colors shrink-0" />
              </button>
            ))}
            {available.map((conn) => (
              <button
                key={conn.id}
                onClick={() => handleQuickConnect(conn.id)}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border bg-card/60 hover:border-violet-500/35 hover:bg-violet-500/[0.04] transition-all text-left group shadow-sm"
              >
                <div className="h-8 w-8 rounded-lg bg-muted/80 border border-border/60 flex items-center justify-center shrink-0 group-hover:border-violet-500/30 group-hover:bg-violet-500/10 transition-colors">
                  <Server className="h-3.5 w-3.5 text-muted-foreground group-hover:text-violet-500 dark:group-hover:text-violet-400 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{conn.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate font-mono">{conn.host}:{conn.port}</div>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] px-2 py-0 h-5 border-violet-500/30 text-violet-600 dark:text-violet-300 font-medium shrink-0 bg-violet-500/[0.06]"
                >
                  Connect
                </Badge>
              </button>
            ))}
          </div>
        )}

        {/* Actions — outline primary so light-mode terracotta doesn't read as destructive */}
        <div className="flex flex-col items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => openConnectionForm()}
            className="h-8 px-4 border-violet-500/30 bg-violet-500/[0.06] text-violet-700 dark:text-violet-200 hover:bg-violet-500/15 hover:text-violet-800 dark:hover:text-violet-100 hover:border-violet-500/45 shadow-none"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Connection
          </Button>
          <div className="flex items-center gap-1">
            <button
              onClick={openSSHImport}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <FileInput className="h-3 w-3" />
              Import SSH
            </button>
            <span className="text-border text-xs">·</span>
            <button
              onClick={() => setUserManualOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <GiaMark size={14} />
              GIA Core
            </button>
          </div>
        </div>

        {connections.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center max-w-xs">
            Add a connection to get started — you&apos;ll need an SSH private key and a remote server.
          </p>
        )}
      </div>
    );
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["fs", "list", connectionId, explorer.currentPath] });
  };

  const handleBookmark = async () => {
    try {
      await bookmarksApi.create({
        connectionId,
        path: explorer.currentPath,
        label: explorer.currentPath.split("/").pop() || explorer.currentPath,
      });
      queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      toast.success("Bookmarked!");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <BreadcrumbNav
        connectionId={connectionId}
        path={explorer.currentPath}
        onNavigate={(path) => navigate(connectionId, path)}
      />
      <Toolbar
        viewMode={explorer.viewMode}
        sortBy={explorer.sortBy}
        sortDir={explorer.sortDir}
        showHidden={explorer.showHidden}
        onViewModeChange={(mode) => setViewMode(connectionId, mode)}
        onSortChange={(by) => setSort(connectionId, by)}
        onToggleHidden={() => toggleHidden(connectionId)}
        onRefresh={handleRefresh}
        onBookmark={handleBookmark}
        onUpload={() => uploadOpenRef.current?.()}
        onUploadFolder={() => uploadFolderRef.current?.()}
      />
      <UploadZone connectionId={connectionId} remotePath={explorer.currentPath} onUploaded={handleRefresh} openRef={uploadOpenRef} openFolderRef={uploadFolderRef}>
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex h-full items-center justify-center animate-fade-in">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="flex h-full flex-col items-center justify-center text-center gap-3 animate-fade-in">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Failed to load directory</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">{(error as Error).message}</p>
              </div>
              <Button size="sm" variant="outline" onClick={handleRefresh}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          )}
          {!isLoading && !error && (
            <FileGrid
              connectionId={connectionId}
              entries={entries}
              viewMode={explorer.viewMode}
              selectedItems={explorer.selectedItems}
              onRefresh={handleRefresh}
            />
          )}
        </div>
      </UploadZone>
    </div>
  );
}

function sortEntries(entries: FileEntry[], sortBy: string, sortDir: string): FileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Directories always first
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;

    let cmp = 0;
    switch (sortBy) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "size":
        cmp = a.size - b.size;
        break;
      case "modified":
        cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
        break;
      case "type": {
        const extA = a.name.split(".").pop() ?? "";
        const extB = b.name.split(".").pop() ?? "";
        cmp = extA.localeCompare(extB);
        break;
      }
    }
    return cmp;
  });

  return sortDir === "desc" ? sorted.reverse() : sorted;
}
