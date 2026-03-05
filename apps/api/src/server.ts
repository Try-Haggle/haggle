import Fastify from "fastify";
import cors from "@fastify/cors";
import { createDb } from "@haggle/db";
import { registerMcpRoutes } from "./mcp/router.js";
import { registerDraftRoutes } from "./routes/index.js";

export async function createServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // ─── Database ──────────────────────────────────────────────
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const db = createDb(databaseUrl);

  // ─── CORS ────────────────────────────────────────────────
  // ChatGPT + Vercel widget origins.
  await app.register(cors, {
    origin: [
      "https://chatgpt.com",
      "https://chat.openai.com",
      /\.vercel\.app$/,
      "https://tryhaggle.ai",
      /^http:\/\/localhost:\d+$/,
    ],
    methods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id"],
    credentials: true,
  });

  // ─── Health Check ────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // ─── MCP Routes ──────────────────────────────────────────
  registerMcpRoutes(app, db);

  // ─── REST API Routes ─────────────────────────────────────
  registerDraftRoutes(app, db);

  // TODO(post-mvp): Register WebSocket handler for real-time updates

  return app;
}
