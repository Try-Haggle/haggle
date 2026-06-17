/**
 * Frontend client for the production `/negotiations/agents` API.
 *
 * Used by Seller new/edit/list pages, by Buyer's /buy/agents pages, and by the
 * post-signup claim flow that migrates locally-drafted agents into DB-owned
 * rows. `draftNegotiationAgentStore` (localStorage) survives as a "Save not
 * yet clicked" buffer; once Save lands, the agent is persisted via this API.
 */

import type {
  NegotiationAgent,
  NegotiationAgentPresetId,
  NegotiationWeights,
} from "@haggle/shared";
import { api } from "./api-client";

/** Roles surfaced on /buy/agents vs /sell/agents. */
export type NegotiationAgentRole = "buyer" | "seller" | "both";

/** Fields persisted inside `negotiation_agents.negotiation_agent_config`. */
export interface NegotiationAgentConfig {
  emoji?: string;
  basePresetId?: string;
  negotiationAgentPresetId?: NegotiationAgentPresetId;
  weights?: NegotiationWeights;
  engineParams?: Record<string, unknown>;
  categoryAnswers?: Record<string, Record<string, unknown>>;
  voiceId?: string;
  /** Loose shape — typed `NegotiationAgentBuilderMemory` survives JSON. */
  builderChatMemory?: Record<string, unknown> | unknown;
  stats?: Record<string, number>;
}

/** Raw row shape returned by GET /negotiations/agents. */
export interface NegotiationAgentRow {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  role: NegotiationAgentRole;
  isSystem: boolean;
  userId: string | null;
  negotiationAgentConfig: NegotiationAgentConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNegotiationAgentInput {
  name: string;
  description?: string;
  role?: NegotiationAgentRole;
  config?: NegotiationAgentConfig;
}

export interface UpdateNegotiationAgentInput {
  name?: string;
  description?: string;
  role?: NegotiationAgentRole;
  config?: NegotiationAgentConfig;
}

/**
 * List system presets + the authenticated user's custom agents, optionally
 * filtered by role. `any` returns all roles; the API defaults to it.
 */
export async function listNegotiationAgents(
  role: NegotiationAgentRole | "any" = "any",
): Promise<NegotiationAgentRow[]> {
  const data = await api.get<{ agents: NegotiationAgentRow[] }>(
    `/negotiations/agents?role=${role}`,
  );
  return data.agents ?? [];
}

export async function getNegotiationAgent(id: string): Promise<NegotiationAgentRow | null> {
  try {
    const data = await api.get<{ agent: NegotiationAgentRow }>(`/negotiations/agents/${id}`);
    return data.agent ?? null;
  } catch {
    return null;
  }
}

export async function createNegotiationAgent(
  input: CreateNegotiationAgentInput,
): Promise<NegotiationAgentRow> {
  const data = await api.post<{ agent: NegotiationAgentRow }>("/negotiations/agents", input);
  return data.agent;
}

export async function updateNegotiationAgent(
  id: string,
  input: UpdateNegotiationAgentInput,
): Promise<NegotiationAgentRow> {
  const data = await api.patch<{ agent: NegotiationAgentRow }>(`/negotiations/agents/${id}`, input);
  return data.agent;
}

export async function deleteNegotiationAgent(id: string): Promise<void> {
  await api.delete(`/negotiations/agents/${id}`);
}

/** Convert a DB row to the in-memory `NegotiationAgent` shape used by the
 *  builder UI. The inverse of `negotiationAgentToCreateInput`. */
export function rowToNegotiationAgent(row: NegotiationAgentRow): NegotiationAgent {
  const cfg = row.negotiationAgentConfig ?? {};
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    emoji: cfg.emoji,
    role: row.role,
    basePresetId: cfg.basePresetId,
    stats: cfg.stats as NegotiationAgent["stats"] | undefined,
    negotiationAgentPresetId: cfg.negotiationAgentPresetId,
    weights: cfg.weights,
    engineParams: cfg.engineParams as NegotiationAgent["engineParams"],
    categoryAnswers: cfg.categoryAnswers,
    voiceId: cfg.voiceId,
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt).getTime(),
  };
}
