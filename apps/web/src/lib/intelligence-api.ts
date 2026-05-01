import { api } from "./api-client";
import type { AdvisorMemory } from "./advisor-demo-types";

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

export type SaveAdvisorMemoryResponse = {
  user_id: string;
  session_id: string;
  source_message_id: string;
  signals: {
    extracted: number;
    inserted: number;
  };
  memory_cards: StoredMemoryCard[];
};

export async function saveAdvisorMemoryForCurrentUser(params: {
  sessionId?: string;
  agentId?: string;
  message: string;
  memory: AdvisorMemory;
}): Promise<SaveAdvisorMemoryResponse> {
  return api.post<SaveAdvisorMemoryResponse>(
    "/intelligence/advisor-memory",
    {
      session_id: params.sessionId,
      agent_id: params.agentId,
      message: params.message,
      memory: params.memory,
    },
  );
}
