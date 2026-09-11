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
