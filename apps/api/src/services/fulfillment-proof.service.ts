import { randomUUID } from "node:crypto";
import { type Database, eq, fulfillmentProofs } from "@haggle/db";
import {
  type FulfillmentRecord,
  getFulfillmentByOrderId,
  updateFulfillmentRecord,
} from "./fulfillment-record.service.js";

export type FulfillmentProofVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface FulfillmentProof {
  id: string;
  fulfillment_id: string;
  proof_kind: string;
  uri?: string;
  sha256?: string;
  external_reference?: string;
  submitted_by: string;
  verification_status: FulfillmentProofVerificationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class FulfillmentProofError extends Error {
  constructor(
    readonly code:
      | "FULFILLMENT_NOT_FOUND"
      | "INVALID_FULFILLMENT_STATUS"
      | "PROOF_EVIDENCE_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "FulfillmentProofError";
  }
}

function mapProof(row: typeof fulfillmentProofs.$inferSelect): FulfillmentProof {
  return {
    id: row.id,
    fulfillment_id: row.fulfillmentId,
    proof_kind: row.proofKind,
    uri: row.uri ?? undefined,
    sha256: row.sha256 ?? undefined,
    external_reference: row.externalReference ?? undefined,
    submitted_by: row.submittedBy,
    verification_status: row.verificationStatus as FulfillmentProofVerificationStatus,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Apply seller proof submit transition on the fulfillment record.
 * Keeps evidence untrusted (proof_status SUBMITTED) and does NOT mark FULFILLED,
 * set fulfilled_at, or start buyer review / release.
 */
export function transitionFulfillmentForSellerProofSubmit(
  fulfillment: FulfillmentRecord,
  now: string,
): FulfillmentRecord {
  if (fulfillment.status === "CANCELED" || fulfillment.status === "DISPUTED") {
    throw new FulfillmentProofError(
      "INVALID_FULFILLMENT_STATUS",
      `Cannot submit proof while fulfillment status is "${fulfillment.status}"`,
    );
  }
  if (fulfillment.status === "FULFILLED") {
    throw new FulfillmentProofError(
      "INVALID_FULFILLMENT_STATUS",
      `Cannot submit proof while fulfillment status is "${fulfillment.status}"`,
    );
  }

  return {
    ...fulfillment,
    status: "PROOF_SUBMITTED",
    proof_status: fulfillment.proof_required ? "SUBMITTED" : fulfillment.proof_status,
    // Explicit: do not set fulfilled_at — buyer review gate remains.
    fulfilled_at: fulfillment.fulfilled_at,
    updated_at: now,
  };
}

export async function submitSellerFulfillmentProof(
  db: Database,
  input: {
    order_id: string;
    submitted_by: string;
    kind: string;
    uri?: string;
    sha256?: string;
    external_reference?: string;
    metadata?: Record<string, unknown>;
    now?: string;
  },
): Promise<{ proof: FulfillmentProof; fulfillment: FulfillmentRecord }> {
  const hasEvidence = Boolean(
    input.uri?.trim() || input.sha256?.trim() || input.external_reference?.trim(),
  );
  if (!hasEvidence) {
    throw new FulfillmentProofError(
      "PROOF_EVIDENCE_REQUIRED",
      "Seller proof requires at least one of uri, sha256, or external_reference",
    );
  }

  const fulfillment = await getFulfillmentByOrderId(db, input.order_id);
  if (!fulfillment) {
    throw new FulfillmentProofError(
      "FULFILLMENT_NOT_FOUND",
      `No fulfillment record for order ${input.order_id}`,
    );
  }

  const now = input.now ?? new Date().toISOString();
  const updatedFulfillment = transitionFulfillmentForSellerProofSubmit(fulfillment, now);
  const proofId = randomUUID();

  const [row] = await db
    .insert(fulfillmentProofs)
    .values({
      id: proofId,
      fulfillmentId: fulfillment.id,
      proofKind: input.kind,
      uri: input.uri ?? null,
      sha256: input.sha256 ?? null,
      externalReference: input.external_reference ?? null,
      submittedBy: input.submitted_by,
      // Untrusted seller evidence — never auto-verify on submit.
      verificationStatus: "PENDING",
      metadata: input.metadata ?? {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .returning();

  if (!row) {
    throw new Error(`fulfillment proof insert failed for order ${input.order_id}`);
  }

  await updateFulfillmentRecord(db, updatedFulfillment);

  // Intentionally does NOT call confirmFulfillment / update settlement release /
  // move money. Buyer review remains the release gate (A5 / A6).
  return { proof: mapProof(row), fulfillment: updatedFulfillment };
}

export async function listFulfillmentProofsByFulfillmentId(
  db: Database,
  fulfillmentId: string,
): Promise<FulfillmentProof[]> {
  const rows = await db
    .select()
    .from(fulfillmentProofs)
    .where(eq(fulfillmentProofs.fulfillmentId, fulfillmentId));
  return rows.map(mapProof);
}

