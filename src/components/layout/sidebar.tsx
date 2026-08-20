"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionsApi, bookmarksApi } from "@/lib/api-client";
import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useUIStore } from "@/stores/ui-store";
import { disconnectAndCleanup } from "@/lib/disconnect";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Server, Plus, Bookmark, History, Wifi, WifiOff, Trash2, Pencil,
  MoreHorizontal, Unplug, Download, Folder, Activity, BookmarkPlus,
  FileInput, ChevronDown, ChevronRight, Search as SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

const COLLAPSED_KEY = "sidebar-collapsed-sections";

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}

function CollapsibleSection({
  id,
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const isCollapsed = collapsed.has(id);

  const toggle = () => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    saveCollapsed(next);
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center justify-between w-full mb-1 pl-1 pr-0.5 py-0.5 rounded hover:bg-accent/40 transition-colors group/header"
      >
        <h3 className="text-[10px] font-semibold uppercase text-muted-foreground/70 tracking-widest flex items-center gap-1.5 border-l-2 border-violet-500/25 pl-2">
          <Icon className="h-3 w-3" />
          {title}
        </h3>
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover/header:text-muted-foreground/70 transition-colors" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground/40 group-hover/header:text-muted-foreground/70 transition-colors" />
        )}
      </button>
      {!isCollapsed && children}
    </div>
  );
}

