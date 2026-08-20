"use client";

import { useEditorStore } from "@/stores/editor-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useUIStore } from "@/stores/ui-store";
import { fsApi } from "@/lib/api-client";
import { getOriginalContent, setOriginalContent } from "@/lib/editor-content";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Save, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function CodeEditor() {
  const { tabs, activeTabId, setActiveTab, closeTab, setDirty, getTab } = useEditorStore();
  const activeConnection = useConnectionStore((s) => s.activeTabId);
  const theme = useUIStore((s) => s.theme);
  const queryClient = useQueryClient();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  const activeEditorTab = activeTabId ? getTab(activeTabId) : null;

  const handleSave = useCallback(async () => {
    if (!activeEditorTab || !editorRef.current) return;
    const content = editorRef.current.getValue();
    try {
      await fsApi.write(activeEditorTab.connectionId, activeEditorTab.path, content);
      setOriginalContent(activeEditorTab.id, content);
      setDirty(activeEditorTab.id, false);
      queryClient.invalidateQueries({ queryKey: ["fs", "list", activeEditorTab.connectionId] });
      
      const { returnView, setReturnView, setMainView } = useUIStore.getState();
      if (returnView) {
        toast.success("Saved", {
          action: {
            label: "Back to service",
            onClick: () => {
              setMainView("services");
              setReturnView(null);
            },
          },
        });
        setReturnView(null);
      } else {
        toast.success("Saved");
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [activeEditorTab, setDirty, queryClient]);

  // Stable ref for save handler — avoids listener churn on every keystroke
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Warn before browser tab close if there are unsaved changes
  const hasDirty = useEditorStore((s) => s.tabs.some((t) => t.isDirty));
  useEffect(() => {
    if (!hasDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDirty]);

  const handleTabClose = (tabId: string) => {
    const tab = getTab(tabId);
    if (tab?.isDirty) {
      setPendingCloseTabId(tabId);
    } else {
      closeTab(tabId);
    }
  };

  const confirmClose = () => {
    if (pendingCloseTabId) {
      closeTab(pendingCloseTabId);
      setPendingCloseTabId(null);
    }
  };

  const handleEditorDidMount = useCallback((editorInstance: editor.IStandaloneCodeEditor) => {
    editorRef.current = editorInstance;

    // Track dirty state via Monaco model changes
    const model = editorInstance.getModel();
    if (model && activeEditorTab) {
      const tabId = activeEditorTab.id;
      model.onDidChangeContent(() => {
        const current = model.getValue();
        const original = getOriginalContent(tabId) ?? "";
        setDirty(tabId, current !== original);
      });
    }
  }, [activeEditorTab, setDirty]);

  if (tabs.length === 0) {
    return null;
  }

  // Only show tabs for the active connection
  const connectionTabs = tabs.filter((t) => t.connectionId === activeConnection);
  if (connectionTabs.length === 0) return null;

  const pendingTab = pendingCloseTabId ? getTab(pendingCloseTabId) : null;
  const editorTheme = theme === "light" ? "light" : "vs-dark";

  // Get initial content for the active tab
  const defaultValue = activeEditorTab ? getOriginalContent(activeEditorTab.id) ?? "" : "";

  return (
    <div className="flex h-full flex-col border-l border-border">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-muted/30 overflow-x-auto">
        {connectionTabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer border-r border-border min-w-0",
              activeTabId === tab.id
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.isDirty && <Circle className="h-2 w-2 fill-current text-orange-500 shrink-0" />}
            <span className="truncate max-w-32">{tab.fileName}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                handleTabClose(tab.id);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <div className="flex-1" />
        {activeEditorTab?.isDirty && (
          <Button variant="ghost" size="sm" className="h-7 mr-1" onClick={handleSave}>
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        )}
      </div>

      {/* Editor */}
      {activeEditorTab && (
        <div key={activeEditorTab.id} className="flex-1 animate-reveal-up">
          <MonacoEditor
            key={`${activeEditorTab.id}-content`}
            height="100%"
            defaultLanguage={activeEditorTab.language}
            defaultValue={defaultValue}
            theme={editorTheme}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              padding: { top: 8 },
            }}
          />
        </div>
      )}

      {/* Unsaved changes confirmation dialog */}
      <Dialog open={!!pendingCloseTabId} onOpenChange={(open) => !open && setPendingCloseTabId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              {pendingTab?.fileName} has unsaved changes. Are you sure you want to close it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingCloseTabId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmClose}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
