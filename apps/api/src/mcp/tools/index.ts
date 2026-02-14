import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register all MCP tools with the server.
 * Slice 0: Only `haggle_ping` and `haggle_start_draft` (stub).
 * Subsequent slices add real tools.
 */
export function registerTools(server: McpServer) {
  // ─── haggle_ping ─────────────────────────────────────────
  // Test tool to verify MCP connectivity from ChatGPT.
  server.tool(
    "haggle_ping",
    "Health check tool. Returns server status and timestamp. Use this to verify the Haggle MCP server is connected and responding.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ok",
            message: "Haggle MCP server is connected!",
            timestamp: new Date().toISOString(),
            version: "0.1.0",
          }),
        },
      ],
    }),
  );

  // ─── haggle_start_draft (stub) ───────────────────────────
  // Stub for Slice 0 — returns a mock draft.
  // TODO(slice-1): Replace with real DB persistence via @haggle/db
  server.tool(
    "haggle_start_draft",
    "Start a new listing draft for selling an item. Returns a draft ID and empty draft object that can be filled in via haggle_apply_patch.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            draft_id: "00000000-0000-0000-0000-000000000000",
            draft: {
              status: "draft",
              title: null,
              category: null,
              brand: null,
              model: null,
              condition: null,
              description: null,
              target_price: null,
              floor_price: null,
            },
            message: "Draft created! Tell me about the item you want to sell.",
          }),
        },
      ],
    }),
  );

  // TODO(slice-2): Register haggle_apply_patch tool
  // TODO(slice-2): Register haggle_get_draft tool
  // TODO(slice-3): Register haggle_validate_draft tool
  // TODO(slice-3): Register haggle_publish_listing tool
  // TODO(slice-4): Register haggle_create_negotiation_session tool
  // TODO(slice-4): Register haggle_submit_offer tool
  // TODO(slice-5): Register haggle_claim tool
}
