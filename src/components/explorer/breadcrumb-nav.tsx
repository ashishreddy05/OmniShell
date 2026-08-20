"use client";

import { Button } from "@/components/ui/button";
import { ChevronRight, Home, ArrowLeft, ArrowRight } from "lucide-react";
import { useExplorerStore } from "@/stores/explorer-store";

interface BreadcrumbNavProps {
  connectionId: string;
  path: string;
  onNavigate: (path: string) => void;
}

export function BreadcrumbNav({ connectionId, path, onNavigate }: BreadcrumbNavProps) {
  const { goBack, goForward, getExplorer } = useExplorerStore();
  const explorer = getExplorer(connectionId);

  const parts = path.split("/").filter(Boolean);
  const canGoBack = explorer.historyIndex > 0;
  const canGoForward = explorer.historyIndex < explorer.history.length - 1;

  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!canGoBack}
        onClick={() => goBack(connectionId)}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!canGoForward}
        onClick={() => goForward(connectionId)}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-0.5 ml-2 overflow-x-auto">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-sm"
          onClick={() => onNavigate("/")}
        >
          <Home className="h-3.5 w-3.5" />
        </Button>

        {parts.map((part, i) => {
          const fullPath = "/" + parts.slice(0, i + 1).join("/");
          const isLast = i === parts.length - 1;
          return (
            <div key={fullPath} className="flex items-center animate-fade-in" style={{ animationDelay: `${i * 30}ms` }}>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mx-0.5" />
              <Button
                variant={isLast ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-sm"
                onClick={() => onNavigate(fullPath)}
              >
                {part}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
