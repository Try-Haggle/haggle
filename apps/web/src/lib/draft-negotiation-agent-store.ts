/**
 * localStorage CRUD for user-created agent profiles.
 *
 * Phase 5 will add server-side sync. For now this is the single source of truth
 * for custom agents; presets live in @haggle/shared/agent-stats.
 */

import type { NegotiationAgent } from "@haggle/shared";

const STORAGE_KEY = "haggle:agents:v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(): NegotiationAgent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidProfile);
  } catch {
    return [];
  }
}

function write(agents: NegotiationAgent[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  // Same-tab listeners (storage event only fires cross-tab in browsers).
  window.dispatchEvent(new CustomEvent(DRAFT_NEGOTIATION_AGENT_STORE_UPDATED_EVENT));
}

export const DRAFT_NEGOTIATION_AGENT_STORE_UPDATED_EVENT = "haggle:draft-negotiation-agent-store-updated";

function isValidProfile(x: unknown): x is NegotiationAgent {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string") return false;
  if (typeof p.createdAt !== "number" || typeof p.updatedAt !== "number") {
    return false;
  }
  // At least one strategy shape must be present.
  const hasStats = typeof p.stats === "object" && p.stats !== null;
  const hasNewFlow =
    typeof p.negotiationAgentPresetId === "string" ||
    typeof p.weights === "object" ||
    typeof p.engineParams === "object" ||
    typeof p.categoryAnswers === "object";
  return hasStats || hasNewFlow;
}

function uid(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const draftNegotiationAgentStore = {
  list(): NegotiationAgent[] {
    return read().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  get(id: string): NegotiationAgent | undefined {
    return read().find((a) => a.id === id);
  },

  create(
    input: Omit<NegotiationAgent, "id" | "createdAt" | "updatedAt">,
  ): NegotiationAgent {
    const now = Date.now();
    const agent: NegotiationAgent = {
      ...input,
      id: uid(),
      createdAt: now,
      updatedAt: now,
    };
    write([...read(), agent]);
    return agent;
  },

  update(
    id: string,
    patch: Partial<Omit<NegotiationAgent, "id" | "createdAt">>,
  ): NegotiationAgent | undefined {
    const agents = read();
    const idx = agents.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const updated: NegotiationAgent = {
      ...agents[idx],
      ...patch,
      updatedAt: Date.now(),
    };
    agents[idx] = updated;
    write(agents);
    return updated;
  },

  delete(id: string): boolean {
    const agents = read();
    const filtered = agents.filter((a) => a.id !== id);
    if (filtered.length === agents.length) return false;
    write(filtered);
    return true;
  },

  clear(): void {
    write([]);
  },
};
