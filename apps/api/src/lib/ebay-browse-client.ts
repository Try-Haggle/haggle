/**
 * eBay Browse API client (minimal, focused).
 *
 * Single endpoint: `/buy/browse/v1/item_summary/search`.
 * OAuth 2.0 client credentials flow — token cached in-memory with expiry.
 * Internal rate limit counter fails fast at 4500/day (safety margin under
 * the 5000/day free-tier cap). Exponential backoff on 429/5xx.
 *
 * Built from scratch per ARCHITECT-BRIEF Part B decision (avoid `ebay-api`
 * npm surface area).
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §4.2.
 */

// ─── Public types ─────────────────────────────────────────────────────

export interface BrowseQuery {
  /** Free-text query, e.g. "Apple iPhone 14 Pro". */
  q: string;
  /** eBay category id. Defaults to 9355 (Cell Phones & Smartphones). */
  categoryIds?: string;
  /** Max items per page. eBay allows up to 200. Default 100. */
  limit?: number;
  /** Pagination offset. Default 0. */
  offset?: number;
  /**
   * Raw filter string per eBay `filter` param spec.
   * e.g. `conditions:{USED|SELLER_REFURBISHED},price:[200..1500],priceCurrency:USD,itemLocationCountry:US,buyingOptions:{FIXED_PRICE}`
   */
  filter?: string;
}

export interface BrowseItemSummary {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  condition?: string;
  conditionId?: string;
  itemLocation?: { country?: string };
  itemCreationDate?: string;
  itemWebUrl?: string;
  seller?: { feedbackScore?: number; feedbackPercentage?: string };
}

export interface BrowseResponse {
  itemSummaries: BrowseItemSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface EbayBrowseClientOptions {
  clientId?: string;
  clientSecret?: string;
  /** Override base URL (e.g. sandbox). */
  baseUrl?: string;
  /** Hard cap per day. Default 4500 (10% safety margin under 5000). */
  dailyLimit?: number;
  /** Injected fetch for unit tests. */
  fetchImpl?: typeof fetch;
  /** Injected clock (ms since epoch). For rate limit day rollover tests. */
  now?: () => number;
  /** Max retry attempts on 429/5xx. Default 4. */
  maxRetries?: number;
  /** Initial backoff delay in ms. Default 500. */
  baseBackoffMs?: number;
}

// ─── Errors ───────────────────────────────────────────────────────────

export class EbayRateLimitExceededError extends Error {
  constructor(callsToday: number, limit: number) {
    super(
      `eBay Browse API daily rate limit guard tripped: ${callsToday}/${limit}`,
    );
    this.name = "EbayRateLimitExceededError";
  }
}

export class EbayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayAuthError";
  }
}

export class EbayRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "EbayRequestError";
  }
}

// ─── Client ───────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const DEFAULT_BASE_URL = "https://api.ebay.com";
const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";

