import type { TrustTriggerEvent } from "@haggle/commerce-core";
import { createId } from "./id.js";
import type { DisputeReasonCode } from "./reason-codes.js";
import { transitionDisputeStatus } from "./state-machine.js";
import { trustTriggersForDisputeResolution } from "./trust-events.js";
import type { DisputeCase, DisputeEvidence, DisputeResolution, DisputeStatus } from "./types.js";

export interface OpenDisputeInput {
  order_id: string;
  reason_code: DisputeReasonCode;
  opened_by: "buyer" | "seller" | "system";
  initial_evidence?: Omit<DisputeEvidence, "id" | "dispute_id" | "created_at">[];
  now?: string;
}

export interface DisputeServiceResult<T = undefined> {
  dispute: DisputeCase;
  value?: T;
  trust_triggers: TrustTriggerEvent[];
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function transitionOrThrow(
  status: DisputeStatus,
  event: Parameters<typeof transitionDisputeStatus>[1],
): DisputeStatus {
  const next = transitionDisputeStatus(status, event);
  if (!next) {
    throw new Error(`invalid dispute transition: ${status} -> ${event}`);
  }
  return next;
}

export class DisputeService {
  openCase(input: OpenDisputeInput): DisputeServiceResult {
    const ts = nowIso(input.now);
    const disputeId = createId("dsp");

    const evidence: DisputeEvidence[] = (input.initial_evidence ?? []).map(
      (e) => ({
        ...e,
        id: createId("evi"),
        dispute_id: disputeId,
        created_at: ts,
      }),
    );

    const dispute: DisputeCase = {
      id: disputeId,
      order_id: input.order_id,
      reason_code: input.reason_code,
      status: "OPEN",
      opened_by: input.opened_by,
      opened_at: ts,
      evidence,
    };

    return { dispute, trust_triggers: [] };
  }

  startReview(
    dispute: DisputeCase,
    now?: string,
  ): DisputeServiceResult {
    const nextStatus = transitionOrThrow(dispute.status, "review");
    return {
      dispute: this.withStatus(dispute, nextStatus),
      trust_triggers: [],
    };
  }

  requestBuyerEvidence(
    dispute: DisputeCase,
    now?: string,
  ): DisputeServiceResult {
    const nextStatus = transitionOrThrow(dispute.status, "request_buyer_evidence");
    return {
      dispute: this.withStatus(dispute, nextStatus),
      trust_triggers: [],
    };
  }

  requestSellerEvidence(
    dispute: DisputeCase,
    now?: string,
  ): DisputeServiceResult {
    const nextStatus = transitionOrThrow(dispute.status, "request_seller_evidence");
    return {
      dispute: this.withStatus(dispute, nextStatus),
      trust_triggers: [],
    };
  }

  addEvidence(
    dispute: DisputeCase,
    evidence: Omit<DisputeEvidence, "id" | "dispute_id" | "created_at">,
    now?: string,
  ): DisputeServiceResult<DisputeEvidence> {
    const ts = nowIso(now);
    const newEvidence: DisputeEvidence = {
      ...evidence,
      id: createId("evi"),
      dispute_id: dispute.id,
      created_at: ts,
    };

    return {
      dispute: {
        ...dispute,
        evidence: [...dispute.evidence, newEvidence],
      },
      value: newEvidence,
      trust_triggers: [],
    };
  }

  resolve(
    dispute: DisputeCase,
    resolution: Omit<DisputeResolution, "resolved_at">,
    now?: string,
  ): DisputeServiceResult<DisputeResolution> {
    const eventType = this.outcomeToEvent(resolution.outcome);
    const nextStatus = transitionOrThrow(dispute.status, eventType);
    const ts = nowIso(now);

    const fullResolution: DisputeResolution = {
      ...resolution,
      resolved_at: ts,
    };

    const updatedDispute = {
      ...this.withStatus(dispute, nextStatus, now),
      resolution: fullResolution,
    };

    // no_action resolutions should not generate trust triggers —
    // they are semantically different from ruling in seller's favor.
    const triggers = resolution.outcome === "no_action"
      ? []
      : trustTriggersForDisputeResolution(nextStatus);

    return {
      dispute: updatedDispute,
      value: fullResolution,
      trust_triggers: triggers,
    };
  }

  closeCase(
    dispute: DisputeCase,
    now?: string,
  ): DisputeServiceResult {
    const nextStatus = transitionOrThrow(dispute.status, "close");
    return {
      dispute: this.withStatus(dispute, nextStatus),
      trust_triggers: [],
    };
  }

  private outcomeToEvent(
    outcome: DisputeResolution["outcome"],
  ): Parameters<typeof transitionDisputeStatus>[1] {
    switch (outcome) {
      case "buyer_favor":
        return "resolve_buyer_favor";
      case "seller_favor":
        return "resolve_seller_favor";
      case "partial_refund":
        return "resolve_partial_refund";
      case "no_action":
        return "resolve_seller_favor";
    }
  }

  private withStatus(
    dispute: DisputeCase,
    status: DisputeStatus,
    _now?: string,
  ): DisputeCase {
    return { ...dispute, status };
  }
}
