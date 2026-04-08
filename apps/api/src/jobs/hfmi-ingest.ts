/**
 * HFMI ingestion job.
 *
 * Iterates the 6 iPhone Pro SKU queries, fetches active listings from
 * eBay Browse API, parses titles, and inserts observations into
 * `hfmi_price_observations`. Dedupe is enforced by the unique
 * `(source, external_id)` index — duplicate inserts are silently skipped
 * via `onConflictDoNothing()`.
 *
 * Exportable for cron wiring (infra layer), not scheduled here.
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §4, §5, §6.1.
 */

import { type Database, hfmiPriceObservations } from "@haggle/db";
import {
  EbayBrowseClient,
  EbayRateLimitExceededError,
  defaultIphoneFilter,
  type BrowseItemSummary,
} from "../lib/ebay-browse-client.js";
import { parseEbayTitle } from "../lib/hfmi-title-parser.js";

// ─── SKU catalog ──────────────────────────────────────────────────────

export interface HfmiSku {
  modelId: string;
  query: string;
  /** Regex that must match the title AFTER excluding unrelated variants. */
  titleInclude: RegExp;
  /** Regex that must NOT match the title (to disambiguate Pro vs Pro Max). */
  titleExclude?: RegExp;
}

export const HFMI_SKUS: HfmiSku[] = [
  {
    modelId: "iphone_13_pro",
    query: "Apple iPhone 13 Pro",
    titleInclude: /\biphone\s*13\s*pro\b/i,
    titleExclude: /\bpro\s*max\b/i,
  },
  {
    modelId: "iphone_13_pro_max",
    query: "Apple iPhone 13 Pro Max",
    titleInclude: /\biphone\s*13\s*pro\s*max\b/i,
  },
  {
    modelId: "iphone_14_pro",
    query: "Apple iPhone 14 Pro",
    titleInclude: /\biphone\s*14\s*pro\b/i,
    titleExclude: /\bpro\s*max\b/i,
  },
  {
    modelId: "iphone_14_pro_max",
    query: "Apple iPhone 14 Pro Max",
    titleInclude: /\biphone\s*14\s*pro\s*max\b/i,
  },
  {
    modelId: "iphone_15_pro",
    query: "Apple iPhone 15 Pro",
    titleInclude: /\biphone\s*15\s*pro\b/i,
    titleExclude: /\bpro\s*max\b/i,
  },
  {
    modelId: "iphone_15_pro_max",
    query: "Apple iPhone 15 Pro Max",
    titleInclude: /\biphone\s*15\s*pro\s*max\b/i,
  },
];

// ─── Ingestion result ─────────────────────────────────────────────────

export interface HfmiIngestResult {
  modelId: string;
  fetched: number;
  accepted: number;
  excluded: number;
  inserted: number; // DB rows actually inserted (dedup skipped)
  error?: string;
}

export interface HfmiIngestSummary {
  results: HfmiIngestResult[];
  totalInserted: number;
  startedAt: Date;
  finishedAt: Date;
}

// ─── Main entry point ─────────────────────────────────────────────────

/**
 * Run a single ingestion pass over all 6 SKUs.
 *
 * Fails gracefully if eBay credentials are missing (logs warning, returns
 * empty summary). Rate limit errors halt further SKU iteration but return
 * partial results.
 */
