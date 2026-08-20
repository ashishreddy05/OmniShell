"use client";

import { useEffect, useRef, useCallback } from "react";
import { wsClient } from "@/lib/ws-client";
import { useTerminalStore, TERMINAL_THEMES } from "@/stores/terminal-store";

// Module-level scrollback buffer so content persists across tab switches
const scrollbackBuffers = new Map<string, string[]>();
const MAX_SCROLLBACK = 5000;

export function TerminalInstance({
  connectionId,
  sessionId,
}: {
  connectionId: string;
  sessionId: string;
}) {
  const themeKey = useTerminalStore((s) => s.theme);
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpenRef = useRef(false);

  const doFit = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !termRef.current) return;

    try {
      // Check if the container is actually visible with non-zero dimensions
      const rect = termRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        // Container is hidden — retry when visible
        if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = setTimeout(doFit, 200);
        return;
      }
      fitAddon.fit();
      if (isOpenRef.current) {
        wsClient.send({
          type: "terminal:resize",
          connectionId,
          payload: { sessionId, cols: terminal.cols, rows: terminal.rows },
        });
      }
    } catch {
      // Ignore fit errors
    }
  }, [connectionId, sessionId]);

  useEffect(() => {
    if (!termRef.current) return;

    let disposed = false;
    let unsubs: (() => void)[] = [];

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      await import("@xterm/xterm/css/xterm.css");

      if (disposed || !termRef.current) return;

      const activeTheme = TERMINAL_THEMES[useTerminalStore.getState().theme] || TERMINAL_THEMES.default;
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "Geist Mono, Menlo, Monaco, monospace",
        theme: activeTheme.theme,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.open(termRef.current);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Restore scrollback buffer if available
      const bufKey = `${connectionId}:${sessionId}`;
      const saved = scrollbackBuffers.get(bufKey);
      if (saved && saved.length > 0) {
        for (const line of saved) {
          terminal.write(line);
        }
      }

      // Set up terminal input handler
      terminal.onData((data) => {
        wsClient.send({
          type: "terminal:input",
          connectionId,
          payload: { sessionId, data: btoa(data) },
        });
      });

      // Open terminal on server
      function openTerminal() {
        if (!wsClient.isConnected) return;
        terminal.write("\x1b[32mConnecting...\x1b[0m\r\n");
        wsClient.send({
          type: "terminal:open",
          connectionId,
          payload: { sessionId, cols: terminal.cols, rows: terminal.rows },
        });
      }

      // Listen for terminal opened confirmation
      const unsubOpened = wsClient.on("terminal:opened", (msg) => {
        if (msg.payload.sessionId === sessionId) {
          isOpenRef.current = true;
          terminal.write("\r\n");
          // Fit after terminal is confirmed open
          doFit();
        }
      });

      // Listen for errors from server
      const unsubError = wsClient.on("terminal:error", (msg) => {
        if (msg.connectionId === connectionId && msg.payload.sessionId === sessionId) {
          terminal.write(`\r\n\x1b[31m[Error: ${msg.error || "Unknown error"}]\x1b[0m\r\n`);
        }
      });

      // Handle terminal output from server
      const unsubOutput = wsClient.on("terminal:output", (msg) => {
        if (msg.connectionId === connectionId && msg.payload.sessionId === sessionId) {
          const data = msg.payload.data as string;
          const decoded = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          terminal.write(decoded);

          // Save to scrollback buffer
          const bufKey = `${connectionId}:${sessionId}`;
          let buf = scrollbackBuffers.get(bufKey);
          if (!buf) {
            buf = [];
            scrollbackBuffers.set(bufKey, buf);
          }
          buf.push(data);
          if (buf.length > MAX_SCROLLBACK) {
            buf.splice(0, buf.length - MAX_SCROLLBACK);
          }
        }
      });

      // Handle terminal closed by server
      const unsubClosed = wsClient.on("terminal:closed", (msg) => {
        if (msg.connectionId === connectionId && msg.payload.sessionId === sessionId) {
          isOpenRef.current = false;
          terminal.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
          scrollbackBuffers.delete(`${connectionId}:${sessionId}`);
        }
      });

      // Handle WebSocket reconnection
      const unsubReconnect = wsClient.on("ws:connected", () => {
        terminal.write("\r\n\x1b[32m[WebSocket reconnected]\x1b[0m\r\n");
        if (!isOpenRef.current) {
          // Re-open terminal session after WS reconnect
          openTerminal();
        }
        doFit();
      });

      const unsubDisconnect = wsClient.on("ws:disconnected", () => {
        terminal.write("\r\n\x1b[31m[WebSocket disconnected]\x1b[0m\r\n");
      });

      unsubs = [unsubOutput, unsubClosed, unsubError, unsubOpened, unsubReconnect, unsubDisconnect];

      // Wait for WS, then open terminal
      if (!wsClient.isConnected) {
        terminal.write("\x1b[33mConnecting to WebSocket...\x1b[0m\r\n");
        const connected = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            unsubReconnect();
            resolve(false);
          }, 10_000);
          const unsub = wsClient.on("ws:connected", () => {
            clearTimeout(timeout);
            unsub();
            resolve(true);
          });
        });

        if (disposed) return;

        if (!connected) {
          terminal.write(
            "\x1b[31mFailed to connect to WebSocket. " +
            "Make sure you are running the app with 'npm run dev' (not 'next dev').\x1b[0m\r\n"
          );
          return;
        }
      }

      openTerminal();

      // ResizeObserver with proper visibility check
      const resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = setTimeout(doFit, 150);
      });
      resizeObserver.observe(termRef.current);

      // Also fit on next animation frame to ensure rendering
      requestAnimationFrame(() => {
        if (!disposed) doFit();
      });

      cleanupRef.current = () => {
        for (const unsub of unsubs) unsub();
        if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        isOpenRef.current = false;
      };
    }

    init();

    return () => {
      disposed = true;
      cleanupRef.current?.();
    };
  }, [connectionId, sessionId, doFit]);

  // Dynamically update theme when store theme changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      const activeTheme = TERMINAL_THEMES[themeKey] || TERMINAL_THEMES.default;
      terminal.options.theme = activeTheme.theme;
    }
  }, [themeKey]);

  return <div ref={termRef} className="h-full w-full" />;
}
