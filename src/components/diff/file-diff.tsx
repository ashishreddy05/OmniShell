"use client";

import { useMemo } from "react";
import { Plus, Minus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileDiffProps {
  oldContent: string;
  newContent: string;
  maxLines?: number;
  className?: string;
}

function diffLines(oldStr: string, newStr: string): Array<{ type: "same" | "add" | "remove"; text: string; oldNum?: number; newNum?: number }> {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  // Trim common prefix/suffix so the LCS only runs on the changed region.
  let prefix = 0;
  const minLen = Math.min(m, n);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < m - prefix && suffix < n - prefix && oldLines[m - 1 - suffix] === newLines[n - 1 - suffix]) suffix++;

  const oldMid = oldLines.slice(prefix, m - suffix);
  const newMid = newLines.slice(prefix, n - suffix);
  const om = oldMid.length;
  const on = newMid.length;

  const result: Array<{ type: "same" | "add" | "remove"; text: string; oldNum?: number; newNum?: number }> = [];
  for (let k = 0; k < prefix; k++) {
    result.push({ type: "same", text: oldLines[k], oldNum: k + 1, newNum: k + 1 });
  }

  // Cap the DP to avoid OOM on huge changed regions.
  const maxSize = 2000;
  if (om * on > maxSize * maxSize) {
    oldMid.forEach((line, i) => result.push({ type: "remove", text: line, oldNum: prefix + i + 1 }));
    newMid.forEach((line, i) => result.push({ type: "add", text: line, newNum: prefix + i + 1 }));
  } else {
    const dp: number[][] = Array.from({ length: om + 1 }, () => new Array(on + 1).fill(0));
    for (let i = om - 1; i >= 0; i--) {
      for (let j = on - 1; j >= 0; j--) {
        if (oldMid[i] === newMid[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0, oldNum = prefix + 1, newNum = prefix + 1;
    while (i < om && j < on) {
      if (oldMid[i] === newMid[j]) {
        result.push({ type: "same", text: oldMid[i], oldNum, newNum });
        i++; j++; oldNum++; newNum++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: "remove", text: oldMid[i], oldNum });
        i++; oldNum++;
      } else {
        result.push({ type: "add", text: newMid[j], newNum });
        j++; newNum++;
      }
    }
    while (i < om) { result.push({ type: "remove", text: oldMid[i], oldNum }); i++; oldNum++; }
    while (j < on) { result.push({ type: "add", text: newMid[j], newNum }); j++; newNum++; }
  }

  for (let k = 0; k < suffix; k++) {
    const oi = m - suffix + k;
    const ni = n - suffix + k;
    result.push({ type: "same", text: oldLines[oi], oldNum: oi + 1, newNum: ni + 1 });
  }
  return result;
}

export function FileDiff({ oldContent, newContent, maxLines = 500, className }: FileDiffProps) {
  const lines = useMemo(() => diffLines(oldContent, newContent), [oldContent, newContent]);

  const stats = useMemo(() => {
    let added = 0, removed = 0;
    for (const l of lines) {
      if (l.type === "add") added++;
      else if (l.type === "remove") removed++;
    }
    return { added, removed };
  }, [lines]);

  const truncated = lines.length > maxLines;
  const visibleLines = truncated ? lines.slice(0, maxLines) : lines;

  return (
    <div className={cn("flex flex-col border border-border rounded-md overflow-hidden bg-card", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-muted/30 border-b border-border text-[10px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="h-3 w-3" />
          <span>{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span className="flex items-center gap-0.5 text-emerald-400">
            <Plus className="h-3 w-3" />{stats.added}
          </span>
          <span className="flex items-center gap-0.5 text-red-400">
            <Minus className="h-3 w-3" />{stats.removed}
          </span>
        </div>
      </div>
      <div className="overflow-auto max-h-[60vh] font-mono text-[11px] leading-relaxed">
        {visibleLines.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              "flex px-2 py-0.5",
              line.type === "add" && "bg-emerald-500/10 text-emerald-300",
              line.type === "remove" && "bg-red-500/10 text-red-300",
              line.type === "same" && "text-foreground/80"
            )}
          >
            <span className="select-none text-muted-foreground/40 text-[9px] w-8 text-right pr-1 shrink-0">
              {line.type === "remove" ? line.oldNum : line.newNum ?? ""}
            </span>
            <span className="select-none w-3 shrink-0 text-muted-foreground/50">
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all flex-1">{line.text || " "}</span>
          </div>
        ))}
        {truncated && (
          <div className="text-center text-muted-foreground py-2 text-[10px]">
            ... {lines.length - maxLines} more lines truncated ...
          </div>
        )}
      </div>
    </div>
  );
}
