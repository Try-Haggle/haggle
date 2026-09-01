import { describe, expect, it } from "vitest";
import { createMcpTransportBinding, mcpTransportOwnerMismatch } from "../lib/mcp-transport-auth.js";

const userA = { id: "user-a", role: "user" };
const userB = { id: "user-b", role: "user" };
const tokenA = `Bearer ${"a".repeat(32)}`;
const tokenB = `Bearer ${"b".repeat(32)}`;

describe("MCP transport binding", () => {
  it("binds a session to the caller and rejects a stolen session id", () => {
    const binding = createMcpTransportBinding(userA, tokenA);
    expect(binding?.userId).toBe("user-a");
    expect(mcpTransportOwnerMismatch(binding!, undefined, undefined)).toBe(true);
    expect(mcpTransportOwnerMismatch(binding!, userB, tokenB)).toBe(true);
    expect(mcpTransportOwnerMismatch(binding!, userA, tokenB)).toBe(true);
    expect(mcpTransportOwnerMismatch(binding!, userA, tokenA)).toBe(false);
  });

  it("refuses to open a transport session without a bearer token", () => {
    expect(createMcpTransportBinding(userA, undefined)).toBeNull();
    expect(createMcpTransportBinding(undefined, tokenA)).toBeNull();
  });
});
