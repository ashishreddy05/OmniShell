"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  Check, Copy, ChevronDown, ChevronRight, Eye, EyeOff, Terminal as TerminalIcon,
  Activity, FileText, ListTree, Server, FileSearch, Wrench, Zap, Sparkles, WrapText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TOOL_NAMES } from "@/lib/gia-tools";

// ─── Parser ──────────────────────────────────────────────────────────────

export interface Step {
  icon: string;
  text: string;
  /** e.g. "running", "success", "error", "list", "search", "connect" */
  kind: "running" | "success" | "error" | "list" | "search" | "connect" | "edit" | "info" | "warn";
}

export interface OutputBlock {
  language: string;
  content: string;
  /** First line preview (e.g. file path, command) */
  preview: string;
}

export interface ParsedMessage {
  steps: Step[];
  outputs: OutputBlock[];
  text: string;
}

/** Heuristic: journal / call_id dumps — hide from TOOL OUTPUTS (full logs live in Service Manager). */
function isLikelyJournalDump(block: OutputBlock): boolean {
  if (block.language === "path" || block.language === "json" || block.language === "diff") return false;
  const sample = block.content.slice(0, 4000);
  const lines = sample.split("\n").filter(Boolean);
  if (lines.length < 8) return false;
  // journalctl-ish: timestamp + host/unit, or voice-tool markers
  const journalHits = lines.filter((l) =>
    /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s/.test(l) ||
    /\b(journalctl|webhook|GIA_|status=\d{3}|call_id)\b/i.test(l)
  ).length;
  return journalHits >= Math.min(5, Math.ceil(lines.length * 0.25));
}

const ICON_KIND_MAP: Record<string, Step["kind"]> = {
  "⏳": "running",
  "🔄": "running",
  "🔌": "connect",
  "✅": "success",
  "🎉": "success",
  "❌": "error",
  "🛑": "error",
  "📂": "list",
  "🔍": "search",
  "📋": "list",
  "📝": "edit",
  "📄": "edit",
  "📖": "edit",
  "⚠️": "warn",
  "🚫": "warn",
  "🔧": "info",
  "🛠️": "info",
  "ℹ️": "info",
  "_⏳": "running",
};

/**
 * Parses the raw assistant content into three buckets:
 * - `steps`: status lines (⏳ Running..., ✅ Connected..., etc.)
 * - `outputs`: fenced code blocks (tool results)
 * - `text`: the actual answer (everything else)
 */
