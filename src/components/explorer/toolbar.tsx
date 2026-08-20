"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutGrid, List, ArrowUpDown, RefreshCw, Bookmark, Eye, EyeOff,
  FolderPlus, FilePlus, ArrowDownAZ, ArrowUpAZ, Upload, FolderUp,
} from "lucide-react";
import type { ViewMode, SortBy, SortDir } from "@/stores/explorer-store";
import { useState } from "react";
import { NewItemDialog } from "./new-item-dialog";

interface ToolbarProps {
  viewMode: ViewMode;
  sortBy: SortBy;
  sortDir: SortDir;
  showHidden: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onSortChange: (by: SortBy) => void;
  onToggleHidden: () => void;
  onRefresh: () => void;
  onBookmark: () => void;
  onUpload: () => void;
  onUploadFolder: () => void;
}

export function Toolbar({
  viewMode, sortBy, sortDir, showHidden,
  onViewModeChange, onSortChange, onToggleHidden, onRefresh, onBookmark, onUpload, onUploadFolder,
}: ToolbarProps) {
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null);

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border px-3 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setNewItemType("file")}
          title="New file"
        >
          <FilePlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setNewItemType("folder")}
          title="New folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onUpload}
          title="Upload files"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onUploadFolder}
          title="Upload folder"
        >
          <FolderUp className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleHidden}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
        >
          {showHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Sort">
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["name", "size", "modified", "type"] as SortBy[]).map((by) => (
              <DropdownMenuItem key={by} onClick={() => onSortChange(by)}>
                {sortBy === by ? (
                  sortDir === "asc" ? <ArrowDownAZ className="h-4 w-4 mr-2" /> : <ArrowUpAZ className="h-4 w-4 mr-2" />
                ) : <div className="w-4 mr-2" />}
                {by.charAt(0).toUpperCase() + by.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onViewModeChange(viewMode === "grid" ? "list" : "grid")}
          title={viewMode === "grid" ? "List view" : "Grid view"}
        >
          {viewMode === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBookmark} title="Bookmark this folder">
          <Bookmark className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {newItemType && (
        <NewItemDialog type={newItemType} onClose={() => setNewItemType(null)} />
      )}
    </>
  );
}
