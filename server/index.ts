import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { handleWebSocketConnection } from "./ws";
import type { IncomingMessage } from "http";
import { loadDotEnv } from "./load-env";

loadDotEnv();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);
const basePath = process.env.BASE_PATH || "";

const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Must be called after prepare()
  const nextUpgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const { pathname } = parse(request.url!, true);

    if (pathname === `${basePath}/ws`) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      // Forward HMR and other Next.js WebSocket upgrades
      nextUpgradeHandler(request, socket, head);
    }
  });

  wss.on("connection", handleWebSocketConnection);

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}${basePath}`);
    console.log(`> WebSocket server ready on ws://${hostname}:${port}${basePath}/ws`);
  });
});
