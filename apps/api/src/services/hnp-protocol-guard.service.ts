export interface HnpProtocolIdentity {
  messageId: string;
  idempotencyKey: string;
  sequence: number;
  messageType?: string;
  proposalHash?: string;
  acceptedProposalHash?: string;
}

export interface HnpRoundProtocolRecord {
  id: string;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
}

export type HnpProtocolGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: 409;
      error: "DUPLICATE_OR_STALE" | "OUT_OF_ORDER";
      relatedMessageId?: string;
    };

export function validateHnpProtocolOrder(
  rounds: HnpRoundProtocolRecord[],
  incoming: HnpProtocolIdentity,
): HnpProtocolGuardResult {
  const protocolRounds = rounds
    .map((round) => ({ round, hnp: extractHnpProtocol(round.metadata) }))
    .filter((entry): entry is { round: HnpRoundProtocolRecord; hnp: ExtractedHnpProtocol } => Boolean(entry.hnp));

  const sameIdempotency = protocolRounds.some(
    ({ round, hnp }) => round.idempotencyKey === incoming.idempotencyKey
      && sameProtocolIdentity(hnp, incoming),
  );
  if (sameIdempotency) return { ok: true };

  const conflictingIdempotency = protocolRounds.find(
    ({ round }) => round.idempotencyKey === incoming.idempotencyKey,
  );
  if (conflictingIdempotency) {
    return {
      ok: false,
      status: 409,
      error: "DUPLICATE_OR_STALE",
      relatedMessageId: incoming.messageId,
    };
  }

  const duplicateMessage = protocolRounds.find(
    ({ hnp }) => hnp.messageId === incoming.messageId,
  );
  if (duplicateMessage) {
    return {
      ok: false,
      status: 409,
      error: "DUPLICATE_OR_STALE",
      relatedMessageId: incoming.messageId,
    };
  }

  const maxSequence = protocolRounds.reduce(
    (max, { hnp }) => Math.max(max, hnp.sequence),
    -1,
  );
  if (incoming.sequence <= maxSequence) {
    return {
      ok: false,
      status: 409,
      error: "OUT_OF_ORDER",
    };
  }

  return { ok: true };
}

interface ExtractedHnpProtocol {
  messageId: string;
  sequence: number;
  messageType?: string;
  proposalHash?: string;
  acceptedProposalHash?: string;
}

function extractHnpProtocol(metadata: Record<string, unknown> | null): ExtractedHnpProtocol | null {
  const protocol = metadata?.protocol;
  if (!protocol || typeof protocol !== "object") return null;

  const hnp = (protocol as Record<string, unknown>).hnp;
  if (!hnp || typeof hnp !== "object") return null;

  const record = hnp as Record<string, unknown>;
  if (typeof record.messageId !== "string") return null;
  if (typeof record.sequence !== "number" || !Number.isInteger(record.sequence)) return null;

  return {
    messageId: record.messageId,
    sequence: record.sequence,
    messageType: typeof record.type === "string"
      ? record.type
      : typeof record.messageType === "string"
        ? record.messageType
        : undefined,
    proposalHash: typeof record.proposalHash === "string" ? record.proposalHash : undefined,
    acceptedProposalHash: typeof record.acceptedProposalHash === "string" ? record.acceptedProposalHash : undefined,
  };
}

function sameProtocolIdentity(stored: ExtractedHnpProtocol, incoming: HnpProtocolIdentity): boolean {
  if (stored.messageId !== incoming.messageId) return false;
  if (stored.sequence !== incoming.sequence) return false;
  if (incoming.messageType && stored.messageType && incoming.messageType !== stored.messageType) return false;
  if (incoming.proposalHash && stored.proposalHash && incoming.proposalHash !== stored.proposalHash) return false;
  if (
    incoming.acceptedProposalHash
    && stored.acceptedProposalHash
    && incoming.acceptedProposalHash !== stored.acceptedProposalHash
  ) {
    return false;
  }
  return true;
}
