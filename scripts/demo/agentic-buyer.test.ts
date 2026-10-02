import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { assertSafeTarget } from "./target-guard.ts";

const TOKEN = "demo-token-abcdef1234567890";

test("target guard rejects lookalike staging hosts", () => {
  assert.throws(() => assertSafeTarget("https://staging.evil.example.com"));
  assert.throws(() => assertSafeTarget("https://api.tryhaggle.ai.staging.evil.io"));
  assert.throws(() => assertSafeTarget("https://staging-api.example.net"));
});

test("target guard allows local/staging only", () => {
  assert.doesNotThrow(() => assertSafeTarget("http://localhost:3001"));
  assert.doesNotThrow(() => assertSafeTarget("https://api.staging.tryhaggle.ai"));
  assert.throws(() => assertSafeTarget("https://api.tryhaggle.ai"));
  assert.throws(() => assertSafeTarget("https://evil.example.com/staging"));
  assert.throws(() => assertSafeTarget("http://api.staging.tryhaggle.ai"));
  assert.throws(() => assertSafeTarget(""));
});

const checkoutCalls = { count: 0 };

function fakeServer(scopes: string[] = ["listings", "negotiate"]) {
  const server = new McpServer({ name: "fake-haggle", version: "0" });
  const json = (data: unknown, isError = false) => ({
    isError,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  server.tool("haggle_whoami", {}, async () =>
    json({ connected: true, scopes, email: "buyer@example.com" }),
  );
  server.tool(
    "haggle_search_listings",
    { q: z.string().optional(), limit: z.number().optional() },
    async () => json({ listings: [{ public_id: "abc123", title: "Phone" }] }),
  );
  server.tool("haggle_get_listing", { public_id: z.string() }, async () =>
    json({ required_criteria: [{ checkId: "imei_verification" }] }),
  );
  server.tool(
    "haggle_start_negotiation",
    { public_id: z.string(), buyerCriteria: z.array(z.any()).optional() },
    async () =>
      json({
        session_id: "11111111-1111-4111-8111-111111111111",
        chat_url:
          "https://app.staging.tryhaggle.ai/buy/negotiations/11111111-1111-4111-8111-111111111111",
      }),
  );
  server.tool("haggle_play_next", { session_id: z.string() }, async () =>
    json({ complete: false }),
  );
  server.tool(
    "haggle_play_until",
    { session_id: z.string(), max_rounds: z.number().optional() },
    async () => json({ complete: true, session_status: "ACCEPTED" }),
  );
  server.tool("haggle_get_negotiation", { session_id: z.string() }, async () =>
    json({ status: "ACCEPTED" }),
  );
  server.tool("haggle_create_checkout", { session_id: z.string() }, async () => {
    checkoutCalls.count += 1;
    return json(
      { error: "INSUFFICIENT_SCOPE", required: "orders", granted: ["listings", "negotiate"] },
      true,
    );
  });
  return server;
}

test("runner: search -> negotiate -> checkout denied, trace masked", async () => {
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await fakeServer().connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as AddressInfo).port;
  const dir = await mkdtemp(join(tmpdir(), "h132-"));
  const code = await new Promise<number>((resolve) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx", "scripts/demo/agentic-buyer.ts", "--trace-dir", dir],
      {
        env: {
          ...process.env,
          HAGGLE_API_URL: `http://127.0.0.1:${port}`,
          HAGGLE_MCP_TOKEN: TOKEN,
        },
      },
      () => undefined,
    );
    child.on("exit", (c) => resolve(c ?? 1));
  });
  http.close();
  assert.equal(code, 0);
  const [file] = await readdir(dir);
  const text = await readFile(join(dir, file), "utf8");
  assert.ok(text.includes("INSUFFICIENT_SCOPE"));
  assert.ok(text.includes("/checkout"));
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes("buyer@example.com"));
  assert.match(text, /"outcome": "passed"/);
});

test("runner: aborts before checkout when token carries orders scope", async () => {
  checkoutCalls.count = 0;
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await fakeServer(["listings", "negotiate", "orders"]).connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as AddressInfo).port;
  const dir = await mkdtemp(join(tmpdir(), "h136-"));
  const code = await new Promise<number>((resolve) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx", "scripts/demo/agentic-buyer.ts", "--trace-dir", dir],
      {
        env: {
          ...process.env,
          HAGGLE_API_URL: `http://127.0.0.1:${port}`,
          HAGGLE_MCP_TOKEN: TOKEN,
        },
      },
      () => undefined,
    );
    child.on("exit", (c) => resolve(c ?? 1));
  });
  http.close();
  assert.notEqual(code, 0);
  assert.equal(checkoutCalls.count, 0);
});
