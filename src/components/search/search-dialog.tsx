"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSearchPresetsStore } from "@/stores/search-presets-store";
import { fsApi } from "@/lib/api-client";
import {
  Search, FileText, Loader2, CornerDownLeft, X,
  WifiOff, FolderOpen, Globe, Folder, Plus, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  path: string;
  name: string;
  dir: string;
  type: "file" | "directory";
}

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searched, setSearched] = useState(false);
  const [scope, setScope] = useState<"current" | "root" | string>("current");
  // Inline preset editor state
  const [addingPreset, setAddingPreset] = useState(false);
  const [presetInput, setPresetInput] = useState("");

  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const { navigate, getExplorer } = useExplorerStore();
  const { getPresets, add: addPreset, remove: removePreset } = useSearchPresetsStore();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const connectionId = activeTabId ?? "";
  const activeConn = activeTabId ? activeConnections.get(activeTabId) : null;
  const isConnected = activeConn?.status === "connected";
  const currentPath = connectionId ? getExplorer(connectionId).currentPath : "/";
  const presets = connectionId ? getPresets(connectionId) : [];

  const searchBase =
    scope === "current" ? currentPath
    : scope === "root" ? "/"
    : scope; // preset path

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setSearched(false);
      setActiveIndex(0);
      setScope("current");
      setAddingPreset(false);
      setPresetInput("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Focus preset input when shown
  useEffect(() => {
    if (addingPreset) {
      setTimeout(() => presetInputRef.current?.focus(), 30);
    }
  }, [addingPreset]);

  const doSearch = useCallback(async (q: string, base: string) => {
    if (!q.trim() || !connectionId || !isConnected) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(false);
    try {
      const { results: raw } = await fsApi.search(connectionId, q.trim(), base, "name");
      const parsed: SearchResult[] = raw.map(({ path: p, type }) => {
        const parts = p.split("/");
        const name = parts[parts.length - 1] ?? p;
        parts.pop();
        const dir = parts.join("/") || "/";
        return { path: p, name, dir, type };
      });
      setResults(parsed);
      setActiveIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [connectionId, isConnected]);

  // Debounced search — re-fires on query OR scope change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(query, searchBase), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, scope, searchBase, doSearch]);

  const navigateTo = useCallback((result: SearchResult) => {
    // For directories, navigate into them; for files, navigate to their parent
    const target = result.type === "directory" ? result.path : result.dir;
    navigate(connectionId, target);
    onClose();
  }, [connectionId, navigate, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[activeIndex]) navigateTo(results[activeIndex]);
    else if (e.key === "Escape") onClose();
  };

  const handleSavePreset = () => {
    const trimmed = presetInput.trim().replace(/\/+$/, "") || "/";
    if (trimmed && connectionId) {
      addPreset(connectionId, trimmed);
      setScope(trimmed); // switch to new preset immediately
    }
    setAddingPreset(false);
    setPresetInput("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const handlePresetKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSavePreset();
    else if (e.key === "Escape") { setAddingPreset(false); setPresetInput(""); }
  };

  // Scroll active result into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function highlight(text: string, q: string) {
    if (!q.trim()) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q.toLowerCase().trim());
    if (idx === -1) return <span>{text}</span>;
    return (
      <>
        <span>{text.slice(0, idx)}</span>
        <span className="text-violet-400 font-semibold bg-violet-500/10 rounded-sm px-0.5">
          {text.slice(idx, idx + q.trim().length)}
        </span>
        <span>{text.slice(idx + q.trim().length)}</span>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden max-w-xl border-border/60 shadow-2xl bg-card"
        style={{ borderRadius: "0.75rem" }}
      >
        {/* Visually hidden title for screen readers */}
        <DialogTitle className="sr-only">Search Files</DialogTitle>
        <DialogDescription className="sr-only">Search for files and folders on the connected server.</DialogDescription>
        {/* ── No connection ─────────────────────────────────── */}
        {!isConnected ? (
          <div className="flex flex-col items-center justify-center py-14 px-6 gap-4 text-center">
            <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <WifiOff className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No active connection</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Connect to a server from the sidebar first,<br />then search its files here.
              </p>
            </div>
            <button onClick={onClose} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors underline underline-offset-4">
              Dismiss
            </button>
          </div>
        ) : (
          <>
            {/* ── Search input ──────────────────────────────── */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-gradient-to-r from-muted/20 to-transparent">
              {loading
                ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
                : <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              }
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search files and folders…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/45 text-foreground"
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setResults([]); setSearched(false); }}
                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* ── Scope bar ─────────────────────────────────── */}
            <div className="px-3 py-1.5 border-b border-border/40 bg-muted/5">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-muted-foreground/40 uppercase tracking-widest shrink-0 mr-0.5">in:</span>

                {/* Current folder */}
                <ScopeButton
                  active={scope === "current"}
                  color="violet"
                  onClick={() => setScope("current")}
                  title={`Current: ${currentPath}`}
                >
                  <FolderOpen className="h-3 w-3 shrink-0" />
                  Here
                </ScopeButton>

                {/* Per-connection saved presets */}
                {presets.map((p) => (
                  <div key={p} className="flex items-center group/preset">
                    <ScopeButton
                      active={scope === p}
                      color="emerald"
                      onClick={() => setScope(p)}
                      title={p}
                    >
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="font-mono truncate max-w-[100px]">{p.split("/").pop()}</span>
                    </ScopeButton>
                    {/* Remove preset button */}
                    <button
                      onClick={() => {
                        removePreset(connectionId, p);
                        if (scope === p) setScope("current");
                      }}
                      className="ml-0.5 h-3.5 w-3.5 rounded-full opacity-0 group-hover/preset:opacity-60 hover:!opacity-100 hover:bg-red-500/20 hover:text-red-400 flex items-center justify-center text-muted-foreground transition-all"
                      title={`Remove "${p}"`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}

                {/* Entire server */}
                <ScopeButton
                  active={scope === "root"}
                  color="violet"
                  onClick={() => setScope("root")}
                >
                  <Globe className="h-3 w-3 shrink-0" />
                  All
                </ScopeButton>

                {/* Add preset — inline */}
                {addingPreset ? (
                  <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                    <input
                      ref={presetInputRef}
                      value={presetInput}
                      onChange={(e) => setPresetInput(e.target.value)}
                      onKeyDown={handlePresetKeyDown}
                      placeholder="/opt/agents"
                      className="bg-transparent text-[11px] font-mono outline-none text-emerald-400 placeholder:text-emerald-600/50 w-28"
                    />
                    <button onClick={handleSavePreset} className="text-emerald-400 hover:text-emerald-300 transition-colors" title="Save">
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={() => { setAddingPreset(false); setPresetInput(""); }} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Cancel">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingPreset(true)}
                    className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-all"
                    title="Save a path as a quick preset for this connection"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}

                {/* Active path preview — far right */}
                <span
                  className="ml-auto text-[10px] font-mono text-muted-foreground/25 truncate max-w-[150px]"
                  title={searchBase}
                >
                  {searchBase}
                </span>
              </div>
            </div>

            {/* ── Results ───────────────────────────────────── */}
            <div ref={listRef} className="overflow-y-auto max-h-[340px] py-1">

              {!query.trim() && (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <Search className="h-8 w-8 text-muted-foreground/15" />
                  <p className="text-sm text-muted-foreground/50">Search files and folders</p>
                  <p className="text-[11px] text-muted-foreground/30">
                    {scope === "root" ? "Entire server" : scope === "current" ? currentPath : scope}
                    {" · min 2 characters"}
                  </p>
                </div>
              )}

              {query.trim().length === 1 && (
                <div className="flex items-center justify-center py-10">
                  <p className="text-sm text-muted-foreground/40">Type at least 2 characters…</p>
                </div>
              )}

              {loading && query.trim().length >= 2 && (
                <div className="space-y-px px-2 py-1">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-md" style={{ opacity: 1 - i * 0.18 }}>
                      <div className="h-7 w-7 rounded-md bg-muted/50 animate-pulse shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-36 rounded bg-muted/60 animate-pulse" />
                        <div className="h-2.5 w-52 rounded bg-muted/40 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && searched && results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Search className="h-8 w-8 text-muted-foreground/15" />
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground/50">
                      Nothing named &ldquo;<span className="font-medium text-muted-foreground/70">{query}</span>&rdquo;
                    </p>
                    {scope !== "root" && (
                      <button
                        onClick={() => setScope("root")}
                        className="text-[11px] text-violet-400/70 hover:text-violet-400 mt-1.5 transition-colors underline underline-offset-2"
                      >
                        Try the entire server
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!loading && results.length > 0 && (
                <>
                  <div className="px-4 pt-2 pb-1 flex items-center gap-2">
                    <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">
                      {results.length} result{results.length !== 1 ? "s" : ""}
                    </span>
                    {results.length === 100 && (
                      <span className="text-[10px] text-amber-500/60">· showing first 100</span>
                    )}
                  </div>
                  <div className="px-2 pb-2 space-y-px">
                    {results.map((result, i) => {
                      const isDir = result.type === "directory";
                      return (
                        <button
                          key={result.path}
                          data-index={i}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all duration-100 group",
                            i === activeIndex
                              ? isDir
                                ? "bg-blue-500/10 ring-1 ring-blue-500/20"
                                : "bg-violet-500/10 ring-1 ring-violet-500/20"
                              : "hover:bg-accent/50"
                          )}
                          onClick={() => navigateTo(result)}
                          onMouseEnter={() => setActiveIndex(i)}
                        >
                          <div className={cn(
                            "h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors",
                            i === activeIndex
                              ? isDir
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-violet-500/15 text-violet-400"
                              : "bg-muted/40 text-muted-foreground"
                          )}>
                            {isDir
                              ? <Folder className="h-3.5 w-3.5" />
                              : <FileText className="h-3.5 w-3.5" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium truncate text-foreground leading-tight">
                                {highlight(result.name, query)}
                              </span>
                              {isDir && (
                                <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-blue-500/10 text-blue-400/80 shrink-0">DIR</span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground/50 truncate mt-0.5 font-mono">
                              {result.dir}
                            </div>
                          </div>
                          <div className={cn(
                            "shrink-0 transition-opacity",
                            i === activeIndex ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                          )}>
                            <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ── Footer ───────────────────────────────────── */}
            <div className="border-t border-border/40 px-4 py-2 flex items-center gap-2.5 bg-muted/5">
              <kbd className="text-[10px] font-mono text-muted-foreground/40 bg-muted/40 px-1.5 py-0.5 rounded">↑↓</kbd>
              <span className="text-[10px] text-muted-foreground/30">navigate</span>
              <kbd className="text-[10px] font-mono text-muted-foreground/40 bg-muted/40 px-1.5 py-0.5 rounded">↵</kbd>
              <span className="text-[10px] text-muted-foreground/30">open</span>
              <kbd className="text-[10px] font-mono text-muted-foreground/40 bg-muted/40 px-1.5 py-0.5 rounded">Esc</kbd>
              <span className="text-[10px] text-muted-foreground/30">close</span>
              <div className="flex-1" />
              <span className="text-[10px] text-muted-foreground/25 font-mono">⌘K</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Scope pill button ──────────────────────────────────────────────────────
function ScopeButton({
  active, color, onClick, title, children,
}: {
  active: boolean;
  color: "violet" | "emerald";
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-all duration-150",
        active
          ? color === "violet"
            ? "bg-violet-500/15 text-violet-400 font-medium ring-1 ring-violet-500/20"
            : "bg-emerald-500/15 text-emerald-400 font-medium ring-1 ring-emerald-500/20"
          : "text-muted-foreground/55 hover:text-muted-foreground hover:bg-muted/50"
      )}
    >
      {children}
    </button>
  );
}
