import type { AuthUser } from "../middleware/auth.js";

export interface SessionAccessView {
  buyerId: string;
  sellerId: string;
}

export interface AgentDelegation {
  principal_user_id: string;
  agent_id: string;
  scopes: string[];
  expires_at_ms: number;
  delegation_id?: string;
}

export type SessionWriteAccessInput = {
  senderRole: "BUYER" | "SELLER";
  senderAgentId?: string;
  agentDelegation?: AgentDelegation;
  action?: "offer" | "accept";
  nowMs?: number;
};

export type SessionWriteAccessResult =
  | { ok: true }
  | {
      ok: false;
      status: 403;
      error:
        | "SESSION_ACTOR_MISMATCH"
        | "HNP_SENDER_AGENT_MISMATCH"
        | "HNP_AGENT_DELEGATION_INVALID";
    };

export function validateSessionParticipant(
  actor: AuthUser,
  session: SessionAccessView,
): { ok: true } | { ok: false; status: 403; error: "SESSION_ACTOR_MISMATCH" } {
  if (actor.role === "admin") return { ok: true };
  if (actor.id === session.buyerId || actor.id === session.sellerId) return { ok: true };
  return { ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" };
}

export function validateSessionWriteAccess(
  actor: AuthUser,
  session: SessionAccessView,
  input: SessionWriteAccessInput,
): SessionWriteAccessResult {
  if (actor.role === "admin") return { ok: true };
  const principalId = input.senderRole === "BUYER" ? session.buyerId : session.sellerId;
  if (actor.id !== principalId) {
    return { ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" };
  }
  if (!input.senderAgentId || input.senderAgentId === actor.id) return { ok: true };

  if (
    isValidAgentDelegation(input.agentDelegation, {
      principalUserId: actor.id,
      agentId: input.senderAgentId,
      action: input.action ?? "offer",
      nowMs: input.nowMs ?? Date.now(),
    })
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    error: input.agentDelegation ? "HNP_AGENT_DELEGATION_INVALID" : "HNP_SENDER_AGENT_MISMATCH",
  };
}

export function isValidAgentDelegation(
  delegation: AgentDelegation | undefined,
  expected: {
    principalUserId: string;
    agentId: string;
    action: "offer" | "accept";
    nowMs: number;
  },
): boolean {
  if (!delegation) return false;
  if (delegation.principal_user_id !== expected.principalUserId) return false;
  if (delegation.agent_id !== expected.agentId) return false;
  if (delegation.expires_at_ms <= expected.nowMs) return false;
  return (
    delegation.scopes.includes("hnp:negotiate") ||
    delegation.scopes.includes(`hnp:${expected.action}`)
  );
}