export class EbayBrowseClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly dailyLimit: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;

  private cachedToken: CachedToken | null = null;
  private callsToday = 0;
  private rateCounterDayKey: string;

  constructor(opts: EbayBrowseClientOptions = {}) {
    const clientId = opts.clientId ?? process.env.EBAY_CLIENT_ID ?? "";
    const clientSecret =
      opts.clientSecret ?? process.env.EBAY_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) {
      // Don't throw at construction — caller may still introspect .hasCredentials.
      // searchActiveListings() will throw EbayAuthError if invoked without creds.
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.dailyLimit = opts.dailyLimit ?? 4500;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.rateCounterDayKey = this.dayKey();
  }

  hasCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Exposed for test assertions. */
  getCallsToday(): number {
    this.rolloverDayIfNeeded();
    return this.callsToday;
  }

  /** Exposed for test setup — force-set the internal counter. */
  _setCallsTodayForTest(n: number): void {
    this.callsToday = n;
  }

  /** Exposed for test setup — force-set cached token. */
  _setCachedTokenForTest(t: CachedToken | null): void {
    this.cachedToken = t;
  }

  private dayKey(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private rolloverDayIfNeeded(): void {
    const k = this.dayKey();
    if (k !== this.rateCounterDayKey) {
      this.rateCounterDayKey = k;
      this.callsToday = 0;
    }
  }

  /**
   * Fetch and cache an OAuth access token via client credentials flow.
   * Returns immediately if a cached token is still valid (with 60s safety window).
   */
  private async getAccessToken(): Promise<string> {
    if (!this.hasCredentials()) {
      throw new EbayAuthError(
        "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not configured",
      );
    }
    const safetyWindowMs = 60_000;
    if (
      this.cachedToken &&
      this.cachedToken.expiresAtMs - safetyWindowMs > this.now()
    ) {
      return this.cachedToken.accessToken;
    }
    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: OAUTH_SCOPE,
    });
    const res = await this.fetchImpl(
      `${this.baseUrl}/identity/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );
    if (!res.ok) {
      const text = await safeText(res);
      throw new EbayAuthError(
        `eBay OAuth failed: ${res.status} ${res.statusText} ${text}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number; // seconds
      token_type: string;
    };
    this.cachedToken = {
      accessToken: json.access_token,
      expiresAtMs: this.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  /**
   * Execute a Browse API `item_summary/search` call.
   *
   * Rate limit guard: increments internal counter *before* the HTTP call.
   * Throws EbayRateLimitExceededError if counter already at dailyLimit.
   * Retries on 429/5xx with exponential backoff up to `maxRetries` attempts.
   */
  async searchActiveListings(query: BrowseQuery): Promise<BrowseResponse> {
    this.rolloverDayIfNeeded();
    if (this.callsToday >= this.dailyLimit) {
      throw new EbayRateLimitExceededError(this.callsToday, this.dailyLimit);
    }
    this.callsToday += 1;

    const token = await this.getAccessToken();
    const url = this.buildSearchUrl(query);

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
        });
        if (res.ok) {
          const json = (await res.json()) as Partial<BrowseResponse>;
          return {
            itemSummaries: json.itemSummaries ?? [],
            total: json.total ?? 0,
            limit: json.limit ?? (query.limit ?? 100),
            offset: json.offset ?? (query.offset ?? 0),
          };
        }
        if (res.status === 429 || res.status >= 500) {
          lastErr = new EbayRequestError(
            `retryable status ${res.status}`,
            res.status,
            await safeText(res),
          );
          if (attempt < this.maxRetries) {
            await sleep(this.backoffDelay(attempt));
            continue;
          }
          throw lastErr;
        }
        throw new EbayRequestError(
          `eBay Browse non-retryable ${res.status}`,
          res.status,
          await safeText(res),
        );
      } catch (err) {
        lastErr = err;
        if (err instanceof EbayRequestError && attempt < this.maxRetries) {
          await sleep(this.backoffDelay(attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("eBay Browse exhausted retries");
  }

  private backoffDelay(attempt: number): number {
    // 500ms, 1s, 2s, 4s, ... (capped by maxRetries)
    return this.baseBackoffMs * Math.pow(2, attempt);
  }

  private buildSearchUrl(q: BrowseQuery): string {
    const params = new URLSearchParams();
    params.set("q", q.q);
    params.set("category_ids", q.categoryIds ?? "9355");
    params.set("limit", String(q.limit ?? 100));
    params.set("offset", String(q.offset ?? 0));
    if (q.filter) params.set("filter", q.filter);
    return `${this.baseUrl}/buy/browse/v1/item_summary/search?${params.toString()}`;
  }
}

// ─── Internals ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// ─── Default SKU filter builder ───────────────────────────────────────

/** Default filter string for iPhone Pro SKU ingestion queries. */
export function defaultIphoneFilter(): string {
  return [
    "conditions:{USED|SELLER_REFURBISHED}",
    "price:[200..1500]",
    "priceCurrency:USD",
    "itemLocationCountry:US",
    "buyingOptions:{FIXED_PRICE}",
  ].join(",");
}
