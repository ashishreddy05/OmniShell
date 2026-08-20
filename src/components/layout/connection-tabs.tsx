"use client";

import { useConnectionStore } from "@/stores/connection-store";
import { useUIStore } from "@/stores/ui-store";
import { useNotificationStore } from "@/stores/notification-store";
import { Button } from "@/components/ui/button";
import { GiaMark } from "@/components/brand/gia-mark";
import { X, PanelLeftClose, PanelLeft, Moon, Sun, ServerOff, Search, Terminal, Folder, Activity, Bell, BellRing } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { disconnectAndCleanup } from "@/lib/disconnect";
import { toast } from "sonner";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";

export function ConnectionTabs({ onSearchOpen }: { onSearchOpen?: () => void }) {
  const { activeConnections, activeTabId, setActiveTab } = useConnectionStore();
  const { sidebarOpen, toggleSidebar, toggleTerminal, terminalOpen, mainView, setMainView, setUserManualOpen } = useUIStore();
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  const tabs = Array.from(activeConnections.entries());
  const isConnected = activeTabId ? activeConnections.get(activeTabId)?.status === "connected" : false;

  const handleDisconnect = async (connectionId: string) => {
    try {
      await disconnectAndCleanup(connectionId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex h-11 items-center border-b border-border bg-gradient-to-r from-muted/40 via-background/80 to-background px-2 relative">
      {/* Subtle bottom glow line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 mr-2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{sidebarOpen ? "Hide sidebar" : "Show sidebar"}</TooltipContent>
      </Tooltip>

      {/* Explorer | Services segmented control */}
      {activeTabId && (
        <div
          className="flex items-center mr-3 border border-border/50 rounded-md overflow-hidden shrink-0 bg-muted/30 p-0.5"
          role="tablist"
          aria-label="Main view"
        >
          <button
            role="tab"
            aria-selected={mainView === "explorer"}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-sm transition-all duration-150",
              mainView === "explorer"
                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-accent/40"
            )}
            onClick={() => setMainView("explorer")}
          >
            <Folder className={cn("h-3 w-3", mainView === "explorer" && "text-violet-500")} />
            Explorer
          </button>
          <button
            role="tab"
            aria-selected={mainView === "services"}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-sm transition-all duration-150",
              mainView === "services"
                ? "bg-background text-foreground shadow-sm ring-1 ring-violet-500/30"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-accent/40"
            )}
            onClick={() => setMainView("services")}
          >
            <Activity className={cn("h-3 w-3", mainView === "services" && "text-violet-500")} />
            Services
          </button>
        </div>
      )}

      {/* Connection tabs */}
      <div className="flex flex-1 items-center gap-0.5 overflow-x-auto min-w-0">
        {tabs.length === 0 && (
          <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground/50 select-none">
            <ServerOff className="h-3 w-3" />
            <span>No active connections</span>
          </div>
        )}
        {tabs.map(([id, conn]) => (
          <div
            key={id}
            className={cn(
              "group relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-all duration-200 shrink-0",
              activeTabId === id
                ? "tab-underline-active bg-background/80 text-foreground shadow-sm ring-1 ring-border/50"
                : "text-muted-foreground hover:bg-background/40 hover:text-foreground"
            )}
            onClick={() => setActiveTab(id)}
          >
            <div
              className={cn(
                "h-2 w-2 rounded-full transition-all duration-300 shrink-0",
                conn.status === "connected"    && "bg-green-500 glow-green",
                conn.status === "connecting"   && "bg-yellow-500 animate-pulse glow-yellow",
                conn.status === "disconnected" && "bg-slate-500",
                conn.status === "error"        && "bg-red-500 glow-red"
              )}
            />
            <span className="max-w-32 truncate text-xs font-medium">{conn.connection.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity ml-0.5"
              onClick={(e) => {
                e.stopPropagation();
                handleDisconnect(id);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {/* Search pill — only when connected */}
        {onSearchOpen && isConnected && (
          <button
            onClick={onSearchOpen}
            className="hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border/50 bg-muted/20 hover:bg-accent/60 hover:border-border/80 transition-all duration-150 text-muted-foreground/55 hover:text-muted-foreground"
            title="Search files (⌘K)"
          >
            <Search className="h-3 w-3" />
            <span className="text-[11px]">Search…</span>
            <kbd className="text-[9px] font-mono bg-muted/50 px-1 py-0.5 rounded border border-border/40">⌘K</kbd>
          </button>
        )}

        {/* Terminal toggle — only when connected */}
        {isConnected && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 transition-all duration-200",
                  terminalOpen
                    ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={toggleTerminal}
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {terminalOpen ? "Close terminal (⌘Shift+K)" : "Open terminal (⌘Shift+K)"}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUserManualOpen(true)}
              className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-violet-500/25 bg-violet-500/[0.07] hover:bg-violet-500/15 hover:border-violet-500/40 text-[11px] font-medium text-violet-700 dark:text-violet-200/90 hover:text-violet-900 dark:hover:text-violet-100 transition-colors outline-none shrink-0"
              aria-label="Open GIA Core Manual"
            >
              <GiaMark size={14} className="opacity-95" />
              <span className="hidden sm:inline tracking-wide whitespace-nowrap">
                <span className="font-semibold text-foreground">GIA</span>
                <span className="ml-0.5 text-violet-600/80 dark:text-violet-300/80">Core</span>
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">GIA Core Manual</TooltipContent>
        </Tooltip>

        {/* Notification bell */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors relative"
              aria-label="Notifications"
            >
              {unreadCount > 0 ? <BellRing className="h-4 w-4 text-amber-400" /> : <Bell className="h-4 w-4" />}
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] flex items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white px-0.5 leading-none shadow-sm">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-80 p-0 max-h-[60vh] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-xs font-semibold">Notifications</span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-muted-foreground" onClick={markAllRead}>
                    Mark all read
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={clearAll} title="Clear all">
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60">
                  <Bell className="h-6 w-6 mb-2 opacity-40" />
                  <span className="text-xs">No notifications</span>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 hover:bg-accent/40 transition-colors flex items-start gap-2.5",
                      !n.read && "bg-accent/20"
                    )}
                    onClick={() => markRead(n.id)}
                  >
                    <div className={cn(
                      "h-5 w-5 rounded flex items-center justify-center shrink-0 mt-0.5",
                      n.type === "connection_drop" && "bg-red-500/10",
                      n.type === "gia_error" && "bg-amber-500/10",
                      n.type === "service_failure" && "bg-red-500/10",
                      n.type === "ssh_channel_saturation" && "bg-yellow-500/10",
                    )}>
                      <div className={cn(
                        "h-2 w-2 rounded-full",
                        n.type === "connection_drop" && "bg-red-500",
                        n.type === "gia_error" && "bg-amber-500",
                        n.type === "service_failure" && "bg-red-500",
                        n.type === "ssh_channel_saturation" && "bg-yellow-500",
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{n.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</div>
                      <div className="text-[9px] text-muted-foreground/50 mt-1 font-mono">
                        {new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    {!n.read && (
                      <div className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0 mt-1.5" />
                    )}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Theme toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {mounted ? (
                resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
              ) : (
                <span className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
