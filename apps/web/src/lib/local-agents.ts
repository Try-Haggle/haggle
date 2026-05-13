/**
 * localStorage CRUD for user-created agent profiles.
 *
 * Phase 5 will add server-side sync. For now this is the single source of truth
 * for custom agents; presets live in @haggle/shared/agent-stats.
 */

import type { AgentProfile } from "@haggle/shared";

const STORAGE_KEY = "haggle:agents:v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(): AgentProfile[] {
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

function write(agents: AgentProfile[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  // Same-tab listeners (storage event only fires cross-tab in browsers).
  window.dispatchEvent(new CustomEvent(LOCAL_AGENTS_UPDATED_EVENT));
}

export const LOCAL_AGENTS_UPDATED_EVENT = "haggle:local-agents-updated";

function isValidProfile(x: unknown): x is AgentProfile {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string") return false;
  if (typeof p.createdAt !== "number" || typeof p.updatedAt !== "number") {
    return false;
  }
  // At least one strategy shape must be present.
  const hasStats = typeof p.stats === "object" && p.stats !== null;
  const hasNewFlow =
    typeof p.negotiationPresetId === "string" ||
    typeof p.weights === "object" ||
    typeof p.engineParams === "object" ||
    typeof p.categoryAnswers === "object";
  return hasStats || hasNewFlow;
}

function uid(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const localAgents = {
  list(): AgentProfile[] {
    return read().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  get(id: string): AgentProfile | undefined {
    return read().find((a) => a.id === id);
  },

  create(
    input: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">,
  ): AgentProfile {
    const now = Date.now();
    const agent: AgentProfile = {
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
    patch: Partial<Omit<AgentProfile, "id" | "createdAt">>,
  ): AgentProfile | undefined {
    const agents = read();
    const idx = agents.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const updated: AgentProfile = {
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