function ConfirmDelete({
  onConfirm,
  label,
}: {
  onConfirm: () => void;
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground/70">
          Delete "{label}"?
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
        >
          <Trash2 className="h-3 w-3 mr-2" />
          Yes, delete
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={(e) => e.stopPropagation()}>
          Cancel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar() {
  const { activeConnections, activeTabId, setActiveTab, setConnectionStatus } = useConnectionStore();
  const { navigate, getExplorer } = useExplorerStore();
  const openConnectionForm = useUIStore((s) => s.openConnectionForm);
  const openSSHImport = useUIStore((s) => s.openSSHImport);
  const setMainView = useUIStore((s) => s.setMainView);
  const mainView = useUIStore((s) => s.mainView);
  const queryClient = useQueryClient();
  const [bookmarkFilter, setBookmarkFilter] = useState("");

  const { data: connections = [] } = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });

  const { data: bookmarks = [], refetch: refetchBookmarks } = useQuery({
    queryKey: ["bookmarks"],
    queryFn: bookmarksApi.list,
  });

  const handleConnect = async (connectionId: string) => {
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) return;

    setConnectionStatus(connectionId, connection, "connecting");
    try {
      await connectionsApi.connect(connectionId);
      setConnectionStatus(connectionId, connection, "connected");
      navigate(connectionId, connection.defaultPath || "/");
      setActiveTab(connectionId);
      toast.success(`Connected to ${connection.name}`);
    } catch (err) {
      setConnectionStatus(connectionId, connection, "error", (err as Error).message);
      toast.error(`Failed to connect: ${(err as Error).message}`);
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    if (!window.confirm(`Delete connection "${conn?.name || connectionId}"?`)) return;
    try {
      if (activeConnections.has(connectionId)) {
        await disconnectAndCleanup(connectionId);
      }
      await connectionsApi.delete(connectionId);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection deleted");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      await disconnectAndCleanup(connectionId);
      toast.success("Disconnected");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDeleteBookmark = async (id: string) => {
    try {
      await bookmarksApi.delete(id);
      refetchBookmarks();
      toast.success("Bookmark removed");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleServicesClick = async () => {
    if (activeTabId) {
      const active = activeConnections.get(activeTabId);
      if (active?.status === "connected") {
        setMainView("services");
        return;
      }
    }
    const targetId = activeTabId || connections[0]?.id;
    if (!targetId) return;
    const connection = connections.find((c) => c.id === targetId);
    if (!connection) return;
    setConnectionStatus(targetId, connection, "connecting");
    try {
      await connectionsApi.connect(targetId);
      setConnectionStatus(targetId, connection, "connected");
      setActiveTab(targetId);
      navigate(targetId, connection.defaultPath || "/");
      setMainView("services");
    } catch (err) {
      setConnectionStatus(targetId, connection, "error", (err as Error).message);
      toast.error(`Failed to connect: ${(err as Error).message}`);
    }
  };

  const handleNavigateBookmark = async (connectionId: string, path: string) => {
    const active = activeConnections.get(connectionId);
    if (active?.status === "connected") {
      setActiveTab(connectionId);
      navigate(connectionId, path);
      return;
    }

    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) {
      toast.error("Connection not found");
      return;
    }

    setConnectionStatus(connectionId, connection, "connecting");
    try {
      await connectionsApi.connect(connectionId);
      setConnectionStatus(connectionId, connection, "connected");
      setActiveTab(connectionId);
      navigate(connectionId, path);
    } catch (err) {
      setConnectionStatus(connectionId, connection, "error", (err as Error).message);
      toast.error(`Failed to connect: ${(err as Error).message}`);
    }
  };

  // Group bookmarks by connection
  const bookmarksByConnection = useMemo(() => {
    const map = new Map<string, typeof bookmarks>();
    const filtered = bookmarkFilter
      ? bookmarks.filter((bm) => {
          const label = (bm.label || bm.path).toLowerCase();
          const connName = connections.find((c) => c.id === bm.connectionId)?.name?.toLowerCase() || "";
          const q = bookmarkFilter.toLowerCase();
          return label.includes(q) || connName.includes(q) || bm.path.toLowerCase().includes(q);
        })
      : bookmarks;
    for (const bm of filtered) {
      const connName = connections.find((c) => c.id === bm.connectionId)?.name || "Unknown";
      if (!map.has(connName)) map.set(connName, []);
      map.get(connName)!.push(bm);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [bookmarks, connections, bookmarkFilter]);

  const showBookmarkFilter = bookmarks.length > 8;

  return (
    <ScrollArea className="h-full">
        <div className="p-3 space-y-4">
          {/* Connections Section */}
          <CollapsibleSection id="connections" title="Connections" icon={Server}>
            <div className="flex items-center gap-0.5 mb-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => openConnectionForm()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>New Connection</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={openSSHImport}
                    aria-label="Import from SSH config"
                  >
                    <FileInput className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Import from SSH Config</TooltipContent>
              </Tooltip>
              <div className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 transition-all duration-200",
                      mainView === "services"
                        ? "text-violet-400 bg-violet-500/15 hover:bg-violet-500/25 ring-1 ring-violet-500/30"
                        : "text-muted-foreground hover:text-foreground",
                      connections.length === 0 && "opacity-30"
                    )}
                    onClick={handleServicesClick}
                    disabled={connections.length === 0}
                    aria-pressed={mainView === "services"}
                    title={mainView === "services" ? "Services view (active)" : "Open Service Manager"}
                  >
                    <Activity className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {mainView === "services" ? "Services · active" : "Service Manager"}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="space-y-0.5">
              {connections.map((conn) => {
                const active = activeConnections.get(conn.id);
                const isConnected = active?.status === "connected";
                const isConnecting = active?.status === "connecting";
                const isActive = activeTabId === conn.id;
                return (
                  <div
                    key={conn.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-all duration-150",
                      isActive
                        ? "bg-accent text-accent-foreground shadow-sm ring-1 ring-border/60"
                        : "hover:bg-accent/50",
                      isConnected  && "border-l-2 border-l-green-500",
                      isConnecting && "border-l-2 border-l-yellow-500",
                      !isConnected && !isConnecting && "border-l-2 border-l-transparent",
                    )}
                    onClick={() => isConnected ? setActiveTab(conn.id) : handleConnect(conn.id)}
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0 transition-all duration-300",
                        isConnected    && "bg-green-500 glow-green",
                        isConnecting   && "bg-yellow-500 animate-pulse glow-yellow",
                        !isConnected && !isConnecting && "bg-slate-400",
                      )}
                    />
                    <span className="flex-1 truncate text-xs font-medium">{conn.name}</span>
                    <div className="flex items-center gap-1">
                      {isConnected ? (
                        <Wifi className="h-3 w-3 text-green-500/70" />
                      ) : isConnecting ? (
                        <Wifi className="h-3 w-3 text-yellow-500/70 animate-pulse" />
                      ) : (
                        <WifiOff className="h-3 w-3 text-muted-foreground/40" />
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => openConnectionForm(conn.id)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          {isConnected && (
                            <DropdownMenuItem onClick={() => handleDisconnect(conn.id)}>
                              <Unplug className="h-3.5 w-3.5 mr-2" />
                              Disconnect
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteConnection(conn.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
              {connections.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 py-5 text-center">
                  <Server className="h-6 w-6 text-muted-foreground/25" />
                  <p className="text-[11px] text-muted-foreground/50">No connections yet</p>
                </div>
              )}
            </div>
          </CollapsibleSection>

          <Separator />

          {/* Bookmarks Section */}
          <CollapsibleSection id="bookmarks" title="Bookmarks" icon={Bookmark}>
            {showBookmarkFilter && (
              <div className="relative mb-2">
                <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                <Input
                  value={bookmarkFilter}
                  onChange={(e) => setBookmarkFilter(e.target.value)}
                  placeholder="Filter bookmarks…"
                  className="h-6 pl-6 text-[10px] border-border/50 bg-muted/20"
                />
              </div>
            )}
            <div className="space-y-2.5">
              {bookmarksByConnection.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                  <BookmarkPlus className="h-5 w-5 text-muted-foreground/40" />
                  <p className="text-[11px] text-muted-foreground">
                    {bookmarkFilter ? "No matches" : "No bookmarks yet"}
                  </p>
                </div>
              )}
              {bookmarksByConnection.map(([connName, bms]) => (
                <div key={connName} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 px-1 pb-0.5">
                    <span className="text-[9px] font-semibold uppercase text-muted-foreground tracking-wider truncate">
                      {connName}
                    </span>
                    <span className="text-[9px] tabular-nums text-muted-foreground/70">{bms.length}</span>
                  </div>
                  {bms.map((bm) => {
                    const leaf = bm.label || bm.path.split("/").filter(Boolean).pop() || bm.path;
                    const showPath = leaf !== bm.path;
                    return (
                      <div
                        key={bm.id}
                        className="group flex items-start gap-1.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent/60 transition-colors"
                        onClick={() => handleNavigateBookmark(bm.connectionId, bm.path)}
                        title={bm.path}
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0 text-violet-500/70 dark:text-violet-400/70 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-[11px] font-medium text-foreground leading-tight">
                            {leaf}
                          </div>
                          {showPath && (
                            <div className="truncate text-[10px] text-muted-foreground font-mono leading-tight mt-0.5">
                              {bm.path}
                            </div>
                          )}
                        </div>
                        <ConfirmDelete
                          label={leaf}
                          onConfirm={() => handleDeleteBookmark(bm.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <Separator />

          {/* Recent Paths */}
          {activeTabId && activeConnections.get(activeTabId)?.status === "connected" && (
            <CollapsibleSection id="recent" title="Recent" icon={History}>
              <RecentPaths
                connectionId={activeTabId}
                getExplorer={getExplorer}
                onNavigate={(path) => navigate(activeTabId, path)}
              />
            </CollapsibleSection>
          )}
        </div>
    </ScrollArea>
  );
}

function RecentPaths({
  connectionId,
  getExplorer,
  onNavigate,
}: {
  connectionId: string;
  getExplorer: (id: string) => { currentPath: string; history: string[] };
  onNavigate: (path: string) => void;
}) {
  const explorer = getExplorer(connectionId);

  const recentPaths = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = explorer.history.length - 1; i >= 0; i--) {
      const p = explorer.history[i];
      if (p === explorer.currentPath || seen.has(p)) continue;
      seen.add(p);
      result.push(p);
      if (result.length >= 8) break;
    }
    return result;
  }, [explorer.history, explorer.currentPath]);

  return (
    <div className="space-y-0.5">
      {recentPaths.map((p) => (
        <div
          key={p}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => onNavigate(p)}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{p.split("/").pop() || "/"}</div>
            <div className="text-[10px] text-muted-foreground truncate font-mono">{p}</div>
          </div>
        </div>
      ))}
      {recentPaths.length === 0 && (
        <p className="text-xs text-muted-foreground px-2 py-2 text-center">
          No recent paths
        </p>
      )}
    </div>
  );
}
