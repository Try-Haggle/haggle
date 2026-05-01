import { sql, type Database } from "@haggle/db";

export type TagGardenSignalAction =
  | "promote_candidate"
  | "merge_candidate"
  | "deprecate_tag"
  | "reject_noise"
  | "watch";

export type TagGardenSignal = {
  action: TagGardenSignalAction;
  label: string;
  normalizedLabel: string;
  category: string | null;
  strength: number;
  reason: string;
  evidence: Record<string, unknown>;
};

export type TagGardenIntelligenceSnapshot = {
  generatedAt: string;
  windows: {
    trendMinOccurrences: number;
    staleAfterDays: number;
    noiseAfterDays: number;
  };
  summary: {
    trendCandidates: number;
    mergeCandidates: number;
    deprecateCandidates: number;
    noiseCandidates: number;
  };
  signals: TagGardenSignal[];
};

type SnapshotOptions = {
  limit?: number;
  trendMinOccurrences?: number;
  staleAfterDays?: number;
  noiseAfterDays?: number;
};

type SuggestionRow = {
  id: string;
  label: string;
  normalized_label: string;
  occurrence_count: number;
  first_seen_listing_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TagRow = {
  id: string;
  name: string;
  normalized_name: string;
  status: string;
  category: string;
  use_count: number;
  aliases: string[] | null;
  last_used_at: Date | string;
};

type SignalCountRow = {
  normalized_value: string;
  signal_count: number | string;
  source_count: number | string;
  last_seen_at: Date | string;
};

const DEFAULT_LIMIT = 8;
const DEFAULT_TREND_MIN_OCCURRENCES = 3;
const DEFAULT_STALE_AFTER_DAYS = 90;
const DEFAULT_NOISE_AFTER_DAYS = 14;

export async function getTagGardenIntelligenceSnapshot(
  db: Database,
  options: SnapshotOptions = {},
): Promise<TagGardenIntelligenceSnapshot> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const trendMinOccurrences = options.trendMinOccurrences ?? DEFAULT_TREND_MIN_OCCURRENCES;
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const noiseAfterDays = options.noiseAfterDays ?? DEFAULT_NOISE_AFTER_DAYS;

  const [suggestions, tags, tagSignalCounts, staleTags] = await Promise.all([
    listPendingSuggestions(db, Math.max(limit * 3, 20)),
    listActiveTags(db, 300),
    listTagCandidateSignalCounts(db, Math.max(limit * 2, 20)),
    listStaleTags(db, staleAfterDays, limit),
  ]);

  const trendSignals = buildTrendSignals(suggestions, tagSignalCounts, trendMinOccurrences, limit);
  const mergeSignals = buildMergeSignals(suggestions, tags, limit);
  const deprecateSignals = buildDeprecateSignals(staleTags, staleAfterDays, limit);
  const noiseSignals = buildNoiseSignals(suggestions, noiseAfterDays, limit);
  const signals = [
    ...trendSignals,
    ...mergeSignals,
    ...deprecateSignals,
    ...noiseSignals,
  ].slice(0, limit * 4);

  return {
    generatedAt: new Date().toISOString(),
    windows: {
      trendMinOccurrences,
      staleAfterDays,
      noiseAfterDays,
    },
    summary: {
      trendCandidates: trendSignals.length,
      mergeCandidates: mergeSignals.length,
      deprecateCandidates: deprecateSignals.length,
      noiseCandidates: noiseSignals.length,
    },
    signals,
  };
}

async function listPendingSuggestions(db: Database, limit: number): Promise<SuggestionRow[]> {
  const result = await db.execute(sql`
    SELECT
      id,
      label,
      normalized_label,
      occurrence_count,
      first_seen_listing_id,
      created_at,
      updated_at
    FROM tag_suggestions
    WHERE status = 'PENDING'
    ORDER BY occurrence_count DESC, updated_at DESC
    LIMIT ${limit}
  `);
  return rowsFromResult(result) as SuggestionRow[];
}

async function listActiveTags(db: Database, limit: number): Promise<TagRow[]> {
  const result = await db.execute(sql`
    SELECT
      id,
      name,
      normalized_name,
      status,
      category,
      use_count,
      aliases,
      last_used_at
    FROM tags
    WHERE status IN ('CANDIDATE', 'EMERGING', 'OFFICIAL')
    ORDER BY use_count DESC, updated_at DESC
    LIMIT ${limit}
  `);
  return rowsFromResult(result) as TagRow[];
}

async function listTagCandidateSignalCounts(db: Database, limit: number): Promise<SignalCountRow[]> {
  const result = await db.execute(sql`
    SELECT
      normalized_value,
      COUNT(*) AS signal_count,
      COUNT(DISTINCT COALESCE(listing_id::text, session_id::text, user_id::text, signal_key)) AS source_count,
      MAX(created_at) AS last_seen_at
    FROM conversation_market_signals
    WHERE signal_type = 'tag_candidate'
    GROUP BY normalized_value
    ORDER BY signal_count DESC, last_seen_at DESC
    LIMIT ${limit}
  `);
  return rowsFromResult(result) as SignalCountRow[];
}

