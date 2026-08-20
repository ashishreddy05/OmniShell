"use client";

import React, { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import MANUAL_MARKDOWN from "../../../docs/user-manual.md";
import { useUIStore } from "@/stores/ui-store";
import {
  BookOpen,
  X,
  FileText,
  Key,
  FolderOpen,
  Terminal,
  Activity,
  Cpu,
  Sparkles,
  Command,
  HelpCircle,
  FilePlus2,
  ChevronRight,
  Maximize2,
  Minimize2,
  Copy,
  Check,
} from "lucide-react";
import { GiaMark, GiaWordmark } from "@/components/brand/gia-mark";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAVIGATION_ITEMS = [
  { id: "getting-started", label: "Getting Started", icon: HelpCircle },
  { id: "command-palette", label: "Command Palette", icon: Command },
  { id: "connection-management", label: "Connections", icon: Key },
  { id: "file-explorer", label: "File Explorer", icon: FolderOpen },
  { id: "monaco-code-editor", label: "Monaco Editor", icon: FileText },
  { id: "interactive-web-terminal", label: "Web Terminal", icon: Terminal },
  { id: "system-vitals", label: "System Vitals", icon: Cpu },
  { id: "advanced-systemd", label: "Service Manager", icon: Activity },
  { id: "service-file-builder", label: "Service File Builder", icon: FilePlus2 },
  { id: "gia-the-ai-copilot-next-level", label: "GIA AI Assistant", icon: Sparkles },
  { id: "keyboard-shortcuts", label: "Shortcuts", icon: Command },
  { id: "premium-ui-features", label: "Premium UI Features", icon: BookOpen },
];

function ManualCodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative group my-4 rounded-lg border border-violet-200 dark:border-violet-500/10 bg-zinc-100 dark:bg-zinc-950/40 p-4 font-mono text-xs overflow-x-auto whitespace-pre">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-200/80 dark:bg-zinc-950/80 border border-violet-200 dark:border-violet-500/10 rounded"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3 text-zinc-600 dark:text-muted-foreground hover:text-zinc-900 dark:hover:text-foreground" />
        )}
      </Button>
      <code className="text-violet-850 dark:text-violet-200">{children}</code>
    </div>
  );
}

