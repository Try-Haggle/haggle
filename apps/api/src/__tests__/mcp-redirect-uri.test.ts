import { describe, expect, it } from "vitest";
import { isSafeMcpRedirectUri } from "../lib/mcp-redirect-uri.js";

describe("MCP redirect URIs", () => {
  it("allows https callbacks and loopback http only", () => {
    expect(isSafeMcpRedirectUri("https://grok.x.ai/callback")).toBe(true);
    expect(isSafeMcpRedirectUri("http://localhost:6274/callback")).toBe(true);
    expect(isSafeMcpRedirectUri("http://127.0.0.1:3000/cb")).toBe(true);
    expect(isSafeMcpRedirectUri("http://[::1]/cb")).toBe(true);
  });

  it("rejects phishing or non-loopback http redirects", () => {
    expect(isSafeMcpRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isSafeMcpRedirectUri("http://192.168.1.10/cb")).toBe(false);
    expect(isSafeMcpRedirectUri("https://user:pass@grok.x.ai/cb")).toBe(false);
    expect(isSafeMcpRedirectUri("https://grok.x.ai/cb#frag")).toBe(false);
    expect(isSafeMcpRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isSafeMcpRedirectUri("data:text/html,hi")).toBe(false);
  });
});
