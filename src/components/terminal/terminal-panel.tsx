"use client";

import { useCallback, useRef, useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useTerminalStore, TERMINAL_THEMES } from "@/stores/terminal-store";
import { Button } from "@/components/ui/button";
import { Plus, X, ChevronDown, ChevronUp, GripHorizontal, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { TerminalInstance } from "./terminal-instance";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const MIN_TERMINAL_HEIGHT = 100;
const MAX_TERMINAL_HEIGHT = 800;

export function TerminalPanel() {
  const { terminalOpen, toggleTerminal, terminalHeight, setTerminalHeight } = useUIStore();
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const { addSession, removeSession, setActiveSession, getSessions, getActiveSession } =
    useTerminalStore();
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const connectionId = activeTabId ?? "";
  const active = activeTabId ? activeConnections.get(activeTabId) : null;
  const isConnected = active?.status === "connected";

  const sessions = getSessions(connectionId);
  const activeSessionId = getActiveSession(connectionId);

  // Auto-spawn a session if terminal is open, connected, and has no sessions
  useEffect(() => {
    if (terminalOpen && isConnected && sessions.length === 0) {
      addSession(connectionId);
    }
  }, [terminalOpen, isConnected, sessions.length, connectionId, addSession]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: terminalHeight };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const newHeight = Math.max(
        MIN_TERMINAL_HEIGHT,
        Math.min(MAX_TERMINAL_HEIGHT, dragRef.current.startHeight + delta)
      );
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [terminalHeight, setTerminalHeight]);

  const handleNewSession = () => {
    addSession(connectionId);
  };

  const panelVisible = terminalOpen && isConnected;

  return (
    <div
      className="border-t border-border bg-background flex flex-col relative overflow-hidden transition-all duration-200 ease-out"
      style={{ maxHeight: panelVisible ? terminalHeight : 0 }}
    >
      <div className="flex flex-col" style={{ height: terminalHeight, minHeight: terminalHeight }}>
        {/* Drag handle */}
        <div
          className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center z-10 hover:bg-primary/20 transition-colors"
          onMouseDown={handleMouseDown}
        >
          <GripHorizontal className="h-3 w-3 text-muted-foreground opacity-50" />
        </div>
        {/* Terminal tab bar */}
        <div className="flex items-center border-b border-border bg-muted/30 px-2 py-0.5">
          <span className="text-xs font-medium text-muted-foreground mr-2">Terminal</span>
          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer",
                  activeSessionId === session.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/50"
                )}
                onClick={() => setActiveSession(connectionId, session.id)}
              >
                <span>{session.id}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(connectionId, session.id);
                    if (sessions.length <= 1) {
                      toggleTerminal();
                    }
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Terminal Theme">
                <Palette className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuLabel className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Terminal Theme</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.entries(TERMINAL_THEMES).map(([k, val]) => (
                <DropdownMenuItem
                  key={k}
                  className={cn(
                    "text-xs cursor-pointer flex items-center justify-between",
                    useTerminalStore.getState().theme === k && "bg-accent font-medium text-foreground"
                  )}
                  onClick={() => useTerminalStore.getState().setTheme(k)}
                >
                  {val.label}
                  {useTerminalStore.getState().theme === k && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewSession}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleTerminal}>
            {terminalOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Terminal content */}
        <div className="flex-1 overflow-hidden">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn("h-full", activeSessionId === session.id ? "block" : "hidden")}
            >
              <TerminalInstance connectionId={connectionId} sessionId={session.id} />
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              <Button variant="outline" size="sm" onClick={handleNewSession}>
                <Plus className="h-4 w-4 mr-1" />
                New Terminal
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
