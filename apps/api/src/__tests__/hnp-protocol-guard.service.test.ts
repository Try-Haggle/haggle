import { describe, expect, it } from "vitest";
import { validateHnpProtocolOrder } from "../services/hnp-protocol-guard.service.js";

function round(input: {
  id?: string;
  idempotencyKey?: string;
  messageId: string;
  sequence: number;
  type?: string;
  proposalHash?: string;
}) {
  return {
    id: input.id ?? "round-1",
    idempotencyKey: input.idempotencyKey ?? "idem-1",
    metadata: {
      protocol: {
        hnp: {
          messageId: input.messageId,
          sequence: input.sequence,
          type: input.type,
          proposalHash: input.proposalHash,
        },
      },
    },
  };
}

describe("validateHnpProtocolOrder", () => {
  it("allows idempotent retry before applying sequence checks", () => {
    const result = validateHnpProtocolOrder(
      [round({ messageId: "msg-1", sequence: 2, idempotencyKey: "idem-1" })],
      { messageId: "msg-1", sequence: 2, idempotencyKey: "idem-1" },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects duplicate message_id with a different idempotency key", () => {
    const result = validateHnpProtocolOrder(
      [round({ messageId: "msg-1", sequence: 2, idempotencyKey: "idem-1" })],
      { messageId: "msg-1", sequence: 3, idempotencyKey: "idem-2" },
    );

    expect(result).toMatchObject({ ok: false, error: "DUPLICATE_OR_STALE" });
  });

  it("rejects idempotency key reuse with a different protocol identity", () => {
    const result = validateHnpProtocolOrder(
      [round({
        messageId: "offer-msg-1",
        sequence: 2,
        idempotencyKey: "idem-1",
        type: "OFFER",
        proposalHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })],
      {
        messageId: "accept-msg-1",
        sequence: 3,
        idempotencyKey: "idem-1",
        messageType: "ACCEPT",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: "DUPLICATE_OR_STALE",
      relatedMessageId: "accept-msg-1",
    });
  });

  it("rejects out-of-order sequence values", () => {
    const result = validateHnpProtocolOrder(
      [round({ messageId: "msg-1", sequence: 5 })],
      { messageId: "msg-2", sequence: 4, idempotencyKey: "idem-2" },
    );

    expect(result).toMatchObject({ ok: false, error: "OUT_OF_ORDER" });
  });
});