async function listStaleTags(db: Database, staleAfterDays: number, limit: number): Promise<TagRow[]> {
  const result = await db.execute(sql`
    SELECT
      id,
      name,
      normalized_name,
      status,
      category,
      use_count,
      aliases,
      last_used_at
    FROM tags
    WHERE status IN ('OFFICIAL', 'EMERGING')
      AND category <> 'category'
      AND (
        use_count = 0
        OR last_used_at < NOW() - (${staleAfterDays} || ' days')::interval
      )
    ORDER BY last_used_at ASC, use_count ASC
    LIMIT ${limit}
  `);
  return rowsFromResult(result) as TagRow[];
}

function buildTrendSignals(
  suggestions: SuggestionRow[],
  tagSignalCounts: SignalCountRow[],
  trendMinOccurrences: number,
  limit: number,
): TagGardenSignal[] {
  const counts = new Map(
    tagSignalCounts.map((row) => [
      normalize(row.normalized_value),
      {
        signalCount: Number(row.signal_count),
        sourceCount: Number(row.source_count),
        lastSeenAt: row.last_seen_at,
      },
    ]),
  );

  return suggestions
    .filter((row) => row.occurrence_count >= trendMinOccurrences || (counts.get(row.normalized_label)?.signalCount ?? 0) >= trendMinOccurrences)
    .slice(0, limit)
    .map((row) => {
      const signal = counts.get(row.normalized_label);
      const support = row.occurrence_count + (signal?.signalCount ?? 0);
      return {
        action: "promote_candidate",
        label: row.label,
        normalizedLabel: row.normalized_label,
        category: null,
        strength: clamp01(0.45 + support * 0.08),
        reason: `Repeated pending suggestion or conversation tag signal reached ${support} support events.`,
        evidence: {
          suggestion_id: row.id,
          suggestion_occurrences: row.occurrence_count,
          signal_count: signal?.signalCount ?? 0,
          source_count: signal?.sourceCount ?? 0,
          first_seen_listing_id: row.first_seen_listing_id,
          last_seen_at: signal?.lastSeenAt ?? row.updated_at,
        },
      };
    });
}

function buildMergeSignals(
  suggestions: SuggestionRow[],
  tags: TagRow[],
  limit: number,
): TagGardenSignal[] {
  const signals: TagGardenSignal[] = [];

  for (const suggestion of suggestions) {
    const match = bestTagMatch(suggestion.normalized_label, tags);
    if (!match || match.score < 0.78) continue;

    signals.push({
      action: "merge_candidate",
      label: suggestion.label,
      normalizedLabel: suggestion.normalized_label,
      category: match.tag.category,
      strength: match.score,
      reason: `Suggestion appears to duplicate existing ${match.tag.status.toLowerCase()} tag "${match.tag.name}".`,
      evidence: {
        suggestion_id: suggestion.id,
        target_tag_id: match.tag.id,
        target_tag_name: match.tag.name,
        target_tag_status: match.tag.status,
        similarity: Number(match.score.toFixed(3)),
      },
    });

    if (signals.length >= limit) break;
  }

  return signals;
}

function buildDeprecateSignals(
  staleTags: TagRow[],
  staleAfterDays: number,
  limit: number,
): TagGardenSignal[] {
  return staleTags.slice(0, limit).map((tag) => ({
    action: "deprecate_tag",
    label: tag.name,
    normalizedLabel: tag.normalized_name,
    category: tag.category,
    strength: tag.use_count === 0 ? 0.78 : 0.62,
    reason: tag.use_count === 0
      ? "Active non-category tag has no recorded usage."
      : `Active non-category tag has stale usage beyond ${staleAfterDays} days.`,
    evidence: {
      tag_id: tag.id,
      status: tag.status,
      use_count: tag.use_count,
      last_used_at: tag.last_used_at,
    },
  }));
}

function buildNoiseSignals(
  suggestions: SuggestionRow[],
  noiseAfterDays: number,
  limit: number,
): TagGardenSignal[] {
  const cutoff = Date.now() - noiseAfterDays * 24 * 60 * 60 * 1000;

  return suggestions
    .filter((row) => row.occurrence_count <= 1 && new Date(row.created_at).getTime() < cutoff)
    .slice(0, limit)
    .map((row) => ({
      action: "reject_noise",
      label: row.label,
      normalizedLabel: row.normalized_label,
      category: null,
      strength: 0.58,
      reason: `One-off suggestion stayed pending for more than ${noiseAfterDays} days without reinforcement.`,
      evidence: {
        suggestion_id: row.id,
        occurrence_count: row.occurrence_count,
        created_at: row.created_at,
      },
    }));
}

function bestTagMatch(normalizedLabel: string, tags: TagRow[]): { tag: TagRow; score: number } | null {
  let best: { tag: TagRow; score: number } | null = null;

  for (const tag of tags) {
    const candidates = [tag.normalized_name, ...(tag.aliases ?? []).map(normalize)];
    for (const candidate of candidates) {
      const score = similarity(normalizedLabel, candidate);
      if (!best || score > best.score) best = { tag, score };
    }
  }

  return best;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;

  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length, 1);
  return 1 - distance / maxLength;
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] ?? 0;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}
