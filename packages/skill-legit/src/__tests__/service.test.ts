import { describe, it, expect, beforeEach } from "vitest";
import { MockAuthAdapter } from "../mock-auth-adapter.js";
import { AuthenticationService, type RequestAuthenticationInput } from "../service.js";
import type { AuthenticationRecord } from "../types.js";

describe("AuthenticationService", () => {
  let service: AuthenticationService;
  let mockAdapter: MockAuthAdapter;

  beforeEach(() => {
    mockAdapter = new MockAuthAdapter();
    service = new AuthenticationService({ mock_auth: mockAdapter });
  });

  const baseInput: RequestAuthenticationInput = {
    order_id: "ord_001",
    listing_id: "lst_001",
    category: "sneakers",
    turnaround: "fast",
    requester: "buyer",
    cost_minor: 2500,
    now: "2026-03-30T10:00:00Z",
  };

  // -----------------------------------------------------------------------
  // requestAuthentication
  // -----------------------------------------------------------------------

  describe("requestAuthentication", () => {
    it("creates a record in INTENT_CREATED status", async () => {
      const result = await service.requestAuthentication(baseInput, "mock_auth");

      expect(result.record.status).toBe("INTENT_CREATED");
      expect(result.record.order_id).toBe("ord_001");
      expect(result.record.listing_id).toBe("lst_001");
      expect(result.record.provider).toBe("mock_auth");
      expect(result.record.category).toBe("sneakers");
      expect(result.record.turnaround).toBe("fast");
      expect(result.record.requested_by).toBe("buyer");
      expect(result.record.cost_minor).toBe(2500);
      expect(result.record.events).toHaveLength(0);
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("populates case_id and submission_url from provider", async () => {
      const result = await service.requestAuthentication(baseInput, "mock_auth");

      expect(result.record.case_id).toBe("case_mock_ord_001");
      expect(result.record.intent_id).toBe("intent_mock_ord_001");
      expect(result.record.submission_url).toContain("mock-auth.test");
    });

    it("defaults turnaround to standard when not specified", async () => {
      const input = { ...baseInput, turnaround: undefined };
      const result = await service.requestAuthentication(input, "mock_auth");
      expect(result.record.turnaround).toBe("standard");
    });

    it("records seller as requester", async () => {
      const input = { ...baseInput, requester: "seller" as const };
      const result = await service.requestAuthentication(input, "mock_auth");
      expect(result.record.requested_by).toBe("seller");
    });

    it("throws for unknown provider", async () => {
      await expect(
        service.requestAuthentication(baseInput, "nonexistent"),
      ).rejects.toThrow("no authentication provider registered: nonexistent");
    });

    it("maps haggle category to legit category", async () => {
      const input = { ...baseInput, category: "electronics" as const };
      const result = await service.requestAuthentication(input, "mock_auth");
      // electronics → accessories (fallback)
      expect(result.record.category).toBe("accessories");
    });

    it("sets timestamps from now parameter", async () => {
      const result = await service.requestAuthentication(baseInput, "mock_auth");
      expect(result.record.created_at).toBe("2026-03-30T10:00:00Z");
      expect(result.record.updated_at).toBe("2026-03-30T10:00:00Z");
    });

    it("generates unique record id", async () => {
      const r1 = await service.requestAuthentication(baseInput, "mock_auth");
      const r2 = await service.requestAuthentication(baseInput, "mock_auth");
      expect(r1.record.id).not.toBe(r2.record.id);
      expect(r1.record.id).toMatch(/^auth_/);
    });
  });

  // -----------------------------------------------------------------------
  // processWebhook
  // -----------------------------------------------------------------------

  describe("processWebhook", () => {
    let record: AuthenticationRecord;

    beforeEach(async () => {
      const result = await service.requestAuthentication(baseInput, "mock_auth");
      record = result.record;
    });

    it("transitions from INTENT_CREATED to SUBMITTED on submission.received", () => {
      const result = service.processWebhook(record, {
        event_type: "submission.received",
        case_id: record.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });

      expect(result).not.toBeNull();
      expect(result!.record.status).toBe("SUBMITTED");
      expect(result!.record.events).toHaveLength(1);
    });

    it("transitions from INTENT_CREATED to PHOTOS_REQUESTED", () => {
      const result = service.processWebhook(record, {
        event_type: "photos.requested",
        case_id: record.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });

      expect(result!.record.status).toBe("PHOTOS_REQUESTED");
    });

    it("transitions from SUBMITTED to COMPLETED with verdict", () => {
      // First move to SUBMITTED
      const submitted = service.processWebhook(record, {
        event_type: "submission.received",
        case_id: record.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });

      // Then complete
      const completed = service.processWebhook(submitted!.record, {
        event_type: "authentication.completed",
        case_id: record.case_id,
        verdict: "AUTHENTIC",
        certificate_url: "https://mock-auth.test/cert/case_mock_ord_001",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      expect(completed!.record.status).toBe("COMPLETED");
      expect(completed!.record.verdict).toBe("AUTHENTIC");
      expect(completed!.record.certificate_url).toContain("cert");
      expect(completed!.record.events).toHaveLength(2);
    });

    it("returns null for mismatched case_id", () => {
      const result = service.processWebhook(record, {
        event_type: "submission.received",
        case_id: "wrong_case_id",
        occurred_at: "2026-03-30T11:00:00Z",
      });

      expect(result).toBeNull();
    });

    it("returns null for unknown event type", () => {
      const result = service.processWebhook(record, {
        event_type: "unknown.event",
        case_id: record.case_id,
      });

      expect(result).toBeNull();
    });

    it("returns null for invalid transition (COMPLETED → SUBMITTED)", async () => {
      // Move through full lifecycle
      const s1 = service.processWebhook(record, {
        event_type: "submission.received",
        case_id: record.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });
      const completed = service.processWebhook(s1!.record, {
        event_type: "authentication.completed",
        case_id: record.case_id,
        occurred_at: "2026-03-30T12:00:00Z",
      });

      // Try to go back
      const invalid = service.processWebhook(completed!.record, {
        event_type: "submission.received",
        case_id: record.case_id,
        occurred_at: "2026-03-30T13:00:00Z",
      });

      expect(invalid).toBeNull();
    });

    it("returns null for unknown provider", async () => {
      const orphanRecord = { ...record, provider: "nonexistent" };
      const result = service.processWebhook(orphanRecord, {
        event_type: "submission.received",
        case_id: record.case_id,
      });
      expect(result).toBeNull();
    });

    it("updates updated_at timestamp", () => {
      const result = service.processWebhook(
        record,
        {
          event_type: "submission.received",
          case_id: record.case_id,
          occurred_at: "2026-03-30T11:00:00Z",
        },
        "2026-03-30T11:00:00Z",
      );

      expect(result!.record.updated_at).toBe("2026-03-30T11:00:00Z");
    });
  });

  // -----------------------------------------------------------------------
  // toDisputeEvidence
  // -----------------------------------------------------------------------

  describe("toDisputeEvidence", () => {
    it("returns evidence for COMPLETED record with verdict", async () => {
      const { record } = await service.requestAuthentication(baseInput, "mock_auth");
      const submitted = service.processWebhook(record, {
        event_type: "submission.received",
        case_id: record.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });
      const completed = service.processWebhook(submitted!.record, {
        event_type: "authentication.completed",
        case_id: record.case_id,
        verdict: "AUTHENTIC",
        certificate_url: "https://mock-auth.test/cert/123",
        occurred_at: "2026-03-30T12:00:00Z",
      });

      const evidence = service.toDisputeEvidence(completed!.record, "disp_001");

      expect(evidence).toHaveLength(2);
      expect(evidence[0].dispute_id).toBe("disp_001");
      expect(evidence[0].submitted_by).toBe("system");
      expect(evidence[0].text).toContain("AUTHENTIC");
      expect(evidence[1].uri).toContain("cert");
    });

    it("returns single evidence when no certificate_url", async () => {
      const { record } = await service.requestAuthentication(baseInput, "mock_auth");
      const submitted = service.processWebhook(record, {
        event_type: "submission.received",
        case_id: record.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });

      // Manually create completed record without certificate
      const completedRecord: AuthenticationRecord = {
        ...submitted!.record,
        status: "COMPLETED",
        verdict: "COUNTERFEIT",
      };

      const evidence = service.toDisputeEvidence(completedRecord, "disp_002");
      expect(evidence).toHaveLength(1);
      expect(evidence[0].text).toContain("COUNTERFEIT");
    });

    it("returns empty array for non-COMPLETED record", async () => {
      const { record } = await service.requestAuthentication(baseInput, "mock_auth");
      const evidence = service.toDisputeEvidence(record, "disp_003");
      expect(evidence).toHaveLength(0);
    });

    it("returns empty array for COMPLETED without verdict", async () => {
      const { record } = await service.requestAuthentication(baseInput, "mock_auth");
      const completedNoVerdict: AuthenticationRecord = {
        ...record,
        status: "COMPLETED",
      };
      const evidence = service.toDisputeEvidence(completedNoVerdict, "disp_004");
      expect(evidence).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // buildCostAllocation
  // -----------------------------------------------------------------------

  describe("buildCostAllocation", () => {
    it("returns cost allocation for buyer request", async () => {
      const { record } = await service.requestAuthentication(baseInput, "mock_auth");
      const allocation = service.buildCostAllocation(record);

      expect(allocation.paid_by).toBe("buyer");
      expect(allocation.cost_minor).toBe(2500);
      expect(allocation.chargeback_on_dispute_loss).toBe(true);
    });

    it("returns cost allocation for seller request", async () => {
      const input = { ...baseInput, requester: "seller" as const, cost_minor: 3000 };
      const { record } = await service.requestAuthentication(input, "mock_auth");
      const allocation = service.buildCostAllocation(record);

      expect(allocation.paid_by).toBe("seller");
      expect(allocation.cost_minor).toBe(3000);
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle E2E
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("INTENT_CREATED → PHOTOS_REQUESTED → SUBMITTED → COMPLETED", async () => {
      const { record: r0 } = await service.requestAuthentication(baseInput, "mock_auth");
      expect(r0.status).toBe("INTENT_CREATED");

      const r1 = service.processWebhook(r0, {
        event_type: "photos.requested",
        case_id: r0.case_id,
        occurred_at: "2026-03-30T10:30:00Z",
      });
      expect(r1!.record.status).toBe("PHOTOS_REQUESTED");

      const r2 = service.processWebhook(r1!.record, {
        event_type: "submission.received",
        case_id: r0.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });
      expect(r2!.record.status).toBe("SUBMITTED");

      const r3 = service.processWebhook(r2!.record, {
        event_type: "authentication.completed",
        case_id: r0.case_id,
        verdict: "REPLICA",
        occurred_at: "2026-03-30T12:00:00Z",
      });
      expect(r3!.record.status).toBe("COMPLETED");
      expect(r3!.record.verdict).toBe("COUNTERFEIT"); // REPLICA → COUNTERFEIT
      expect(r3!.record.events).toHaveLength(3);

      // Verify evidence generation
      const evidence = service.toDisputeEvidence(r3!.record, "disp_e2e");
      expect(evidence.length).toBeGreaterThanOrEqual(1);
      expect(evidence[0].text).toContain("COUNTERFEIT");
    });

    it("INTENT_CREATED → SUBMITTED → COMPLETED (skip photos)", async () => {
      const { record: r0 } = await service.requestAuthentication(baseInput, "mock_auth");

      const r1 = service.processWebhook(r0, {
        event_type: "submission.received",
        case_id: r0.case_id,
        occurred_at: "2026-03-30T11:00:00Z",
      });
      expect(r1!.record.status).toBe("SUBMITTED");

      const r2 = service.processWebhook(r1!.record, {
        event_type: "authentication.completed",
        case_id: r0.case_id,
        verdict: "AUTHENTIC",
        certificate_url: "https://mock-auth.test/cert/final",
        occurred_at: "2026-03-30T12:00:00Z",
      });
      expect(r2!.record.status).toBe("COMPLETED");
      expect(r2!.record.verdict).toBe("AUTHENTIC");
      expect(r2!.record.certificate_url).toContain("cert/final");
    });

    it("cost allocation follows requester through lifecycle", async () => {
      const { record } = await service.requestAuthentication(
        { ...baseInput, requester: "seller", cost_minor: 5000 },
        "mock_auth",
      );

      const allocation = service.buildCostAllocation(record);
      expect(allocation.paid_by).toBe("seller");
      expect(allocation.cost_minor).toBe(5000);
      expect(allocation.chargeback_on_dispute_loss).toBe(true);
    });
  });
});
