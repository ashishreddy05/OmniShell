"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { highlightVoiceTools } from "@/lib/gia-tools";

export interface LogLine {
  line: string;
  index: number;
}

interface LogLineViewerProps {
  lines: LogLine[];
  /** If set, highlight matches in yellow */
  filterQuery?: string;
  /** Extra class on container */
  className?: string;
  /** Max height before scroll (e.g. "h-full") */
  heightClass?: string;
}

export function LogLineViewer({
  lines,
  filterQuery,
  className,
  heightClass = "flex-1",
}: LogLineViewerProps) {
  const q = filterQuery?.trim().toLowerCase() ?? "";

  return (
    <div className={cn("overflow-y-auto log-surface rounded-md font-mono text-xs", heightClass, className)}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map(({ line, index }) => {
            const lower = line.toLowerCase();
            const isError =
              lower.includes("error") ||
              lower.includes("fatal") ||
              lower.includes("traceback") ||
              lower.includes("exception");
            const isWarn = !isError && lower.includes("warn");
            const isConversation = lower.includes("[conversation]");
            const isTool = !isConversation && lower.includes("[tool]");
            const isMatch = q && lower.includes(q);
            const conversationMatch = isConversation
              ? line.match(/(\[Conversation\]\s*(?:assistant|user):)\s*(.*)/i)
              : null;
            const convRole = conversationMatch
              ? conversationMatch[1].toLowerCase().includes("assistant")
                ? "assistant"
                : "user"
              : null;
            return (
              <tr
                key={index}
                id={`log-line-${index}`}
                className={cn(
                  "hover:bg-accent/40 transition-colors group",
                  isError && "bg-destructive/10 border-l-2 border-destructive/40",
                  isWarn && !isError && "bg-yellow-500/10 border-l-2 border-yellow-500/30",
                  isConversation && "bg-violet-500/[0.10] dark:bg-violet-500/[0.06] border-l-2 border-violet-500/50 dark:border-violet-500/40",
                  isTool && "bg-amber-500/[0.10] dark:bg-amber-500/[0.06] border-l-2 border-amber-500/50 dark:border-amber-500/40",
                  isMatch && "bg-yellow-500/[0.08] border-l-2 border-yellow-500",
                )}
              >
                <td className="select-none text-right text-[9px] text-muted-foreground/60 w-10 px-1.5 py-0 align-top border-r border-border/30">
                  {index + 1}
                </td>
                <td
                  className={cn(
                    "px-2 py-0 text-[11px] whitespace-pre-wrap break-all",
                    isError
                      ? "text-destructive"
                      : isWarn
                        ? "text-yellow-600 dark:text-yellow-300"
                        : isConversation
                          ? "text-foreground/90"
                          : "text-foreground/80",
                  )}
                >
                  {conversationMatch ? (
                    <>
                      <span className="text-muted-foreground/70">
                        {line.slice(0, conversationMatch.index)}
                      </span>
                      <span
                        className={cn(
                          "font-semibold",
                          convRole === "assistant"
                            ? "text-violet-700 dark:text-violet-300"
                            : "text-sky-700 dark:text-sky-300",
                        )}
                      >
                        {conversationMatch[1]}
                      </span>
                      {" "}
                      <span
                        className={cn(
                          convRole === "assistant"
                            ? "text-violet-900 dark:text-violet-200"
                            : "text-sky-900 dark:text-sky-200",
                        )}
                      >
                        {conversationMatch[2]}
                      </span>
                    </>
                  ) : (
                    highlightVoiceTools(line || " ")
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lines.length === 0 && (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60 p-4">
          No log lines to display
        </div>
      )}
    </div>
  );
}
