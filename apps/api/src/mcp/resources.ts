import { readFileSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

export const LISTING_RESOURCE_URI = "ui://haggle/listing.html";

/**
 * Register MCP App Resources (HTML widgets rendered in host iframes).
 * The widget HTML is built by Vite (widget/dist/index.html) and read at server startup.
 */
export function registerResources(server: McpServer) {
  const htmlPath = path.join(
    import.meta.dirname,
    "../../widget/dist/index.html",
  );
  const html = readFileSync(htmlPath, "utf-8");

  registerAppResource(
    server,
    "listing-widget",
    LISTING_RESOURCE_URI,
    {
      description:
        "Listing draft wizard — Item Details and Pricing steps for sellers",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: LISTING_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
        },
      ],
    }),
  );
}
