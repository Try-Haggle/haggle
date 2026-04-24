import dotenv from "dotenv";
import { resolve } from "node:path";

// Load .env from monorepo root, then local apps/api/.env (local overrides root)
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env") });
dotenv.config({ path: resolve(import.meta.dirname, "../.env") });

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const { createServer } = await import("./server.js");
  const server = await createServer();

  await server.listen({ port: PORT, host: HOST });
  server.log.info(`Haggle API server running on ${HOST}:${PORT}`);
  server.log.info(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
