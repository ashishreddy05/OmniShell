"use client";

import { useCallback, useRef, useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useAIStore } from "@/stores/ai-store";
import { Sidebar } from "./sidebar";
import { ConnectionTabs } from "./connection-tabs";
import { StatusBar } from "./status-bar";
import dynamic from "next/dynamic";
import { AIContextBridge } from "@/components/ai/context-bridge";
import { NotificationBridge } from "./notification-bridge";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

const ServicesPage = dynamic(() => import("@/components/services/services-page").then(m => ({ default: m.ServicesPage })), { ssr: false });
const AIPanel = dynamic(() => import("@/components/ai/ai-panel").then(m => ({ default: m.AIPanel })), { ssr: false });

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

export function AppShell({ children, onSearchOpen }: { children: React.ReactNode; onSearchOpen?: () => void }) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const mainView = useUIStore((s) => s.mainView);
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setSidebarWidth]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AIContextBridge />
      <NotificationBridge />
      <ConnectionTabs onSearchOpen={onSearchOpen} />
      <div className="flex flex-1 overflow-hidden">
        <div
          className="h-full overflow-hidden shrink-0 transition-[width] duration-200 ease-out"
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        >
          <div className="h-full overflow-hidden" style={{ width: sidebarWidth }}>
            <Sidebar />
          </div>
        </div>
        {sidebarOpen && (
          <div
            className="group relative w-px cursor-col-resize shrink-0 transition-all duration-150 hover:w-1.5"
            onMouseDown={handleMouseDown}
          >
            <div className="absolute inset-0 bg-border group-hover:bg-gradient-to-b group-hover:from-violet-500/40 group-hover:via-primary/30 group-hover:to-violet-500/40 transition-all duration-200 rounded-full" />
          </div>
        )}
        <main className="flex-1 overflow-hidden min-w-0">
          <div key={mainView} className="h-full animate-reveal-up">
            {mainView === "services" ? <ServicesPage /> : children}
          </div>
        </main>
      </div>
      <TerminalPanel />
      <StatusBar />
      <AIPanel />
      <AIFloatingButton />
    </div>
  );
}

function AIFloatingButton() {
  const open = useAIStore((s) => s.open);
  const toggle = useAIStore((s) => s.toggle);
  const terminalOpen = useUIStore((s) => s.terminalOpen);
  const terminalHeight = useUIStore((s) => s.terminalHeight);
  if (open) return null;
  // Status bar ≈ 24px; lift above terminal when open so FAB isn't buried.
  const bottom = 40 + (terminalOpen ? terminalHeight : 0);
  return (
    <div
      className="fixed right-5 z-40 flex flex-col items-center gap-1.5 animate-in fade-in zoom-in duration-300 motion-safe:transition-[bottom] motion-safe:duration-200"
      style={{ bottom }}
    >
      <Button
        onClick={toggle}
        size="icon"
        className="h-12 w-12 rounded-full shadow-xl bg-gradient-to-br from-violet-500 to-violet-700 hover:from-violet-400 hover:to-violet-600 text-white border border-violet-400/30 glow-violet transition-all duration-300 hover:scale-105"
        title="Open GIA (⌘J)"
      >
        <Sparkles className="h-5 w-5" />
      </Button>
      <span className="text-[10px] font-medium text-muted-foreground/60 tracking-wider select-none">GIA</span>
    </div>
  );
}
