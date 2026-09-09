import { NextResponse } from "next/server";
import {
  type DogfoodPersona,
  isDogfoodAuthBffEnabled,
  isDogfoodAuthProductionClosed,
  isDogfoodPersona,
  readDogfoodAuthSecret,
} from "@/lib/dogfood-auth-gate";
import {
  isUpstreamDogfoodStubStatus,
  parseDogfoodSessionTokens,
  T1_API_NOT_LIVE_CODE,
  T1_API_NOT_LIVE_MESSAGE,
} from "@/lib/dogfood-auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.tryhaggle.ai";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

/**
 * Staging/local BFF: mint dogfood session via upstream API.
 * Browser never receives HAGGLE_DOGFOOD_AUTH_SECRET (server-only header).
 */
export async function POST(request: Request) {
  // Fail-closed on prod even if a secret is misconfigured.
  if (isDogfoodAuthProductionClosed() || !isDogfoodAuthBffEnabled()) {
    return jsonError(404, "NOT_FOUND", "Not found");
  }

  const secret = readDogfoodAuthSecret();
  if (!secret) {
    return jsonError(404, "NOT_FOUND", "Not found");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Expected JSON body with persona");
  }

  const persona = (body as { persona?: unknown })?.persona;
  if (!isDogfoodPersona(persona)) {
    return jsonError(400, "INVALID_PERSONA", 'persona must be "buyer" or "seller"');
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/tools/dogfood-auth/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Haggle-Dogfood-Secret": secret,
      },
      body: JSON.stringify({ persona: persona as DogfoodPersona }),
      cache: "no-store",
    });
  } catch {
    return jsonError(502, "UPSTREAM_UNREACHABLE", "Could not reach dogfood auth API");
  }

  // Never invent tokens when T1 is not deployed yet.
  if (isUpstreamDogfoodStubStatus(upstream.status)) {
    return jsonError(503, T1_API_NOT_LIVE_CODE, T1_API_NOT_LIVE_MESSAGE);
  }

  const upstreamText = await upstream.text();
  let upstreamJson: unknown = null;
  if (upstreamText) {
    try {
      upstreamJson = JSON.parse(upstreamText) as unknown;
    } catch {
      upstreamJson = null;
    }
  }

  if (!upstream.ok) {
    const record =
      upstreamJson && typeof upstreamJson === "object"
        ? (upstreamJson as Record<string, unknown>)
        : null;
    const error =
      (typeof record?.error === "string" && record.error) || `UPSTREAM_${upstream.status}`;
    const message =
      (typeof record?.message === "string" && record.message) || "Dogfood session mint failed";
    // Do not forward secret-bearing fields; only error metadata.
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    return jsonError(status, error, message);
  }

  const tokens = parseDogfoodSessionTokens(upstreamJson);
  if (!tokens) {
    return jsonError(
      502,
      "INVALID_UPSTREAM_SESSION",
      "Upstream did not return a usable web session",
    );
  }

  // Short-TTL session tokens only — never echo the dogfood secret.
  return NextResponse.json({
    ok: true,
    persona: tokens.persona ?? persona,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    expires_in: tokens.expires_in,
  });
}

/** Prod/staging gate for GET probes — always 404 when closed. */
export async function GET() {
  if (isDogfoodAuthProductionClosed() || !isDogfoodAuthBffEnabled()) {
    return jsonError(404, "NOT_FOUND", "Not found");
  }
  return jsonError(405, "METHOD_NOT_ALLOWED", "Use POST");
}
