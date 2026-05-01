import { sql, type Database } from "@haggle/db";
import {
  createEverOSClientFromEnv,
  type EverOSClient,
  type EverOSMemoryType,
  type EverOSRetrieveMethod,
} from "./everos-client.service.js";
import type { UserMemoryBrief } from "./user-memory-card.service.js";

export type EvermemoBriefItemSource = "everos_profile" | "everos_episode" | "everos_agent_memory";

export interface EvermemoBriefItem {
  source: EvermemoBriefItemSource;
  summary: string;
  score?: number;
  memoryType?: string;
  metadata?: Record<string, unknown>;
}

export interface EvermemoBrief {
  userId: string;
  provider: "everos";
  items: EvermemoBriefItem[];
}

export interface LoadEvermemoBriefInput {
  userId?: string;
  query: string;
  topK?: number;
  method?: EverOSRetrieveMethod;
  memoryTypes?: EverOSMemoryType[];
  requireEligibility?: boolean;
}

export interface LoadEvermemoBriefOptions {
  client?: EverOSClient | null;
}

export interface SyncUserMemoryBriefToEverOSInput {
  brief: UserMemoryBrief | null;
  sessionId?: string;
  asyncMode?: boolean;
}

export async function loadEvermemoBrief(
  db: Database,
  input: LoadEvermemoBriefInput,
  options: LoadEvermemoBriefOptions = {},
): Promise<EvermemoBrief | null> {
  if (!input.userId) return null;

  const client = options.client ?? createEverOSClientFromEnv();
  if (!client) return null;

  const requireEligibility = input.requireEligibility ?? process.env.EVEROS_REQUIRE_ELIGIBILITY !== "false";
  if (requireEligibility) {
    const eligible = await isCurrentlyEvermemoEligible(db, input.userId);
    if (!eligible) return null;
  }

  try {
    const response = await client.searchMemories({
      userId: input.userId,
      query: truncate(input.query, 800),
      method: input.method ?? "hybrid",
      memoryTypes: input.memoryTypes ?? ["profile", "episodic_memory"],
      topK: Math.max(1, Math.min(input.topK ?? 5, 12)),
    });
    const items = normalizeEverOSSearchResponse(response).slice(0, input.topK ?? 5);
    if (items.length === 0) return null;
    return { userId: input.userId, provider: "everos", items };
  } catch (err) {
    console.warn("[evermemo-bridge] EverOS retrieval failed:", (err as Error).message);
    return null;
  }
}

export async function syncUserMemoryBriefToEverOS(
  input: SyncUserMemoryBriefToEverOSInput,
  options: LoadEvermemoBriefOptions = {},
): Promise<{ synced: boolean; messageCount: number }> {
  const brief = input.brief;
  if (!brief || brief.items.length === 0) return { synced: false, messageCount: 0 };

  const client = options.client ?? createEverOSClientFromEnv();
  if (!client) return { synced: false, messageCount: 0 };

  const messages = brief.items.slice(0, 12).map((item) => ({
    role: "system",
    timestamp: Date.now(),
    content: [
      "Haggle Intelligence Layer memory card",
      `card_type: ${item.cardType}`,
      `memory_key: ${item.memoryKey}`,
      `summary: ${item.summary}`,
      `strength: ${item.strength.toFixed(2)}`,
      `structured_memory: ${JSON.stringify(item.memory)}`,
      `evidence_refs: ${item.evidenceRefs.join(",")}`,
      "raw_text: unavailable",
    ].join("\n"),
  }));

  try {
    await client.addPersonalMemories({
      userId: brief.userId,
      sessionId: input.sessionId,
      asyncMode: input.asyncMode ?? true,
      messages,
    });
    return { synced: true, messageCount: messages.length };
  } catch (err) {
    console.warn("[evermemo-bridge] EverOS sync failed:", (err as Error).message);
    return { synced: false, messageCount: messages.length };
  }
}

export function formatEvermemoBriefSignals(brief?: EvermemoBrief | null): string[] {
  if (!brief || brief.items.length === 0) return [];

  return [
    "EVEROS_MEMORY_HINTS:non_authoritative",
    ...brief.items.map((item) => {
      const score = typeof item.score === "number" ? `|score:${item.score.toFixed(2)}` : "";
      return `EVEROS:${item.source}:${truncate(singleLine(item.summary), 180)}${score}`;
    }),
  ];
}

async function isCurrentlyEvermemoEligible(db: Database, userId: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT eligible
      FROM memory_eligibility_snapshots
      WHERE user_id = ${userId}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY evaluated_at DESC
      LIMIT 1
    `);
    const row = rowsFromResult(result)[0];
    return row?.eligible === true;
  } catch (err) {
    console.warn("[evermemo-bridge] eligibility lookup failed:", (err as Error).message);
    return false;
  }
}

function normalizeEverOSSearchResponse(response: Record<string, unknown>): EvermemoBriefItem[] {
  const data = isRecord(response.data) ? response.data : {};
  const items: EvermemoBriefItem[] = [];

  for (const profile of asRecords(data.profiles)) {
    const summary = textFrom(profile.description)
      ?? textFrom(profile.trait_name)
      ?? textFrom(profile.category);
    if (!summary) continue;
    items.push({
      source: "everos_profile",
      summary,
      score: numberFrom(profile.score),
      memoryType: "profile",
      metadata: pickMetadata(profile, ["category", "item_type", "trait_name"]),
    });
  }

  for (const episode of asRecords(data.episodes)) {
    const summary = textFrom(episode.summary)
      ?? textFrom(episode.content)
      ?? textFrom(episode.text);
    if (!summary) continue;
    items.push({
      source: "everos_episode",
      summary,
      score: numberFrom(episode.score),
      memoryType: "episodic_memory",
      metadata: pickMetadata(episode, ["timestamp", "session_id", "group_id"]),
    });
  }

  const agentMemory = isRecord(data.agent_memory) ? data.agent_memory : {};
  for (const entry of [...asRecords(agentMemory.cases), ...asRecords(agentMemory.skills)]) {
    const summary = textFrom(entry.summary)
      ?? textFrom(entry.description)
      ?? textFrom(entry.title);
    if (!summary) continue;
    items.push({
      source: "everos_agent_memory",
      summary,
      score: numberFrom(entry.score),
      memoryType: "agent_memory",
      metadata: pickMetadata(entry, ["skill_id", "case_id", "title"]),
    });
  }

  return items;
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickMetadata(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
