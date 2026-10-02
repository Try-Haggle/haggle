#!/usr/bin/env tsx
/**
 * External agentic-buyer demo runner (HAGA-132).
 *
 * Connects to a Haggle MCP server with the official MCP SDK and a short-lived
 * OAuth 2.1 access token (listings + negotiate only), then runs:
 *   search -> start negotiation -> play_next -> play_until -> stop before payment.
 * Finally it attempts haggle_create_checkout with the same token and records the
 * scope denial. Every call/response goes to a masked JSON trace.
 *
 * Staging/local only. Never moves money. See scripts/demo/README.md.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { assertSafeTarget } from "./target-guard.ts";
import { maskTrace } from "./trace-mask.ts";

const MIN_SCOPES = "listings negotiate";
const LOOPBACK_PORT = Number(process.env.HAGGLE_OAUTH_PORT ?? 8976);

type TraceEntry = {
  step: string;
  at: string;
  request?: unknown;
  response?: unknown;
  note?: string;
};

function fail(message: string): never {
  console.error(`[agentic-buyer] ${message}`);
  process.exit(1);
}

function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Human-in-the-loop OAuth 2.1 (PKCE) — prints a consent URL and waits for the loopback redirect. */
async function obtainTokenViaOauth(apiBase: URL, trace: TraceEntry[], secrets: string[]) {
  const redirectUri = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;
  const regRes = await fetch(new URL("/oauth/register", apiBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Haggle agentic buyer demo",
      redirect_uris: [redirectUri],
    }),
  });
  const reg = (await regRes.json()) as { client_id?: string };
  trace.push({
    step: "oauth.register",
    at: new Date().toISOString(),
    response: { status: regRes.status, ...reg },
  });
  if (!reg.client_id) fail("OAuth client registration failed.");

  const { verifier, challenge } = pkcePair();
  secrets.push(verifier);
  const state = randomBytes(12).toString("hex");
  const authorize = new URL("/oauth/authorize", apiBase);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: MIN_SCOPES,
    state,
  }).toString();
  console.log(
    `\nOpen this URL, sign in as the demo BUYER and approve only "${MIN_SCOPES}":\n  ${authorize}\n`,
  );

  const code = await new Promise<string>((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${LOOPBACK_PORT}`);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res
        .writeHead(ok ? 200 : 400, { "content-type": "text/plain" })
        .end(ok ? "Haggle demo authorized. Close this tab." : "Invalid callback.");
      server.close();
      if (ok) resolveCode(u.searchParams.get("code") as string);
      else reject(new Error("OAuth callback state mismatch"));
    });
    server.listen(LOOPBACK_PORT, "127.0.0.1");
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth consent (5 min)."));
    }, 300_000).unref();
  });
  secrets.push(code);

  const tokRes = await fetch(new URL("/oauth/token", apiBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: reg.client_id,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tok = (await tokRes.json()) as { access_token?: string; scope?: string };
  if (tok.access_token) secrets.push(tok.access_token);
  trace.push({
    step: "oauth.token",
    at: new Date().toISOString(),
    response: { status: tokRes.status, ...tok },
  });
  if (!tok.access_token) fail("OAuth token exchange failed.");
  return tok.access_token;
}

function parseToolJson(result: unknown): Record<string, any> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return { raw: text };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let apiBase: URL;
  try {
    apiBase = assertSafeTarget(process.env.HAGGLE_API_URL ?? "");
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const query = arg("--query") ?? process.env.HAGGLE_DEMO_QUERY;
  const listingSlug = arg("--listing") ?? process.env.HAGGLE_DEMO_LISTING;
  const traceDir = resolve(arg("--trace-dir") ?? "output/agentic-buyer-demo");

  const trace: TraceEntry[] = [];
  const secrets: string[] = [];
  const startedAt = new Date().toISOString();
  let outcome: "passed" | "failed" = "failed";
  const summary: Record<string, unknown> = { target: apiBase.origin, startedAt };

  const writeTrace = async () => {
    await mkdir(traceDir, { recursive: true });
    const file = resolve(traceDir, `trace-${startedAt.replace(/[:.]/g, "-")}.json`);
    const body = maskTrace({ summary: { ...summary, outcome }, trace }, secrets);
    await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    console.log(`[agentic-buyer] masked trace: ${file}`);
  };

  try {
    let token = process.env.HAGGLE_MCP_TOKEN;
    if (token) secrets.push(token);
    else if (args.includes("--oauth")) token = await obtainTokenViaOauth(apiBase, trace, secrets);
    else fail("Set HAGGLE_MCP_TOKEN (short-lived listings+negotiate token) or pass --oauth.");

    const client = new Client({ name: "haggle-agentic-buyer-demo", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", apiBase), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    trace.push({
      step: "mcp.connect",
      at: new Date().toISOString(),
      response: { server: client.getServerVersion() },
    });

    const call = async (name: string, request: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: request });
      trace.push({ step: name, at: new Date().toISOString(), request, response });
      return { raw: response, json: parseToolJson(response), isError: Boolean(response.isError) };
    };

    // 1. whoami + search
    const who = await call("haggle_whoami", {});
    summary.grantedScopes = who.json.scopes ?? who.json.granted_scopes ?? null;
    const role = who.json.role;
    summary.role = typeof role === "string" ? role : null;
    // account boundary: only a regular (non-admin) user may run the demo; unknown role fails closed
    if (typeof role !== "string" || role.trim().toLowerCase() === "admin") {
      throw new Error(
        typeof role !== "string"
          ? "haggle_whoami returned no string role; refusing to continue (fail closed). Use a regular buyer account."
          : 'Token belongs to an "admin" account; refusing to continue. Use a regular buyer account.',
      );
    }
    const search = await call("haggle_search_listings", { q: query, limit: 5 });
    const listings: Array<{ public_id?: string; title?: string }> = search.json.listings ?? [];
    const slug = listingSlug ?? listings.find((l) => l.public_id)?.public_id;
    if (!slug) throw new Error("No listing found. Pass --listing <public_id> or --query.");
    summary.listing = slug;

    // 2. start negotiation (answer seller-required criteria generically)
    const listing = await call("haggle_get_listing", { public_id: slug });
    const required: Array<{ checkId: string }> = listing.json.required_criteria ?? [];
    const started = await call("haggle_start_negotiation", {
      public_id: slug,
      ...(required.length
        ? {
            buyerCriteria: required.map((r) => ({
              checkId: r.checkId,
              stance: "Demo buyer will provide verification.",
            })),
          }
        : {}),
    });
    const sessionId: string | undefined = started.json.session_id;
    if (!sessionId)
      throw new Error(`Negotiation did not start: ${JSON.stringify(started.json).slice(0, 300)}`);
    summary.sessionId = sessionId;

    // 3. advance
    await call("haggle_play_next", { session_id: sessionId });
    const until = await call("haggle_play_until", { session_id: sessionId, max_rounds: 8 });
    const state = await call("haggle_get_negotiation", { session_id: sessionId });
    const status = state.json.status ?? until.json.session_status ?? null;
    summary.finalStatus = status;
    summary.pausedForBuyer = Boolean(until.json.paused_for_buyer);

    // 4. scope boundary: never call checkout when the token already carries "orders"
    if (Array.isArray(summary.grantedScopes) && summary.grantedScopes.includes("orders")) {
      throw new Error(
        'Token carries the "orders" scope; refusing to call haggle_create_checkout. Use a listings+negotiate token.',
      );
    }
    // scope boundary: minimal token must NOT reach checkout
    const checkout = await call("haggle_create_checkout", { session_id: sessionId });
    const denied = checkout.isError && checkout.json.error === "INSUFFICIENT_SCOPE";
    summary.checkoutDenied = denied;
    if (!denied)
      throw new Error(
        "Expected INSUFFICIENT_SCOPE on haggle_create_checkout, got a different result.",
      );

    // 5. stop before payment: hand off to a human
    const appOrigin = new URL(String(started.json.chat_url ?? apiBase)).origin;
    const approvalUrl =
      status === "ACCEPTED"
        ? `${appOrigin}/buy/negotiations/${sessionId}/checkout`
        : (started.json.chat_url as string);
    summary.humanApprovalUrl = approvalUrl;
    console.log(
      status === "ACCEPTED"
        ? `\nAgreement reached. Stopping BEFORE payment. Human approval + wallet signing:\n  ${approvalUrl}\n`
        : `\nStatus ${status}. Not at payment. Human can review/answer here:\n  ${approvalUrl}\n`,
    );
    await client.close();
    outcome = "passed";
  } catch (error) {
    trace.push({
      step: "error",
      at: new Date().toISOString(),
      note: error instanceof Error ? error.message : String(error),
    });
    console.error(`[agentic-buyer] FAILED: ${error instanceof Error ? error.message : error}`);
  } finally {
    await writeTrace();
  }
  process.exit(outcome === "passed" ? 0 : 1);
}

main();