export function parseAssistantMessage(content: string): ParsedMessage {
  const steps: Step[] = [];
  const outputs: OutputBlock[] = [];
  const textLines: string[] = [];

  const lines = content.split("\n");
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  let codeStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect fenced code block boundaries
    const fenceMatch = line.match(/^```(\w+)?/);
    if (fenceMatch) {
      if (inCodeBlock) {
        // End of block
        const blockContent = codeBuffer.join("\n");
        const preview = codeBuffer[0] || (codeLang === "path=*" ? line : "");
        // Also extract path=filename header if present
        let lang = codeLang;
        let displayPreview = preview;
        if (codeLang.startsWith("path=")) {
          displayPreview = codeLang.slice(5);
          lang = "path";
        }
        outputs.push({
          language: lang || "text",
          content: blockContent,
          preview: displayPreview || `${blockContent.split("\n").length} lines`,
        });
        codeBuffer = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        // Start of block
        inCodeBlock = true;
        codeLang = fenceMatch[1] || "";
        codeStartIdx = i;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Strip leading whitespace and check for status emojis
    const trimmed = line.trimStart();
    // Multi-character emoji variants
    const statusEmojiMatch = trimmed.match(/^(_?)([⏳🔄🔌✅🎉❌🛑📂🔍📋📝📄📖⚠️🚫🔧🛠️ℹ️])(\s+|$)(.*)$/);
    if (statusEmojiMatch) {
      const emoji = statusEmojiMatch[2];
      const rest = (statusEmojiMatch[4] || "").replace(/^_|_$/g, "").trim();
      steps.push({
        icon: emoji,
        kind: ICON_KIND_MAP[emoji] || "info",
        text: rest,
      });
      continue;
    }

    textLines.push(line);
  }

  // Flush trailing code block (unclosed fence)
  if (inCodeBlock && codeBuffer.length > 0) {
    outputs.push({
      language: codeLang || "text",
      content: codeBuffer.join("\n"),
      preview: codeBuffer[0] || `${codeBuffer.length} lines`,
    });
  }

  return {
    steps,
    outputs,
    text: textLines.join("\n").trim(),
  };
}

// ─── Step Timeline ───────────────────────────────────────────────────────

const KIND_STYLES: Record<Step["kind"], { dot: string; line: string; text: string }> = {
  running: { dot: "bg-amber-400 animate-pulse", line: "bg-amber-400/40", text: "text-amber-300" },
  success: { dot: "bg-emerald-400", line: "bg-emerald-400/40", text: "text-emerald-300" },
  error:   { dot: "bg-red-400", line: "bg-red-400/40", text: "text-red-300" },
  list:    { dot: "bg-blue-400", line: "bg-blue-400/40", text: "text-blue-300" },
  search:  { dot: "bg-violet-400", line: "bg-violet-400/40", text: "text-violet-300" },
  connect: { dot: "bg-cyan-400", line: "bg-cyan-400/40", text: "text-cyan-300" },
  edit:    { dot: "bg-orange-400", line: "bg-orange-400/40", text: "text-orange-300" },
  warn:    { dot: "bg-amber-400", line: "bg-amber-400/40", text: "text-amber-300" },
  info:    { dot: "bg-zinc-400", line: "bg-zinc-400/40", text: "text-zinc-300" },
};

function StepsTimeline({ steps, defaultCollapsed = true }: { steps: Step[]; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  if (steps.length === 0) return null;

  const filteredSteps = showErrorsOnly ? steps.filter((s) => s.kind === "error") : steps;
  const successCount = steps.filter((s) => s.kind === "success").length;
  const errorCount = steps.filter((s) => s.kind === "error").length;
  const runningCount = steps.filter((s) => s.kind === "running").length;

  return (
    <div className="my-2 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-300">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-violet-500/[0.06] transition-colors text-left"
      >
        {collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
        <Wrench className="h-3 w-3 text-violet-400 shrink-0" />
        <span className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">
          Steps taken
        </span>
        <span className="text-[10px] text-muted-foreground/70 font-mono">
          {showErrorsOnly ? filteredSteps.length : steps.length}
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          {successCount > 0 && !showErrorsOnly && (
            <span className="text-[9px] font-mono text-emerald-400">✓{successCount}</span>
          )}
          {errorCount > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); setShowErrorsOnly((v) => !v); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setShowErrorsOnly((v) => !v); } }}
              role="button"
              tabIndex={0}
              className={cn(
                "text-[9px] font-mono transition-colors cursor-pointer",
                showErrorsOnly ? "text-red-300 underline" : "text-red-400 hover:text-red-300"
              )}
              title={showErrorsOnly ? "Show all steps" : "Show errors only"}
            >
              ✗{errorCount}
            </span>
          )}
          {runningCount > 0 && !showErrorsOnly && (
            <span className="text-[9px] font-mono text-amber-400">…{runningCount}</span>
          )}
        </div>
      </button>
      {!collapsed && filteredSteps.length > 0 && (
        <div className="px-2.5 pb-2.5 pt-0.5 border-t border-violet-500/10">
          {showErrorsOnly && (
            <div className="px-1 pb-1 text-[9px] text-red-400/70 font-mono">
              Filtered to {filteredSteps.length} error{filteredSteps.length !== 1 ? "s" : ""}
            </div>
          )}
          <ol className="relative space-y-0">
            {filteredSteps.map((step, idx) => {
              const styles = KIND_STYLES[step.kind];
              return (
                <li key={idx} className="flex items-start gap-2 relative pl-3 py-0.5">
                  {/* Vertical line connector (except for last) */}
                  {idx < filteredSteps.length - 1 && (
                    <span className={cn("absolute left-[5px] top-3 bottom-0 w-px", styles.line)} />
                  )}
                  <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", styles.dot)} />
                  <span className={cn("text-[10px] leading-relaxed flex-1 min-w-0 break-words", styles.text)}>
                    {step.text}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {!collapsed && filteredSteps.length === 0 && showErrorsOnly && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-violet-500/10">
          <div className="text-[10px] text-muted-foreground/70 px-1">No errors — all steps succeeded.</div>
        </div>
      )}
    </div>
  );
}

// ─── Collapsible Output Block ───────────────────────────────────────────

function OutputBlockView({ block, defaultCollapsed }: { block: OutputBlock; defaultCollapsed: boolean }) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [wrap, setWrap] = useState(true); // Default to wrap (no horizontal scroll)
  const [copied, setCopied] = useState(false);

  const lineCount = block.content.split("\n").length;
  const isLong = lineCount > 12;
  // Detect very long lines (the pmap problem) — if any line > 200 chars, suggest wrap
  const hasLongLines = useMemo(
    () => block.content.split("\n").some((l) => l.length > 200),
    [block.content]
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(block.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Header label
  const langLabel = (() => {
    if (block.language === "path") return "📄 " + (block.preview || "file");
    if (block.language && block.language !== "text") return block.language;
    if (block.preview && block.preview !== `${lineCount} lines`) return "📄 " + block.preview;
    return `${lineCount} lines`;
  })();

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1 bg-muted/30 border-b border-border/40">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1.5 text-left text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors min-w-0 flex-1"
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="truncate">{langLabel}</span>
          {isLong && !expanded && (
            <span className="text-[9px] text-muted-foreground/60 shrink-0">— collapsed</span>
          )}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          {expanded && hasLongLines && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setWrap((w) => !w)}
              title={wrap ? "Switch to horizontal scroll" : "Wrap long lines"}
              aria-label="Toggle line wrapping"
            >
              <WrapText className={cn("h-3 w-3", wrap && "text-violet-400")} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleCopy}
            title="Copy"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      {expanded && (
        <pre
          className={cn(
            "p-2.5 text-[11px] leading-relaxed font-mono overflow-x-auto",
            wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
          )}
        >
          <code>{block.content}</code>
        </pre>
      )}
    </div>
  );
}

// ─── Shared ReactMarkdown Components ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MARKDOWN_COMPONENTS: any = {
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="whitespace-pre-wrap break-words">{children}</pre>,
  code: ({ inline, children, className, ...props }: { inline?: boolean; children?: React.ReactNode; className?: string }) => {
    if (inline) {
      const text = String(children).trim();
      if (TOOL_NAMES.has(text)) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-violet-500/20 bg-muted/30 text-[10px] font-mono text-violet-300 leading-none align-baseline">
            <Wrench className="h-2.5 w-2.5 shrink-0" />
            <span>{text}</span>
          </span>
        );
      }
      return <code className="bg-muted/80 rounded px-1 py-0.5 text-xs font-mono break-words" {...props}>{children}</code>;
    }
    return <code className={cn("text-xs font-mono break-words", className)} {...props}>{children}</code>;
  },
};

// ─── Main Structured Renderer ────────────────────────────────────────────

export function StructuredMessage({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const parsed = useMemo(() => parseAssistantMessage(content), [content]);
  // Journal dumps still render as collapsible blocks, just collapsed by default.
  const hasOutputs = parsed.outputs.length > 0;

  // Truly flat: no steps AND no code blocks at all — short pure-prose answers only.
  if (parsed.steps.length === 0 && !hasOutputs) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:my-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_h4]:text-xs [&_blockquote]:text-xs [&_blockquote]:border-l-violet-500/30 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words">
        {content ? (
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
        ) : null}
        {streaming && (
          <span className="inline-block w-1.5 h-3 bg-violet-400 ml-0.5 align-text-bottom animate-cursor" />
        )}
      </div>
    );
  }

  // Structured: steps timeline → answer text → collapsible outputs
  return (
    <div>
      {parsed.steps.length > 0 && <StepsTimeline steps={parsed.steps} defaultCollapsed={parsed.steps.length > 2} />}

      {parsed.text && (
        <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:my-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_h4]:text-xs [&_blockquote]:text-xs [&_blockquote]:border-l-violet-500/30 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words">
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>
            {parsed.text}
          </ReactMarkdown>
          {streaming && (
            <span className="inline-block w-1.5 h-3 bg-violet-400 ml-0.5 align-text-bottom animate-cursor" />
          )}
        </div>
      )}

      {hasOutputs && (
        <div className="mt-2">
          <div className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1 flex items-center gap-1.5 px-1">
            <FileText className="h-2.5 w-2.5" />
            Tool outputs ({parsed.outputs.length})
          </div>
          {parsed.outputs.map((block, i) => {
            const isJournal = isLikelyJournalDump(block);
            return (
              <OutputBlockView
                key={i}
                block={block}
                defaultCollapsed={isJournal || block.content.split("\n").length > 12}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
