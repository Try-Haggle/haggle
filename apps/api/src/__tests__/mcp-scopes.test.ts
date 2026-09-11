import { describe, expect, it } from "vitest";
import { actorHasScope, effectiveMcpScopes } from "../lib/mcp-scopes.js";

describe("MCP OAuth scopes", () => {
  it("does not let an MCP token use tools outside its grant", () => {
    const actor = {
      id: "user-1",
      role: "user",
      tokenKind: "mcp" as const,
      scopes: ["listings"],
    };
    expect(actorHasScope(actor, "listings")).toBe(true);
    expect(actorHasScope(actor, "negotiate")).toBe(false);
    expect(actorHasScope(actor, "disputes")).toBe(false);
    expect(effectiveMcpScopes(actor)).toEqual(["listings"]);
  });

  it("gives first-party JWT the same access as the web app", () => {
    const actor = { id: "user-1", role: "user", tokenKind: "jwt" as const };
    expect(actorHasScope(actor, "disputes")).toBe(true);
    expect(effectiveMcpScopes(actor)).toContain("negotiate");
  });

  it("treats a missing MCP scope list as empty, not as full access", () => {
    const actor = { id: "user-1", role: "user", tokenKind: "mcp" as const };
    expect(actorHasScope(actor, "agents")).toBe(false);
    expect(effectiveMcpScopes(actor)).toEqual([]);
  });
});
