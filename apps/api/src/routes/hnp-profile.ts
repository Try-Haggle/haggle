import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHnpProfile } from "@haggle/engine-session";
import { defaultAttemptControlPolicy } from "../services/attempt-control.service.js";

export function registerHnpProfileRoutes(app: FastifyInstance) {
  app.get("/.well-known/hnp", async (request) => {
    const baseUrl = publicBaseUrl(request);
    const policy = defaultAttemptControlPolicy();
    const jwksUri = process.env.HNP_JWKS_URI?.trim();
    const supportsDetachedJws = Boolean(process.env.HNP_TRUSTED_JWKS?.trim());

    const profile = createHnpProfile({
      endpoint: `${baseUrl}/negotiations`,
      transports: [
        { name: "rest", endpoint: `${baseUrl}/negotiations` },
        { name: "mcp", endpoint: `${baseUrl}/mcp` },
      ],
      capabilities: {
        "ai.haggle.policy.attempt-control": {
          versions: ["1.0.0"],
          required: false,
          description: "Buyer/listing anti-probing quotas and session round limits.",
        },
      },
      issue_namespaces: ["hnp.issue", "com.haggle.issue"],
      signature_algorithms: supportsDetachedJws ? ["RS256", "PS256"] : [],
      settlement_modes: ["manual", "escrow"],
      auth: {
        schemes: supportsDetachedJws ? ["bearer", "jws-detached"] : ["bearer"],
        ...(jwksUri ? { jwks_uri: jwksUri } : {}),
      },
      agent_profile: {
        agent_id: process.env.HNP_AGENT_ID || "haggle-api",
        display_name: process.env.HNP_AGENT_DISPLAY_NAME || "Haggle API",
        roles: ["BUYER", "SELLER"],
        transports: ["rest", "mcp"],
        supports_async_sessions: true,
        supports_streaming: false,
        supports_human_approval: true,
      },
    });

    return {
      hnp: {
        ...profile.hnp,
        issue_namespaces: ["hnp.issue", "com.haggle.issue"],
        signature_algorithms: supportsDetachedJws ? ["RS256", "PS256"] : [],
        settlement_modes: ["manual", "escrow"],
        policy_defaults: {
          attempt_control: {
            scope: "buyer_per_listing",
            max_concurrent_sessions: policy.maxConcurrentSessions,
            max_sessions_per_window: policy.maxSessionsPerWindow,
            window_seconds: policy.windowSeconds,
            cooldown_seconds: policy.cooldownSeconds,
            max_rounds_per_session: policy.maxRoundsPerSession,
            marketplace_daily_attempts: policy.marketplaceDailyAttempts,
          },
        },
      },
    };
  });
}

function publicBaseUrl(request: FastifyRequest): string {
  const configured = process.env.HNP_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${request.protocol}://${request.hostname}`;
}
