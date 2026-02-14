import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerMcpRoutes } from "./mcp/router.js";

export async function createServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // ─── CORS ────────────────────────────────────────────────
  // ChatGPT requires these origins to connect to the MCP server.
  await app.register(cors, {
    origin: [
      "https://chatgpt.com",
      "https://chat.openai.com",
      /^http:\/\/localhost:\d+$/,
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id"],
    credentials: true,
  });

  // ─── Health Check ────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // ─── MCP Routes ──────────────────────────────────────────
  registerMcpRoutes(app);

  // TODO(slice-1): Register REST API routes for Embedded UI direct calls
  // TODO(post-mvp): Register WebSocket handler for real-time updates

  return app;
}
