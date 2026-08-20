"use client";

type MessageHandler = (message: WSServerMessage) => void;

export interface WSServerMessage {
  type: string;
  id?: string;
  connectionId?: string;
  payload: Record<string, unknown>;
  error?: string;
}

export interface WSClientMessage {
  type: string;
  id?: string;
  connectionId: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private baseDelay = 1000;
  private _isConnected = false;
  private pendingMessages: Array<Record<string, unknown>> = [];

  get isConnected() {
    return this._isConnected;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const url = `${protocol}//${window.location.host}${basePath}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[WS] Connected");
      this._isConnected = true;
      this.reconnectAttempts = 0;
      // Flush pending messages
      for (const msg of this.pendingMessages) {
        this.ws?.send(JSON.stringify(msg));
      }
      this.pendingMessages = [];
      this.emit("ws:connected", { type: "ws:connected", payload: {} });
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WSServerMessage = JSON.parse(event.data);
        this.emit(message.type, message);

        // Handle heartbeat ping
        if (message.type === "heartbeat:ping") {
          this.sendRaw({ type: "heartbeat:pong", payload: {} });
          return;
        }

        // Also emit to wildcard domain listeners
        const [domain] = message.type.split(":");
        this.emit(`${domain}:*`, message);
      } catch {
        console.error("[WS] Failed to parse message:", event.data);
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] Disconnected");
      this._isConnected = false;
      this.emit("ws:disconnected", { type: "ws:disconnected", payload: {} });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      console.warn("[WS] Connection error, will retry");
    };
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
    this.ws?.close();
    this.ws = null;
    this._isConnected = false;
    this.pendingMessages = [];
  }

  send(message: WSClientMessage) {
    console.log(`[WS] send: ${message.type} (connected: ${this._isConnected})`);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.log(`[WS] queued message: ${message.type}`);
      this.pendingMessages.push(message);
    }
  }

  private sendRaw(message: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.pendingMessages.push(message);
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  off(type: string, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, message: WSServerMessage) {
    this.handlers.get(type)?.forEach((handler) => {
      try { handler(message); } catch (e) { console.error(`[WS] Handler error for ${type}:`, e); }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[WS] Max reconnect attempts reached");
      return;
    }

    const delay = Math.min(this.baseDelay * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
}

// Singleton
export const wsClient = new WebSocketClient();
