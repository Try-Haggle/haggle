/**
 * POST /tools/dogfood-auth/session — staging/local dogfood persona mint (Eng1 T1).
 * SoT: docs/wip/dogfood-auth-sot.md
 *
 * Fail-closed outside staging/local or without HAGGLE_DOGFOOD_AUTH_SECRET (≥32 bytes).
 * Secret via header only; never echoed. BFF-only (no NEXT_PUBLIC).
 * Does not enable supabase-jwt test_unverified.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { Database } from "@haggle/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DOGFOOD_SECRET_HEADER,
  isDogfoodAuthRouteEnabled,
  isDogfoodPersona,
  readDogfoodAuthSecret,
} from "../lib/dogfood-auth-gate.js";
import { dogfoodAuthRateLimit } from "../middleware/rate-limit.js";
import { mintDogfoodWebSession } from "../services/dogfood-auth.service.js";

const bodySchema = z.object({
  persona: z.enum(["buyer", "seller"]),
});

function secretsMatch(expected: string, received: string): boolean {
  // Fixed-length digests so comparison is constant-time regardless of input length.
  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(received, "utf8").digest();
  return timingSafeEqual(a, b);
}

function readSecretHeader(request: FastifyRequest): string | null {
  const raw = request.headers[DOGFOOD_SECRET_HEADER];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].length > 0) return raw[0];
  return null;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "NOT_FOUND", message: "Not found" });
}

export function registerDogfoodAuthRoutes(app: FastifyInstance, _db: Database) {
  app.post(
    "/tools/dogfood-auth/session",
    { preHandler: [dogfoodAuthRateLimit] },
    async (request, reply) => {
      // Fail-closed: production or missing/short secret → 404 (route inactive).
      if (!isDogfoodAuthRouteEnabled()) {
        return notFound(reply);
      }

      const expected = readDogfoodAuthSecret();
      if (!expected) {
        return notFound(reply);
      }

      const received = readSecretHeader(request);
      if (!received || !secretsMatch(expected, received)) {
        // No secret leak in body.
        return reply.code(401).send({
          error: "DOGFOOD_AUTH_UNAUTHORIZED",
          message: "Invalid or missing dogfood secret",
        });
      }

      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success || !isDogfoodPersona(parsed.data.persona)) {
        return reply.code(400).send({
          error: "INVALID_PERSONA",
          message: 'persona must be "buyer" or "seller"',
        });
      }

      const persona = parsed.data.persona;

      try {
        const session = await mintDogfoodWebSession(persona);
        // Never echo the dogfood secret. Tokens are response-only for BFF → web setSession.
        return reply.code(200).send({
          ok: true,
          persona: session.persona,
          user_id: session.user_id,
          handle: session.handle,
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          expires_in: session.expires_in,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "DOGFOOD_SESSION_MINT_FAILED";
        // Do not log tokens/secret. Bounded error code only.
        request.log.warn(
          { event: "dogfood_auth_mint_failed", code },
          "dogfood session mint failed",
        );
        if (code === "DOGFOOD_AUTH_MISCONFIGURED") {
          return reply.code(503).send({
            error: "DOGFOOD_AUTH_MISCONFIGURED",
            message: "Dogfood auth is not configured",
          });
        }
        return reply.code(502).send({
          error: "DOGFOOD_SESSION_MINT_FAILED",
          message: "Could not mint dogfood session",
        });
      }
    },
  );
}