export function UserManualDialog() {
  const { userManualOpen, setUserManualOpen } = useUIStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  const [activeSection, setActiveSection] = useState("getting-started");
  const [isMaximized, setIsMaximized] = useState(false);

  const scrollToSection = (id: string) => {
    if (!contentRef.current) return;
    const elements = contentRef.current.querySelectorAll("h2");
    
    // Traversal to find the scrollable viewport container
    let scrollContainer: HTMLElement | null = contentRef.current.parentElement;
    while (scrollContainer) {
      if (
        scrollContainer.hasAttribute("data-radix-scroll-area-viewport") ||
        scrollContainer.classList.contains("overflow-y-auto") ||
        scrollContainer.style.overflowY === "auto" ||
        scrollContainer.style.overflowY === "scroll"
      ) {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }
    
    for (const el of Array.from(elements)) {
      const text = (el.textContent || "").toLowerCase();
      const idSpace = id.replace(/-/g, " ");
      // Strip punctuation/dashes from both for fuzzy match
      const normalize = (s: string) => s.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
      if (normalize(text).includes(normalize(idSpace))) {
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = el.getBoundingClientRect();
          const relativeTop = elementRect.top - containerRect.top + scrollContainer.scrollTop;
          
          scrollContainer.scrollTo({
            top: relativeTop - 16,
            behavior: "smooth"
          });
        } else {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        // Set immediately for reactive navigation feel
        setActiveSection(id);
        break;
      }
    }
  };

  useEffect(() => {
    if (!userManualOpen) return;

    const timer = setTimeout(() => {
      if (!contentRef.current) return;
      const headings = Array.from(contentRef.current.querySelectorAll("h2"));
      if (headings.length === 0) return;

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting);
          if (visible.length === 0) return;

          // Pick the heading whose center is closest to the top 25% of the viewport
          const target = visible.reduce((prev, curr) => {
            const prevDist = Math.abs(prev.boundingClientRect.top + prev.boundingClientRect.height / 2 - window.innerHeight * 0.25);
            const currDist = Math.abs(curr.boundingClientRect.top + curr.boundingClientRect.height / 2 - window.innerHeight * 0.25);
            return currDist < prevDist ? curr : prev;
          });

          const text = (target.target.textContent || "").toLowerCase();
          const match = NAVIGATION_ITEMS.find((item) => {
            const h = text.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            const l = item.label.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            const i = item.id.replace(/-/g, " ").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            return h.includes(l) || h.includes(i);
          });

          if (match) setActiveSection(match.id);
        },
        {
          rootMargin: "-20% 0px -30% 0px",
          threshold: 0,
        }
      );

      headings.forEach((h) => observer.observe(h));
      observerRef.current = observer;
    }, 250);

    return () => {
      clearTimeout(timer);
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [userManualOpen]);

  return (
    <Dialog open={userManualOpen} onOpenChange={setUserManualOpen}>
      <DialogContent 
        showCloseButton={false} 
        className={cn(
          "p-0 flex flex-col overflow-hidden bg-background/95 backdrop-blur-xl border border-violet-500/20 shadow-[0_0_50px_rgba(139,92,246,0.15)] transition-all duration-300 ease-in-out z-50",
          isMaximized 
            ? "max-w-[98vw] sm:max-w-[98vw] w-[98vw] h-[95vh] rounded-xl" 
            : "max-w-4xl sm:max-w-4xl w-full h-[85vh] rounded-xl"
        )}
      >
        {/* Banner header */}
        <div className="relative flex items-center justify-between px-6 py-4 bg-gradient-to-r from-violet-600/20 via-fuchsia-900/10 to-transparent border-b border-violet-500/15 overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 80% at 0% 50%, rgba(139,92,246,0.25), transparent 70%)",
            }}
          />
          <div className="relative flex items-center gap-3.5 min-w-0">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-xl bg-violet-500/25 blur-md" />
              <div className="relative p-1.5 rounded-xl bg-background/60 border border-violet-400/25 shadow-[0_0_20px_rgba(139,92,246,0.2)]">
                <GiaMark size={28} />
              </div>
            </div>
            <div className="min-w-0">
              <DialogTitle className="sr-only">GIA Core Manual</DialogTitle>
              <GiaWordmark
                size="lg"
                subtitle="OmniShell · shortcuts, tools & workspace guide"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-muted/40 text-muted-foreground hover:text-foreground rounded-full border border-border"
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Restore size" : "Maximize manual"}
            >
              {isMaximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-muted/40 text-muted-foreground hover:text-foreground rounded-full border border-border"
              onClick={() => setUserManualOpen(false)}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content Area split layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation Menu */}
          <div className="w-56 border-r border-border bg-muted/10 flex flex-col p-4 gap-1 select-none shrink-0 overflow-y-auto custom-scrollbar">
            <span className="text-[10px] font-bold text-violet-400/80 uppercase tracking-wider px-2 mb-2">
              Sections
            </span>
            {NAVIGATION_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => scrollToSection(item.id)}
                  className={cn(
                    "flex items-center justify-between w-full px-2.5 py-2 text-xs font-medium rounded-lg transition-all text-left border-l-2",
                    isActive
                      ? "text-violet-600 dark:text-violet-400 bg-violet-500/5 dark:bg-violet-500/10 border-violet-500 font-semibold shadow-[inset_0_0_8px_rgba(139,92,246,0.05)]"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:bg-violet-500/5 hover:border-violet-500/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-3.5 w-3.5", isActive ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground/80")} />
                    <span>{item.label}</span>
                  </div>
                  <ChevronRight className={cn("h-3 w-3 transition-opacity", isActive ? "opacity-100 text-violet-600 dark:text-violet-400" : "opacity-0")} />
                </button>
              );
            })}
          </div>

          {/* Right Content display */}
          <ScrollArea className="flex-1 p-6 overflow-y-auto custom-scrollbar">
            <div
              ref={contentRef}
              className="max-w-none text-zinc-750 dark:text-zinc-300 leading-relaxed font-sans"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node, ...props }) => (
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-650 dark:from-violet-400 dark:to-indigo-400 bg-clip-text text-transparent pb-3 border-b border-violet-500/15 mb-6" {...props} />
                  ),
                  h2: ({ node, ...props }) => (
                    <h2 className="text-lg font-semibold text-violet-700 dark:text-violet-400 mt-8 mb-4 border-l-2 border-violet-500 pl-3 flex items-center gap-2" {...props} />
                  ),
                  h3: ({ node, ...props }) => (
                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-4 mb-2" {...props} />
                  ),
                  p: ({ node, ...props }) => (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-4" {...props} />
                  ),
                  ul: ({ node, ...props }) => (
                    <ul className="list-disc pl-6 space-y-2 mb-4 text-zinc-700 dark:text-zinc-300 text-sm" {...props} />
                  ),
                  ol: ({ node, ...props }) => (
                    <ol className="list-decimal pl-6 space-y-2 mb-4 text-zinc-700 dark:text-zinc-300 text-sm" {...props} />
                  ),
                  li: ({ node, ...props }) => (
                    <li className="leading-relaxed text-zinc-700 dark:text-zinc-300" {...props} />
                  ),
                  pre: ({ node, children, ...props }) => {
                    const child = children as React.ReactElement & { props?: Record<string, unknown> };
                    const codeText = (child?.props?.children as string) ?? "";
                    return <ManualCodeBlock>{codeText}</ManualCodeBlock>;
                  },
                  code: ({ node, children, ...props }: any) => {
                    return (
                      <code className="text-xs font-mono text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-500/20 px-1.5 py-0.5 rounded animate-spring-in" {...props}>
                        {children}
                      </code>
                    );
                  },
                  table: ({ node, ...props }) => (
                    <div className="overflow-x-auto border border-violet-200 dark:border-violet-500/10 rounded-lg my-6 shadow-md bg-zinc-100/50 dark:bg-zinc-950/20">
                      <table className="w-full border-collapse text-left text-sm" {...props} />
                    </div>
                  ),
                  th: ({ node, ...props }) => (
                    <th className="px-4 py-3 bg-violet-500/5 dark:bg-violet-950/20 text-violet-750 dark:text-violet-300 font-semibold border-b border-violet-200 dark:border-violet-500/10" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="px-4 py-3 border-b border-violet-200 dark:border-violet-500/5 text-zinc-700 dark:text-zinc-300" {...props} />
                  ),
                  hr: ({ node, ...props }) => (
                    <hr className="border-t border-violet-500/15 my-8" {...props} />
                  ),
                  strong: ({ node, ...props }) => (
                    <strong className="font-semibold text-zinc-900 dark:text-zinc-100" {...props} />
                  ),
                }}
              >
                {MANUAL_MARKDOWN}
              </ReactMarkdown>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
