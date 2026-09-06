import { describe, expect, it } from "vitest";
import {
  decideWebhookLocalOverwrite,
  impliedProviderStateForWebhookMutation,
  mutationForWebhookEventType,
  settlementWebhookOutOfOrderReason,
  terminalWebhookOutOfOrderReason,
} from "../lib/payment-webhook-out-of-order-guard.js";

describe("payment-webhook-out-of-order-guard (B6)", () => {
  it("maps webhook event types to local mutations", () => {
    expect(mutationForWebhookEventType("settlement.confirmed")).toBe("settle");
    expect(mutationForWebhookEventType("settlement.failed")).toBe("fail");
    expect(mutationForWebhookEventType("payment.expired")).toBe("expire");
    expect(mutationForWebhookEventType("unknown")).toBeNull();
  });

  it("flags settlement-confirmed before authorization as out-of-order", () => {
    expect(
      settlementWebhookOutOfOrderReason({
        status: "CREATED",
        productionState: "pending",
      }),
    ).toBe("settlement_confirmed_before_authorization");
  });

  it("flags terminal events after local capture as out-of-order", () => {
    expect(
      terminalWebhookOutOfOrderReason({
        status: "SETTLED",
        productionState: "captured",
        targetAction: "fail",
      }),
    ).toBe("terminal_event_after_local_capture");
  });

  it("forbids local overwrite when provider recheck was not performed", () => {
    expect(
      decideWebhookLocalOverwrite({
        mutation: "fail",
        localStatus: "AUTHORIZED",
        outOfOrderReason: null,
        providerRecheck: null,
      }),
    ).toEqual({
      decision: "reconciliation_required",
      reason: "provider_recheck_required_before_local_overwrite",
    });
  });

  it("forbids local overwrite when provider recheck is unavailable", () => {
    expect(
      decideWebhookLocalOverwrite({
        mutation: "settle",
        localStatus: "AUTHORIZED",
        outOfOrderReason: null,
        providerRecheck: { outcome: "unavailable", reason: "provider_live_recheck_unavailable" },
      }),
    ).toEqual({
      decision: "reconciliation_required",
      reason: "provider_recheck_unavailable_before_local_overwrite",
    });
  });

  it("forbids local overwrite when provider recheck disagrees with the webhook", () => {
    expect(
      decideWebhookLocalOverwrite({
        mutation: "fail",
        localStatus: "AUTHORIZED",
        outOfOrderReason: null,
        providerRecheck: {
          outcome: "confirmed",
          providerState: "captured",
          source: "test",
        },
      }),
    ).toEqual({
      decision: "reconciliation_required",
      reason: "provider_recheck_disagrees_with_webhook",
    });
  });

  it("never auto-applies an out-of-order event even if recheck looks confirming", () => {
    expect(
      decideWebhookLocalOverwrite({
        mutation: "settle",
        localStatus: "CREATED",
        outOfOrderReason: "settlement_confirmed_before_authorization",
        providerRecheck: {
          outcome: "confirmed",
          providerState: "captured",
          source: "test",
        },
      }),
    ).toEqual({
      decision: "reconciliation_required",
      reason: "settlement_confirmed_before_authorization",
    });
  });

  it("allows overwrite only after a confirming provider recheck", () => {
    expect(
      decideWebhookLocalOverwrite({
        mutation: "fail",
        localStatus: "AUTHORIZED",
        outOfOrderReason: null,
        providerRecheck: {
          outcome: "confirmed",
          providerState: impliedProviderStateForWebhookMutation("fail"),
          source: "test",
        },
      }),
    ).toEqual({ decision: "apply" });
  });

  it("treats already-terminal matching statuses as noop without requiring apply", () => {
    expect(
      decideWebhookLocalOverwrite({
        mutation: "fail",
        localStatus: "FAILED",
        outOfOrderReason: null,
        providerRecheck: null,
      }),
    ).toEqual({ decision: "noop" });
  });
});
