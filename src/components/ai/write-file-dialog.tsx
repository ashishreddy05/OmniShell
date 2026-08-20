"use client";

import { useEffect, useState } from "react";
import { X, Check, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDiff } from "@/components/diff/file-diff";
import { fsApi } from "@/lib/api-client";
import { useEditorStore } from "@/stores/editor-store";
import { getOriginalContent, setOriginalContent } from "@/lib/editor-content";
import { toast } from "sonner";
import { getLanguageFromExtension } from "@/lib/constants";

interface WriteFileDialogProps {
  path: string;
  content: string;
  connectionId: string;
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export function WriteFileDialog({ path, content, connectionId, open, onClose, onApplied }: WriteFileDialogProps) {
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const openFile = useEditorStore((s) => s.openFile);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Try to get current content: first from open editor tab, then from server
    const tabs = useEditorStore.getState().tabs;
    const existingTab = tabs.find((t) => t.connectionId === connectionId && t.path === path);
    if (existingTab) {
      const cached = getOriginalContent(existingTab.id);
      setOldContent(cached ?? "");
      setLoading(false);
      return;
    }
    // Fetch from server (one SSH call)
    fsApi
      .read(connectionId, path)
      .then((res) => setOldContent(res.content))
      .catch(() => setOldContent(""))
      .finally(() => setLoading(false));
  }, [open, path, connectionId]);

  if (!open) return null;

  const handleApply = async () => {
    setApplying(true);
    try {
      await fsApi.write(connectionId, path, content);
      // Update any open tab with the new content
      const tabs = useEditorStore.getState().tabs;
      const tab = tabs.find((t) => t.connectionId === connectionId && t.path === path);
      if (tab) {
        setOriginalContent(tab.id, content);
        useEditorStore.setState((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id ? { ...t, isDirty: false } : t
          ),
        }));
      } else {
        // Open the file in the editor with the new content
        const language = getLanguageFromExtension(path);
        openFile(connectionId, path, content, language);
      }
      toast.success(`Wrote ${path.split("/").pop()}`);
      onApplied?.();
    } catch (err) {
      toast.error(`Write failed: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-[min(90vw,900px)] max-h-[90vh] bg-background rounded-lg shadow-2xl flex flex-col animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-violet-400 shrink-0" />
            <h3 className="text-sm font-semibold truncate">{path}</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 p-4 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading current content...
            </div>
          ) : (
            <FileDiff oldContent={oldContent ?? ""} newContent={content} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} disabled={loading || applying}>
            {applying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
            Apply changes
          </Button>
        </div>
      </div>
    </div>
  );
}

