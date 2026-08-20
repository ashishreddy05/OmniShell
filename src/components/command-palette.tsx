"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Search, FileText, FolderPlus, Upload, RefreshCw, Sparkles, Terminal,
  Activity, Moon, Sun, Key, Server, FileSearch, Command, X,
  Bookmark, BookOpen, PanelLeft, Hash, FilePlus2, ScrollText,
} from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup,
  CommandItem, CommandShortcut, CommandSeparator,
} from "@/components/ui/command";
import { useConnectionStore } from "@/stores/connection-store";
import { useUIStore } from "@/stores/ui-store";
import { useAIStore } from "@/stores/ai-store";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionsApi, bookmarksApi } from "@/lib/api-client";
import { useExplorerStore } from "@/stores/explorer-store";
import { disconnectAndCleanup } from "@/lib/disconnect";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  group: string;
  shortcut?: string;
  keywords?: string[];
  perform: () => void | Promise<void>;
  /** Optional color for the icon */
  iconClass?: string;
  /** True if this command requires an active connection */
  needsConnection?: boolean;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const { data: connections = [] } = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
    enabled: open,
  });

  const { data: bookmarks = [] } = useQuery({
    queryKey: ["bookmarks"],
    queryFn: bookmarksApi.list,
    enabled: open,
  });

  // Listen for ⌘P / Ctrl+P to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const navigate = useExplorerStore((s) => s.navigate);
  const setMainView = useUIStore((s) => s.setMainView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleTerminal = useUIStore((s) => s.toggleTerminal);
  const setUserManualOpen = useUIStore((s) => s.setUserManualOpen);
  const openConnectionForm = useUIStore((s) => s.openConnectionForm);
  const openSSHImport = useUIStore((s) => s.openSSHImport);
  const openServiceBuilder = useUIStore((s) => s.openServiceBuilder);
  const { setOpen: setAIOpen, setPendingPrompt } = useAIStore();
  const { activeTabId, setActiveTab, setConnectionStatus } = useConnectionStore();

  // Build the dynamic commands list
  const commands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      // Navigation
      { id: "nav.explorer", label: "Go to Explorer", description: "Switch main view to file explorer", icon: FileText, group: "Navigation", shortcut: "⌘⇧E", perform: () => { setMainView("explorer"); close(); } },
      { id: "nav.services", label: "Go to Service Manager", description: "Switch main view to systemd services", icon: Activity, group: "Navigation", shortcut: "⌘⇧S", perform: () => { setMainView("services"); close(); } },
      { id: "nav.toggleSidebar", label: "Toggle Sidebar", icon: PanelLeft, group: "Navigation", perform: () => { toggleSidebar(); close(); } },
      { id: "nav.toggleTerminal", label: "Toggle Terminal", icon: Terminal, group: "Navigation", shortcut: "⌘⇧K", perform: () => { toggleTerminal(); close(); } },
      { id: "nav.manual", label: "Open GIA Core Manual", description: "Workspace & GIA user manual", icon: BookOpen, group: "Navigation", perform: () => { setUserManualOpen(true); close(); } },

      // GIA
      { id: "gia.open", label: "Open GIA Panel", description: "Toggle the AI assistant", icon: Sparkles, group: "GIA Assistant", shortcut: "⌘J", iconClass: "text-violet-400", perform: () => { setAIOpen(true); close(); } },
      { id: "gia.diagnose", label: "Ask GIA: Diagnose current service", description: "Investigate first — no silent restart", icon: Activity, group: "GIA Assistant", needsConnection: true, iconClass: "text-violet-400", perform: () => { setAIOpen(true); setPendingPrompt("Investigate why the active service might be failing. Use seeded logs + state first; if thin, propose approved tools (status/journal/RSS). Summarize root cause + fix — do NOT restart unless I ask."); close(); } },
      { id: "gia.memory", label: "Ask GIA: Investigate memory", description: "Current/watched service RSS & diagnosis", icon: Activity, group: "GIA Assistant", needsConnection: true, iconClass: "text-violet-400", perform: () => { setAIOpen(true); setPendingPrompt("Investigate memory for the current or watched service. Use seeded Memory if present; if thin, propose approved tools for systemctl status / journal / RSS. Classify leak vs spike vs OOM vs normal. Do NOT restart unless I ask."); close(); } },
      { id: "gia.callid", label: "Ask GIA: Find call_id in logs", description: "search_service_logs (approval required)", icon: ScrollText, group: "GIA Assistant", needsConnection: true, iconClass: "text-violet-400", perform: () => { setAIOpen(true); setPendingPrompt("Find a call_id in service logs using search_service_logs on the Active Service (ask me for the call_id if missing). Say you used search_service_logs, then diagnose duration, errors, voice tools, and outcome — cite status codes/tool names only, do not paste raw logs."); close(); } },
      { id: "gia.list", label: "Ask GIA: List running services", icon: Server, group: "GIA Assistant", needsConnection: true, iconClass: "text-violet-400", perform: () => { setAIOpen(true); setPendingPrompt("List all systemd services and identify any that are failed or inactive."); close(); } },
      { id: "gia.findconfigs", label: "Ask GIA: Find config files", icon: FileSearch, group: "GIA Assistant", needsConnection: true, iconClass: "text-violet-400", perform: () => { setAIOpen(true); setPendingPrompt("Search the server for configuration files (*.conf, *.yaml, *.cfg) and summarize what services they configure."); close(); } },

      // Connection management
      { id: "conn.new", label: "New Connection", description: "Add a new SSH server", icon: Key, group: "Connections", perform: () => { openConnectionForm(); close(); } },
      { id: "conn.import", label: "Import from SSH Config", description: "Parse ~/.ssh/config", icon: Hash, group: "Connections", perform: () => { openSSHImport(); close(); } },
      ...connections.map<PaletteCommand>((conn) => ({
        id: `conn.${conn.id}`,
        label: `Connect: ${conn.name}`,
        description: `${conn.username}@${conn.host}:${conn.port}`,
        icon: Server,
        group: "Connections",
        perform: async () => {
          setConnectionStatus(conn.id, conn, "connecting");
          try {
            await connectionsApi.connect(conn.id);
            setConnectionStatus(conn.id, conn, "connected");
            setActiveTab(conn.id);
            navigate(conn.id, conn.defaultPath || "/");
            toast.success(`Connected to ${conn.name}`);
          } catch (err) {
            setConnectionStatus(conn.id, conn, "error", (err as Error).message);
            toast.error(`Failed: ${(err as Error).message}`);
          }
          close();
        },
      })),
      ...(activeTabId
        ? [{
            id: "conn.disconnect",
            label: "Disconnect current connection",
            icon: X,
            group: "Connections",
            perform: async () => {
              await disconnectAndCleanup(activeTabId);
              toast.success("Disconnected");
              close();
            },
          }]
        : []),

      // Bookmarks (quick navigation)
      ...bookmarks.slice(0, 8).map<PaletteCommand>((bm) => ({
        id: `bm.${bm.id}`,
        label: `Bookmark: ${bm.label || bm.path.split("/").pop() || bm.path}`,
        description: `${bm.path} · ${connections.find((c) => c.id === bm.connectionId)?.name ?? ""}`,
        icon: Bookmark,
        group: "Bookmarks",
        perform: async () => {
          const conn = connections.find((c) => c.id === bm.connectionId);
          if (!conn) {
            toast.error("Connection not found");
            return;
          }
          const active = useConnectionStore.getState().activeConnections.get(bm.connectionId);
          if (active?.status !== "connected") {
            setConnectionStatus(bm.connectionId, conn, "connecting");
            try {
              await connectionsApi.connect(bm.connectionId);
              setConnectionStatus(bm.connectionId, conn, "connected");
            } catch (err) {
              toast.error(`Failed: ${(err as Error).message}`);
              close();
              return;
            }
          }
          setActiveTab(bm.connectionId);
          navigate(bm.connectionId, bm.path);
          setMainView("explorer");
          close();
        },
      })),

      // File actions
      { id: "file.refresh", label: "Refresh current directory", icon: RefreshCw, group: "Actions", needsConnection: true, perform: () => { queryClient.invalidateQueries({ queryKey: ["fs", "list"] }); close(); } },
      { id: "file.search", label: "Search files", description: "Find files by name or content", icon: Search, group: "Actions", shortcut: "⌘K", needsConnection: true, perform: () => { window.dispatchEvent(new CustomEvent("open-global-search")); close(); } },
      { id: "file.newfile", label: "New File", description: "Create empty file in current dir", icon: FileText, group: "Actions", needsConnection: true, perform: () => { window.dispatchEvent(new CustomEvent("trigger-new-file")); close(); } },
      { id: "file.newfolder", label: "New Folder", description: "Create directory in current dir", icon: FolderPlus, group: "Actions", needsConnection: true, perform: () => { window.dispatchEvent(new CustomEvent("trigger-new-folder")); close(); } },
      { id: "file.upload", label: "Upload Files", description: "Upload to current directory", icon: Upload, group: "Actions", needsConnection: true, perform: () => { window.dispatchEvent(new CustomEvent("trigger-upload")); close(); } },
      { id: "svc.new", label: "New agent service", description: "Service file builder for voice-agent units", icon: FilePlus2, group: "Actions", keywords: ["systemd", "unit", "builder", "daemon"], perform: () => { openServiceBuilder(); close(); } },
      { id: "svc.builder", label: "Service file builder", description: "Write unit → daemon-reload → enable → start", icon: Activity, group: "Actions", keywords: ["systemd", "new service", "agent"], perform: () => { openServiceBuilder(); close(); } },

      // Theme
      { id: "theme.toggle", label: theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme", icon: theme === "dark" ? Sun : Moon, group: "Appearance", perform: () => { setTheme(theme === "dark" ? "light" : "dark"); close(); } },
    ];

    return cmds;
  }, [theme, setTheme, activeTabId, connections, bookmarks, setAIOpen, setPendingPrompt, setMainView, toggleSidebar, toggleTerminal, setUserManualOpen, openConnectionForm, openSSHImport, openServiceBuilder, setConnectionStatus, setActiveTab, navigate, queryClient, close]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command Palette" description="Jump to anywhere, run any action">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {(["Navigation", "GIA Assistant", "Connections", "Bookmarks", "Actions", "Appearance"] as const).map((group) => {
          const groupCommands = commands.filter((c) => c.group === group);
          if (groupCommands.length === 0) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {groupCommands.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.description ?? ""} ${cmd.keywords?.join(" ") ?? ""}`}
                    onSelect={() => cmd.perform()}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", cmd.iconClass)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{cmd.label}</div>
                      {cmd.description && (
                        <div className="text-[10px] text-muted-foreground truncate">{cmd.description}</div>
                      )}
                    </div>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
        <CommandSeparator />
        <CommandGroup heading="Tip">
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Command className="h-3 w-3" />
            <span>Press <kbd className="font-mono bg-muted px-1 rounded">⌘⇧P</kbd> or <kbd className="font-mono bg-muted px-1 rounded">⌘/</kbd> anytime to open this palette</span>
          </div>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
