"use client";

import { AppShell } from "@/components/layout/app-shell";
import { FileExplorer } from "@/components/explorer/file-explorer";
import { CodeEditor } from "@/components/editor/code-editor";
import { SearchDialog } from "@/components/search/search-dialog";
import { useConnectionStore } from "@/stores/connection-store";
import { useUIStore } from "@/stores/ui-store";
import { useEditorStore } from "@/stores/editor-store";
import { useState, useEffect, useCallback, useRef } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "explorer-editor-split-ratio";
const COLLAPSE_THRESHOLD = 0.08;
const DEFAULT_RATIO = 0.5;

function loadRatio(): number {
  if (typeof window === "undefined") return DEFAULT_RATIO;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const n = parseFloat(saved);
      if (n >= 0 && n <= 1 && !isNaN(n)) return n;
    }
  } catch {}
  return DEFAULT_RATIO;
}

function saveRatio(r: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(r));
  } catch {}
}

export default function HomePage() {
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const { toggleTerminal, terminalOpen, mainView, setMainView } = useUIStore();
  const editorTabs = useEditorStore((s) => s.tabs);
  const [searchOpen, setSearchOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(loadRatio);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = activeTabId ? activeConnections.get(activeTabId) : null;
  const isConnected = active?.status === "connected";
  const hasEditorTabs = editorTabs.length > 0;

  // When editor tabs change, reset ratio if there were none
  const hadEditorTabs = useRef(hasEditorTabs);
  useEffect(() => {
    if (!hadEditorTabs.current && hasEditorTabs) {
      setSplitRatio(loadRatio());
    }
    hadEditorTabs.current = hasEditorTabs;
  }, [hasEditorTabs]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let ratio = x / rect.width;
      ratio = Math.max(COLLAPSE_THRESHOLD, Math.min(1 - COLLAPSE_THRESHOLD, ratio));
      setSplitRatio(ratio);
      saveRatio(ratio);
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleTerminal();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setMainView(mainView === "services" ? "explorer" : "services");
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setMainView("explorer");
      }
    };
    const onSearchEvent = () => setSearchOpen(true);
    const onUploadEvent = () => {
      document.querySelector<HTMLInputElement>("[data-trigger-upload]")?.click();
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("open-global-search", onSearchEvent);
    window.addEventListener("trigger-upload", onUploadEvent);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("open-global-search", onSearchEvent);
      window.removeEventListener("trigger-upload", onUploadEvent);
    };
  }, [toggleTerminal, mainView, setMainView]);

  const showSplit = hasEditorTabs;
  const explorerFlex = showSplit ? splitRatio : 1;
  const editorFlex = showSplit ? 1 - splitRatio : 0;
  const editorCollapsed = showSplit && editorFlex < COLLAPSE_THRESHOLD + 0.02;

  return (
    <AppShell onSearchOpen={() => setSearchOpen(true)}>
      <div className="flex h-full flex-col">
        <div ref={containerRef} className="flex flex-1 overflow-hidden">
          <div
            className={cn("overflow-hidden", dragging && "select-none")}
            style={{ flex: `${explorerFlex} 1 0px` }}
          >
            <FileExplorer />
          </div>

          {showSplit && !editorCollapsed && (
            <>
              <div
                className={cn(
                  "relative w-[5px] cursor-col-resize shrink-0 bg-transparent hover:bg-border/60 active:bg-border transition-colors duration-150 group",
                  dragging && "bg-border"
                )}
                onMouseDown={handleMouseDown}
              >
                <GripVertical className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors duration-150" />
              </div>
              <div
                className="overflow-hidden"
                style={{ flex: `${editorFlex} 1 0px` }}
              >
                <CodeEditor />
              </div>
            </>
          )}

          {showSplit && editorCollapsed && (
            <button
              onClick={() => {
                const r = loadRatio();
                setSplitRatio(r > 0.9 ? DEFAULT_RATIO : r);
                saveRatio(r > 0.9 ? DEFAULT_RATIO : r);
              }}
              className="w-6 shrink-0 flex items-center justify-center border-l border-border hover:bg-accent/50 transition-colors text-muted-foreground/40 hover:text-muted-foreground group"
              title="Show editor"
            >
              <GripVertical className="h-5 w-3" />
            </button>
          )}
        </div>

        <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
    </AppShell>
  );
}
