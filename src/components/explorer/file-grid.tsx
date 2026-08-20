"use client";

import { useExplorerStore } from "@/stores/explorer-store";
import { useEditorStore } from "@/stores/editor-store";
import { useConnectionStore } from "@/stores/connection-store";
import { fsApi, connectionsApi } from "@/lib/api-client";
import { getFileIcon, getFileIconColor } from "@/lib/file-icons";
import { getLanguageFromExtension, getFileCategory } from "@/lib/constants";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Edit3, Trash2, Copy, Scissors, Clipboard, Download,
  FolderOpen, FileText, FilePlus, FolderPlus, Upload,
  ArrowDownAZ, ArrowUpAZ, Lock, RefreshCw, Eye, EyeOff,
} from "lucide-react";
import { RenameDialog } from "./rename-dialog";
import { NewItemDialog } from "./new-item-dialog";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import type { SortBy, SortDir } from "@/stores/explorer-store";
import * as pathUtils from "path";
import { DeleteDialog } from "./delete-dialog";
import { PasteDialog } from "./paste-dialog";
import { ChmodDialog } from "@/components/dialogs/chmod-dialog";
import type { FileEntry } from "../../../server/ssh/sftp-operations";
import type { ViewMode } from "@/stores/explorer-store";

interface FileGridProps {
  connectionId: string;
  entries: FileEntry[];
  viewMode: ViewMode;
  selectedItems: Set<string>;
  onRefresh: () => void;
}

