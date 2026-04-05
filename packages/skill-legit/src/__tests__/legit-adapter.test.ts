import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LegitAuthAdapter, mapLegitVerdict } from "../legit-adapter.js";
import type { CreateAuthIntentInput } from "../provider.js";

// ---------------------------------------------------------------------------
// Verdict mapping
// ---------------------------------------------------------------------------

describe("mapLegitVerdict", () => {
  it.each<[string, string]>([
    ["AUTHENTIC", "AUTHENTIC"],
    ["REPLICA", "COUNTERFEIT"],
    ["INCONCLUSIVE", "INCONCLUSIVE"],
  ])("maps %s → %s", (raw, expected) => {
    expect(mapLegitVerdict(raw as any)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// LegitAuthAdapter
// ---------------------------------------------------------------------------

describe("LegitAuthAdapter", () => {
  const mockConfig = { api_key: "test-key", base_url: "https://api.test.legitapp.com/v1" };
  let adapter: LegitAuthAdapter;

  const defaultInput: CreateAuthIntentInput = {
    order_id: "ord_123",
    listing_id: "lst_456",
    category: "sneakers",
    turnaround: "fast",
  };

  beforeEach(() => {
    adapter = new LegitAuthAdapter(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createIntent", () => {
    it("sends correct request and parses response", async () => {
      const mockResponse = {
        case_id: "case_abc",
        intent_id: "intent_def",
        submission_url: "https://legitapp.com/submit/intent_def",
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const result = await adapter.createIntent(defaultInput);

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.legitapp.com/v1/intents",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-key",
          },
        }),
      );

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.category).toBe("sneakers");
      expect(body.turnaround).toBe("fast");
      expect(body.external_id).toBe("ord_123");
      expect(body.metadata.listing_id).toBe("lst_456");
    });

    it("throws on HTTP error with status and body", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Invalid category"),
      }));

      await expect(adapter.createIntent(defaultInput)).rejects.toThrow(
        "LegitApp createIntent failed for ord_123: HTTP 422 — Invalid category",
      );
    });

    it("throws on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      await expect(adapter.createIntent(defaultInput)).rejects.toThrow(
        "LegitApp createIntent failed for ord_123: ECONNREFUSED",
      );
    });

    it("handles response with id fallback fields", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: "id_fallback",
          submission_url: "https://legitapp.com/submit/id_fallback",
        }),
      }));

      const result = await adapter.createIntent(defaultInput);
      expect(result.case_id).toBe("id_fallback");
      expect(result.intent_id).toBe("id_fallback");
    });

    it("strips trailing slash from base_url", async () => {
      const adapterTrailingSlash = new LegitAuthAdapter({
        api_key: "key",
        base_url: "https://api.test.legitapp.com/v1/",
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ case_id: "c", intent_id: "i", submission_url: "u" }),
      }));

      await adapterTrailingSlash.createIntent(defaultInput);
      expect((fetch as any).mock.calls[0][0]).toBe("https://api.test.legitapp.com/v1/intents");
    });

    it("includes custom metadata", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ case_id: "c", intent_id: "i", submission_url: "u" }),
      }));

      await adapter.createIntent({
        ...defaultInput,
        metadata: { brand: "Nike", model: "Air Jordan 1" },
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.metadata.brand).toBe("Nike");
      expect(body.metadata.model).toBe("Air Jordan 1");
      expect(body.metadata.listing_id).toBe("lst_456");
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses authentication.completed with AUTHENTIC verdict", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "authentication.completed",
        case_id: "case_abc",
        verdict: "AUTHENTIC",
        certificate_url: "https://legitapp.com/cert/case_abc",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event).not.toBeNull();
      expect(event!.case_id).toBe("case_abc");
      expect(event!.event_type).toBe("authentication.completed");
      expect(event!.status).toBe("COMPLETED");
      expect(event!.verdict).toBe("AUTHENTIC");
      expect(event!.certificate_url).toBe("https://legitapp.com/cert/case_abc");
    });

    it("maps REPLICA verdict to COUNTERFEIT", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "authentication.completed",
        case_id: "case_abc",
        verdict: "REPLICA",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event!.verdict).toBe("COUNTERFEIT");
    });

    it("parses INCONCLUSIVE verdict", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "authentication.completed",
        case_id: "case_abc",
        verdict: "INCONCLUSIVE",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event!.verdict).toBe("INCONCLUSIVE");
    });

    it("parses submission.received event", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "submission.received",
        case_id: "case_abc",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event!.status).toBe("SUBMITTED");
      expect(event!.verdict).toBeUndefined();
    });

    it("parses photos.requested event", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "photos.requested",
        case_id: "case_abc",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event!.status).toBe("PHOTOS_REQUESTED");
    });

    it("returns null for unknown event type", () => {
      expect(adapter.parseWebhookEvent({
        event_type: "unknown.event",
        case_id: "case_abc",
      })).toBeNull();
    });

    it("returns null for missing case_id", () => {
      expect(adapter.parseWebhookEvent({
        event_type: "authentication.completed",
      })).toBeNull();
    });

    it("returns null for empty object", () => {
      expect(adapter.parseWebhookEvent({})).toBeNull();
    });

    it("falls back to id field when case_id is missing", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "submission.received",
        id: "case_fallback",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event!.case_id).toBe("case_fallback");
    });

    it("preserves raw payload in event", () => {
      const raw = {
        event_type: "submission.received",
        case_id: "case_abc",
        occurred_at: "2026-03-30T12:00:00Z",
        extra_field: "value",
      };

      const event = adapter.parseWebhookEvent(raw);
      expect(event!.raw).toBe(raw);
    });

    it("ignores invalid verdict string in completed event", () => {
      const event = adapter.parseWebhookEvent({
        event_type: "authentication.completed",
        case_id: "case_abc",
        verdict: "INVALID_VERDICT",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(event!.verdict).toBeUndefined();
    });
  });
});
