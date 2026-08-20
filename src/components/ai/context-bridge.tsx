"use client";

import { useEffect } from "react";
import { useAIStore } from "@/stores/ai-store";
import { useEditorStore } from "@/stores/editor-store";
import { getOriginalContent } from "@/lib/editor-content";

function useEditorContext() {
  const { tabs, activeTabId: editorTabId } = useEditorStore();
  const setContext = useAIStore((s) => s.setContext);

  useEffect(() => {
    if (!editorTabId) return;
    const tab = tabs.find((t) => t.id === editorTabId);
    if (!tab) return;
    const content = getOriginalContent(editorTabId);
    setContext({
      connectionId: tab.connectionId,
      file: { path: tab.path, content, language: tab.language },
    });
  }, [editorTabId, tabs, setContext]);
}

export function AIContextBridge() {
  useEditorContext();
  return null;
}