export function FileGrid({ connectionId, entries, viewMode, selectedItems, onRefresh }: FileGridProps) {
  const { navigate, selectItem, setClipboard, getExplorer, setSort, clearSelection } = useExplorerStore();
  const { openFile } = useEditorStore();
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState<FileEntry | null>(null);
  const [chmodTarget, setChmodTarget] = useState<FileEntry[] | null>(null);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null);

  // Listen for global events from the command palette
  useEffect(() => {
    const onNewFile = () => setNewItemType("file");
    const onNewFolder = () => setNewItemType("folder");
    window.addEventListener("trigger-new-file", onNewFile);
    window.addEventListener("trigger-new-folder", onNewFolder);
    return () => {
      window.removeEventListener("trigger-new-file", onNewFile);
      window.removeEventListener("trigger-new-folder", onNewFolder);
    };
  }, []);

  const explorer = getExplorer(connectionId);

  const handleDoubleClick = async (entry: FileEntry) => {
    const connStore = useConnectionStore.getState();
    const active = connStore.activeConnections.get(connectionId);
    if (!active || active.status !== "connected") {
      const connList = await connectionsApi.list();
      const connection = connList.find((c) => c.id === connectionId);
      if (!connection) {
        toast.error("Connection not found. Please reconnect.");
        return;
      }
      connStore.setConnectionStatus(connectionId, connection, "connecting");
      try {
        await connectionsApi.connect(connectionId);
        connStore.setConnectionStatus(connectionId, connection, "connected");
        connStore.setActiveTab(connectionId);
      } catch (err) {
        connStore.setConnectionStatus(connectionId, connection, "error", (err as Error).message);
        toast.error(`Failed to connect: ${(err as Error).message}`);
        return;
      }
    }

    if (entry.type === "directory") {
      navigate(connectionId, entry.path);
    } else {
      const category = getFileCategory(entry.name);
      if (category === "image" || category === "video" || category === "audio" || category === "pdf") {
        setPreviewEntry(entry);
      } else {
        try {
          const { content } = await fsApi.read(connectionId, entry.path);
          const language = getLanguageFromExtension(entry.name);
          openFile(connectionId, entry.path, content, language);
        } catch (err) {
          toast.error((err as Error).message);
        }
      }
    }
  };

  const handleClick = (entry: FileEntry, e: React.MouseEvent, index: number) => {
    selectItem(connectionId, entry.path, e.metaKey || e.ctrlKey);
    setFocusedIndex(index);
  };

  const handleCopy = (entries: FileEntry[]) => {
    setClipboard(connectionId, entries, "copy");
    toast.success(`${entries.length} item(s) copied`);
  };

  const handleCut = (entries: FileEntry[]) => {
    setClipboard(connectionId, entries, "cut");
    toast.success(`${entries.length} item(s) cut`);
  };



  const handlePasteHere = async () => {
    if (!explorer.clipboard) return;
    try {
      for (const entry of explorer.clipboard.entries) {
        const destPath = `${explorer.currentPath}/${entry.name}`;
        if (explorer.clipboard.operation === "copy") {
          await fsApi.copy(connectionId, entry.path, destPath);
        } else {
          await fsApi.rename(connectionId, entry.path, destPath);
        }
      }
      onRefresh();
      toast.success("Paste complete");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDownload = (entry: FileEntry) => {
    const url = fsApi.getDownloadUrl(connectionId, entry.path);
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.name;
    a.click();
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const parentRef = useRef<HTMLDivElement>(null);

  // Grid view: compute columns from container width
  const GRID_ITEM_MIN_WIDTH = 120;
  const GRID_ITEM_HEIGHT = 100;
  const GRID_GAP = 8;
  const GRID_PADDING = 12;
  const LIST_ROW_HEIGHT = 36;

  const [containerWidth, setContainerWidth] = useState(0);
  const gridColumns = Math.max(1, Math.floor((containerWidth - GRID_PADDING * 2 + GRID_GAP) / (GRID_ITEM_MIN_WIDTH + GRID_GAP)));
  const gridRowCount = Math.ceil(entries.length / gridColumns);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    // Assign to parentRef for virtualizer
    (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    const ro = new ResizeObserver((resizeEntries) => {
      for (const re of resizeEntries) {
        setContainerWidth(re.contentRect.width);
      }
    });
    ro.observe(node);
    setContainerWidth(node.getBoundingClientRect().width);
    // cleanup not strictly needed since component unmounts, but ResizeObserver is lightweight
  }, []);

  const listVirtualizer = useVirtualizer({
    count: viewMode === "list" ? entries.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 15,
  });

  const gridVirtualizer = useVirtualizer({
    count: viewMode === "grid" ? gridRowCount : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => GRID_ITEM_HEIGHT + GRID_GAP,
    overscan: 5,
  });

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setFocusedIndex(-1);
    setRenamingPath(null);
  }, [entries]);

  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingPath]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 1, entries.length - 1);
          if (viewMode === "list") {
            listVirtualizer.scrollToIndex(next, { align: "auto" });
          } else {
            const row = Math.floor(next / gridColumns);
            gridVirtualizer.scrollToIndex(row, { align: "auto" });
          }
          return next;
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          if (viewMode === "list") {
            listVirtualizer.scrollToIndex(next, { align: "auto" });
          } else {
            const row = Math.floor(next / gridColumns);
            gridVirtualizer.scrollToIndex(row, { align: "auto" });
          }
          return next;
        });
        break;
      case "Enter":
        if (focusedIndex >= 0 && focusedIndex < entries.length) {
          handleDoubleClick(entries[focusedIndex]);
        }
        break;
      case "Escape":
        if (renamingPath) {
          setRenamingPath(null);
        } else {
          clearSelection(connectionId);
          setFocusedIndex(-1);
        }
        break;
      case "F2":
        if (focusedIndex >= 0 && focusedIndex < entries.length) {
          const entry = entries[focusedIndex];
          startRename(entry);
        }
        break;
    }
  };

  const startRename = (entry: FileEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  };

  const handleCommitRename = async (entry: FileEntry) => {
    if (!renameValue.trim() || renameValue === entry.name) {
      setRenamingPath(null);
      return;
    }
    try {
      const dir = pathUtils.posix.dirname(entry.path);
      const newPath = pathUtils.posix.join(dir, renameValue.trim());
      await fsApi.rename(connectionId, entry.path, newPath);
      queryClient.invalidateQueries({ queryKey: ["fs", "list", connectionId] });
      toast.success("Renamed");
    } catch (err) {
      toast.error((err as Error).message);
    }
    setRenamingPath(null);
  };

  if (entries.length === 0) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground p-8 animate-fade-in">
          <FolderOpen className="h-12 w-12 opacity-20" strokeWidth={1} />
          <div className="text-center space-y-1">
            <p className="text-sm text-foreground/80">This folder is empty</p>
            <p className="text-[11px] text-muted-foreground/70">Create something or drop files here</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setNewItemType("file")}
            >
              <FilePlus className="h-3.5 w-3.5" />
              New file
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setNewItemType("folder")}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => window.dispatchEvent(new CustomEvent("trigger-upload"))}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </Button>
          </div>
        </div>
        {newItemType && (
          <NewItemDialog
            type={newItemType}
            onClose={() => { setNewItemType(null); onRefresh(); }}
          />
        )}
      </>
    );
  }

  if (viewMode === "grid") {
    const virtualRows = gridVirtualizer.getVirtualItems();

    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div ref={measureRef} className="h-full overflow-auto" tabIndex={0} onKeyDown={handleKeyDown}>
              <div
                className="relative"
                style={{
                  height: gridVirtualizer.getTotalSize(),
                  padding: GRID_PADDING,
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const startIndex = virtualRow.index * gridColumns;
                  const rowEntries = entries.slice(startIndex, startIndex + gridColumns);

                  return (
                    <div
                      key={virtualRow.key}
                      className="absolute left-0 right-0 flex"
                      style={{
                        top: virtualRow.start,
                        height: virtualRow.size,
                        padding: `0 ${GRID_PADDING}px`,
                        gap: GRID_GAP,
                      }}
                    >
                      {rowEntries.map((entry, rowIdx) => {
                        const entryIndex = startIndex + rowIdx;
                        const Icon = getFileIcon(entry.name, entry.type === "directory");
                        const iconColor = getFileIconColor(entry.name, entry.type === "directory");
                        const isSelected = selectedItems.has(entry.path);
                        const isFocused = focusedIndex === entryIndex;

                        return (
                          <ContextMenu key={entry.path}>
                            <ContextMenuTrigger asChild>
                              <div
                                className={cn(
                                  "flex flex-col items-center gap-1 rounded-lg p-3 cursor-pointer transition-all duration-150 text-center animate-stagger",
                                  isSelected ? "bg-accent" : "hover:bg-accent/50 hover:shadow-sm",
                                  isFocused && !isSelected && "ring-1 ring-primary/30"
                                )}
                                style={{ width: GRID_ITEM_MIN_WIDTH, minWidth: GRID_ITEM_MIN_WIDTH, animationDelay: `${entryIndex * 15}ms` }}
                                onClick={(e) => handleClick(entry, e, entryIndex)}
                                onDoubleClick={() => handleDoubleClick(entry)}
                              >
                                <Icon className={cn("h-10 w-10", iconColor)} />
                                {renamingPath === entry.path && viewMode === "grid" ? (
                                  <Input
                                    ref={renameInputRef}
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === "Enter") handleCommitRename(entry);
                                      else if (e.key === "Escape") setRenamingPath(null);
                                    }}
                                    onBlur={() => handleCommitRename(entry)}
                                    className="h-5 text-xs px-1 py-0"
                                  />
                                ) : (
                                  <span className="text-xs truncate w-full">{entry.name}</span>
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <FileContextMenu
                              entry={entry}
                              onOpen={() => handleDoubleClick(entry)}
                              onRename={() => setRenaming(entry)}
                              onChmod={() => setChmodTarget([entry])}
                              onDelete={() => setDeleting(entry)}
                              onCopy={() => handleCopy([entry])}
                              onCut={() => handleCut([entry])}
                              onPaste={handlePasteHere}
                              onPasteTo={() => setShowPasteDialog(true)}
                              onDownload={() => handleDownload(entry)}
                              hasClipboard={!!explorer.clipboard}
                            />
                          </ContextMenu>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </ContextMenuTrigger>
          <BackgroundContextMenu
            onNewFile={() => setNewItemType("file")}
            onNewFolder={() => setNewItemType("folder")}
            onPaste={handlePasteHere}
            hasClipboard={!!explorer.clipboard}
          />
        </ContextMenu>
        {renaming && <RenameDialog entry={renaming} connectionId={connectionId} onClose={() => { setRenaming(null); onRefresh(); }} />}
        {deleting && <DeleteDialog entry={deleting} connectionId={connectionId} onClose={() => { setDeleting(null); onRefresh(); }} />}
        {chmodTarget && (
          <ChmodDialog
            paths={chmodTarget.map((e) => e.path)}
            connectionId={connectionId}
            open={!!chmodTarget}
            onClose={() => setChmodTarget(null)}
            onSuccess={onRefresh}
          />
        )}
        {previewEntry && (
          <PreviewOverlay entry={previewEntry} connectionId={connectionId} onClose={() => setPreviewEntry(null)} />
        )}
        {showPasteDialog && explorer.clipboard && (
          <PasteDialog
            connectionId={connectionId}
            clipboard={explorer.clipboard}
            currentPath={explorer.currentPath}
            onClose={() => { setShowPasteDialog(false); onRefresh(); }}
          />
        )}
      {newItemType && (
        <NewItemDialog
          type={newItemType}
          onClose={() => { setNewItemType(null); onRefresh(); }}
        />
      )}
    </>
  );
}

  // List view (virtualized)
  const virtualItems = listVirtualizer.getVirtualItems();

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex flex-col h-full" tabIndex={0} onKeyDown={handleKeyDown}>
            <div className="grid grid-cols-[1fr_100px_180px_100px] gap-2 px-3 py-1 text-xs font-medium text-muted-foreground border-b border-border shrink-0">
              <button className="flex items-center gap-1 text-left hover:text-foreground transition-colors duration-150" onClick={() => setSort(connectionId, "name")}>
                Name
                {explorer.sortBy === "name" && (
                  <span className="animate-rotate-in">{explorer.sortDir === "asc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}</span>
                )}
              </button>
              <button className="flex items-center justify-end gap-1 hover:text-foreground transition-colors duration-150" onClick={() => setSort(connectionId, "size")}>
                {explorer.sortBy === "size" && (
                  <span className="animate-rotate-in">{explorer.sortDir === "asc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}</span>
                )}
                Size
              </button>
              <button className="flex items-center gap-1 hover:text-foreground transition-colors duration-150" onClick={() => setSort(connectionId, "modified")}>
                Modified
                {explorer.sortBy === "modified" && (
                  <span className="animate-rotate-in">{explorer.sortDir === "asc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}</span>
                )}
              </button>
              <button className="flex items-center gap-1 hover:text-foreground transition-colors duration-150" onClick={() => setSort(connectionId, "type")}>
                Type
                {explorer.sortBy === "type" && (
                  <span className="animate-rotate-in">{explorer.sortDir === "asc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}</span>
                )}
              </button>
            </div>
            <div ref={viewMode === "list" ? measureRef : undefined} className="flex-1 overflow-auto">
              <div className="relative" style={{ height: listVirtualizer.getTotalSize() }}>
                {virtualItems.map((virtualRow) => {
                  const entry = entries[virtualRow.index];
                  const Icon = getFileIcon(entry.name, entry.type === "directory");
                  const iconColor = getFileIconColor(entry.name, entry.type === "directory");
                  const isSelected = selectedItems.has(entry.path);
                  const isFocused = focusedIndex === virtualRow.index;

                  return (
                    <ContextMenu key={virtualRow.key}>
                      <ContextMenuTrigger asChild>
                        <div
                          className={cn(
                            "absolute left-0 right-0 grid grid-cols-[1fr_100px_180px_100px] gap-2 items-center px-3 cursor-pointer transition-all duration-150 text-sm animate-stagger",
                            isSelected ? "bg-accent" : "hover:bg-accent/50 hover:shadow-sm",
                            isFocused && !isSelected && "ring-1 ring-inset ring-primary/30"
                          )}
                          style={{
                            top: virtualRow.start,
                            height: virtualRow.size,
                            animationDelay: `${virtualRow.index * 15}ms`,
                          }}
                          onClick={(e) => handleClick(entry, e, virtualRow.index)}
                          onDoubleClick={() => handleDoubleClick(entry)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />
                            {renamingPath === entry.path ? (
                              <Input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter") handleCommitRename(entry);
                                  else if (e.key === "Escape") setRenamingPath(null);
                                }}
                                onBlur={() => handleCommitRename(entry)}
                                className="h-5 text-xs px-1 py-0"
                              />
                            ) : (
                              <span className="truncate">{entry.name}</span>
                            )}
                          </div>
                          <span className="text-right text-muted-foreground">
                            {entry.type === "directory" ? "—" : formatSize(entry.size)}
                          </span>
                          <span className="text-muted-foreground text-xs">{formatDate(entry.modified)}</span>
                          <span className="text-muted-foreground font-mono text-xs">{entry.permissions}</span>
                        </div>
                      </ContextMenuTrigger>
                      <FileContextMenu
                        entry={entry}
                        onOpen={() => handleDoubleClick(entry)}
                        onRename={() => setRenaming(entry)}
                        onChmod={() => setChmodTarget([entry])}
                        onDelete={() => setDeleting(entry)}
                        onCopy={() => handleCopy([entry])}
                        onCut={() => handleCut([entry])}
                        onPaste={handlePasteHere}
                        onPasteTo={() => setShowPasteDialog(true)}
                        onDownload={() => handleDownload(entry)}
                        hasClipboard={!!explorer.clipboard}
                      />
                    </ContextMenu>
                  );
                })}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <BackgroundContextMenu
          onNewFile={() => setNewItemType("file")}
          onNewFolder={() => setNewItemType("folder")}
          onPaste={handlePasteHere}
          hasClipboard={!!explorer.clipboard}
        />
      </ContextMenu>
      {renaming && <RenameDialog entry={renaming} connectionId={connectionId} onClose={() => { setRenaming(null); onRefresh(); }} />}
      {deleting && <DeleteDialog entry={deleting} connectionId={connectionId} onClose={() => { setDeleting(null); onRefresh(); }} />}
      {chmodTarget && (
        <ChmodDialog
          paths={chmodTarget.map((e) => e.path)}
          connectionId={connectionId}
          open={!!chmodTarget}
          onClose={() => setChmodTarget(null)}
          onSuccess={onRefresh}
        />
      )}
      {previewEntry && (
        <PreviewOverlay entry={previewEntry} connectionId={connectionId} onClose={() => setPreviewEntry(null)} />
      )}
      {showPasteDialog && explorer.clipboard && (
        <PasteDialog
          connectionId={connectionId}
          clipboard={explorer.clipboard}
          currentPath={explorer.currentPath}
          onClose={() => { setShowPasteDialog(false); onRefresh(); }}
        />
      )}
      {newItemType && (
        <NewItemDialog
          type={newItemType}
          onClose={() => { setNewItemType(null); onRefresh(); }}
        />
      )}
    </>
  );
}

function FileContextMenu({
  entry, onOpen, onRename, onChmod, onDelete, onCopy, onCut, onPaste, onPasteTo, onDownload, hasClipboard,
}: {
  entry: FileEntry;
  onOpen: () => void;
  onRename: () => void;
  onChmod: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onPasteTo?: () => void;
  onDownload: () => void;
  hasClipboard: boolean;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onOpen}>
        {entry.type === "directory" ? (
          <><FolderOpen className="h-4 w-4 mr-2" />Open</>
        ) : (
          <><FileText className="h-4 w-4 mr-2" />Open</>
        )}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onCopy}>
        <Copy className="h-4 w-4 mr-2" />Copy
      </ContextMenuItem>
      <ContextMenuItem onClick={onCut}>
        <Scissors className="h-4 w-4 mr-2" />Cut
      </ContextMenuItem>
      {hasClipboard && (
        <>
          <ContextMenuItem onClick={onPaste}>
            <Clipboard className="h-4 w-4 mr-2" />Paste here
          </ContextMenuItem>
          {onPasteTo && (
            <ContextMenuItem onClick={onPasteTo}>
              <Clipboard className="h-4 w-4 mr-2" />Paste to...
            </ContextMenuItem>
          )}
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onRename}>
        <Edit3 className="h-4 w-4 mr-2" />Rename
      </ContextMenuItem>
      <ContextMenuItem onClick={onChmod}>
        <Lock className="h-4 w-4 mr-2" />Permissions
      </ContextMenuItem>
      {entry.type === "file" && (
        <ContextMenuItem onClick={onDownload}>
          <Download className="h-4 w-4 mr-2" />Download
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onDelete} className="text-destructive">
        <Trash2 className="h-4 w-4 mr-2" />Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function PreviewOverlay({ entry, connectionId, onClose }: { entry: FileEntry; connectionId: string; onClose: () => void }) {
  const category = getFileCategory(entry.name);
  const previewUrl = fsApi.getPreviewUrl(connectionId, entry.path);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center animate-in fade-in duration-200" onClick={onClose}>
      <div className="max-w-[90vw] max-h-[90vh] bg-background rounded-lg p-4 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">{entry.name}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="overflow-auto max-h-[80vh]">
          {category === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={entry.name} className="max-w-full max-h-[75vh] object-contain" />
          )}
          {(category === "video") && (
            <video src={previewUrl} controls className="max-w-full max-h-[75vh]" />
          )}
          {category === "audio" && (
            <audio src={previewUrl} controls className="w-full" />
          )}
          {category === "pdf" && (
            <iframe src={previewUrl} className="w-[80vw] h-[75vh]" />
          )}
          {(category === "unknown") && (
            <p className="text-muted-foreground p-4">Preview not available for this file type</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BackgroundContextMenu({ onNewFile, onNewFolder, onPaste, hasClipboard }: {
  onNewFile: () => void;
  onNewFolder: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onNewFile}>
        <FilePlus className="h-4 w-4 mr-2" />New File
      </ContextMenuItem>
      <ContextMenuItem onClick={onNewFolder}>
        <FolderPlus className="h-4 w-4 mr-2" />New Folder
      </ContextMenuItem>
      {hasClipboard && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onPaste}>
            <Clipboard className="h-4 w-4 mr-2" />Paste
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}
