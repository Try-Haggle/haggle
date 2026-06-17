import { api } from "./api-client";
import type { NegotiationAgentBuilderMemory } from "./negotiation-agent-builder-types";

export type StoredMemoryCard = {
  id: string;
  user_id: string;
  card_type: string;
  memory_key: string;
  summary: string;
  memory: Record<string, unknown>;
  strength: string;
  version: number;
  updated_at: string;
};

export type SaveNegotiationAgentBuilderMemoryResponse = {
  user_id: string;
  session_id: string;
  source_message_id: string;
  signals: {
    extracted: number;
    inserted: number;
  };
  memory_cards: StoredMemoryCard[];
};

export async function saveNegotiationAgentBuilderMemoryForCurrentUser(params: {
  sessionId?: string;
  agentId?: string;
  message: string;
  memory: NegotiationAgentBuilderMemory;
}): Promise<SaveNegotiationAgentBuilderMemoryResponse> {
  return api.post<SaveNegotiationAgentBuilderMemoryResponse>(
    "/intelligence/negotiation-agent-builder-memory",
    {
      session_id: params.sessionId,
      agent_id: params.agentId,
      message: params.message,
      memory: params.memory,
    },
  );
}
