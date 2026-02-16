import "dotenv/config";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const server = await createServer();

  await server.listen({ port: PORT, host: HOST });
  server.log.info(`Haggle API server running on ${HOST}:${PORT}`);
  server.log.info(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