export async function runHfmiIngest(
  db: Database,
  opts: {
    client?: EbayBrowseClient;
    pagesPerSku?: number;
    limitPerPage?: number;
    now?: () => Date;
  } = {},
): Promise<HfmiIngestSummary> {
  const startedAt = (opts.now ?? (() => new Date()))();
  const client = opts.client ?? new EbayBrowseClient();
  const pagesPerSku = opts.pagesPerSku ?? 1;
  const limitPerPage = opts.limitPerPage ?? 100;

  if (!client.hasCredentials()) {
    console.warn(
      "[hfmi-ingest] EBAY_CLIENT_ID/EBAY_CLIENT_SECRET not configured — no-op",
    );
    return {
      results: [],
      totalInserted: 0,
      startedAt,
      finishedAt: new Date(),
    };
  }

  const filter = defaultIphoneFilter();
  const results: HfmiIngestResult[] = [];

  for (const sku of HFMI_SKUS) {
    const result: HfmiIngestResult = {
      modelId: sku.modelId,
      fetched: 0,
      accepted: 0,
      excluded: 0,
      inserted: 0,
    };
    try {
      for (let page = 0; page < pagesPerSku; page++) {
        const resp = await client.searchActiveListings({
          q: sku.query,
          categoryIds: "9355",
          limit: limitPerPage,
          offset: page * limitPerPage,
          filter,
        });
        result.fetched += resp.itemSummaries.length;
        const rows = resp.itemSummaries
          .map((item) => itemToObservationRow(item, sku, result))
          .filter((r): r is ObservationRow => r !== null);
        if (rows.length === 0) {
          if (resp.itemSummaries.length === 0) break;
          continue;
        }
        const insertedRows = await db
          .insert(hfmiPriceObservations)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: hfmiPriceObservations.id });
        result.inserted += insertedRows.length;
        result.accepted += rows.length;
        if (resp.itemSummaries.length < limitPerPage) break;
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.error(
        `[hfmi-ingest] ${sku.modelId} failed:`,
        result.error,
      );
      if (err instanceof EbayRateLimitExceededError) {
        results.push(result);
        break;
      }
    }
    results.push(result);
  }

  const summary: HfmiIngestSummary = {
    results,
    totalInserted: results.reduce((acc, r) => acc + r.inserted, 0),
    startedAt,
    finishedAt: new Date(),
  };
  console.log(
    `[hfmi-ingest] done: ${summary.totalInserted} rows inserted across ${results.length} SKUs`,
  );
  return summary;
}

// ─── Helpers ──────────────────────────────────────────────────────────

type ObservationRow = typeof hfmiPriceObservations.$inferInsert;

function itemToObservationRow(
  item: BrowseItemSummary,
  sku: HfmiSku,
  accumulator: HfmiIngestResult,
): ObservationRow | null {
  if (!item.itemId || !item.title || !item.price?.value) return null;

  // SKU disambiguation (Pro vs Pro Max)
  if (!sku.titleInclude.test(item.title)) {
    accumulator.excluded += 1;
    return null;
  }
  if (sku.titleExclude && sku.titleExclude.test(item.title)) {
    accumulator.excluded += 1;
    return null;
  }

  // US-only guard (belt and suspenders with filter param)
  if (item.itemLocation?.country && item.itemLocation.country !== "US") {
    accumulator.excluded += 1;
    return null;
  }

  // Currency guard
  if (item.price.currency && item.price.currency !== "USD") {
    accumulator.excluded += 1;
    return null;
  }

  const priceNum = Number(item.price.value);
  if (!Number.isFinite(priceNum) || priceNum < 200 || priceNum > 1500) {
    accumulator.excluded += 1;
    return null;
  }

  const parsed = parseEbayTitle(item.title);
  if (parsed.excluded) {
    accumulator.excluded += 1;
    return null;
  }

  // Condition → cosmetic grade map (§5.1). Title hint refines.
  const grade = mapConditionToGrade(item.condition, parsed.cosmeticGradeHint);
  if (grade === "EXCLUDED") {
    accumulator.excluded += 1;
    return null;
  }

  const observedAt = item.itemCreationDate
    ? new Date(item.itemCreationDate)
    : new Date();

  return {
    source: "ebay_browse",
    model: sku.modelId,
    storageGb: parsed.storageGb ?? null,
    batteryHealthPct: parsed.batteryHealthPct ?? null,
    cosmeticGrade: grade,
    carrierLocked: parsed.carrierLocked ?? false,
    observedPriceUsd: priceNum.toFixed(2),
    observedAt,
    externalId: item.itemId,
    rawPayload: {
      title: item.title,
      condition: item.condition ?? null,
      itemWebUrl: item.itemWebUrl ?? null,
    },
  };
}

function mapConditionToGrade(
  condition: string | undefined,
  hint: "A" | "B" | "C" | null,
): "A" | "B" | "C" | "EXCLUDED" {
  const c = (condition ?? "").toLowerCase();
  if (!c) return hint ?? "B";
  if (c.includes("new") && !c.includes("open")) return "EXCLUDED";
  if (c.includes("for parts") || c.includes("not working")) return "EXCLUDED";
  if (c.includes("certified") || c.includes("refurbished")) {
    // "Seller refurbished" is allowed as B; certified/Back Market refurb excluded.
    if (c.includes("seller")) return hint ?? "B";
    return "EXCLUDED";
  }
  if (c.includes("open box")) return hint ?? "A";
  if (c.includes("used")) return hint ?? "B";
  return hint ?? "B";
}
