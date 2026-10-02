import { mcpConnectHint } from "../../routes/mcp-oauth.js";

export function mcpJson(data: unknown, isError = false) {
  return {
    isError,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function mcpAuthRequired() {
  return mcpJson({ error: "AUTH_REQUIRED", ...mcpConnectHint() }, true);
}

export function mcpError(error: string, extra?: Record<string, unknown>) {
  return mcpJson({ error, ...extra }, true);
}

export type McpImageBlock = { type: "image"; data: string; mimeType: string };

/** Text JSON first, then optional image content blocks. Image failures never affect the text. */
export function mcpJsonWithImages(data: unknown, images: McpImageBlock[]) {
  const base = mcpJson(data);
  return { ...base, content: [...base.content, ...images] };
}
