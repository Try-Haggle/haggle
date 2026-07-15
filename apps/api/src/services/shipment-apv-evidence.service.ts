import { type Database, sql } from "@haggle/db";

export interface ShipmentApvEvidenceRecord {
  revision_id: string;
  evidence_sha256: string;
  provider_document_id: string;
  surcharge_category: string;
  surcharge_type: string;
  evidence_amount_minor: number;
  evidence_currency: string;
  evidence_bound_at?: string;
}

export type ShipmentApvEvidenceResult =
  | { outcome: "bound" | "duplicate"; evidence: ShipmentApvEvidenceRecord }
  | { outcome: "not_found" | "invalid_state" | "amount_conflict" | "evidence_conflict" };

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function mapEvidence(row: Record<string, unknown>): ShipmentApvEvidenceRecord {
  return {
    revision_id: String(row.id),
    evidence_sha256: String(row.evidence_sha256),
    provider_document_id: String(row.provider_document_id),
    surcharge_category: String(row.surcharge_category),
    surcharge_type: String(row.surcharge_type),
    evidence_amount_minor: numeric(row.evidence_amount_minor),
    evidence_currency: String(row.evidence_currency),
    evidence_bound_at:
      row.evidence_bound_at instanceof Date
        ? row.evidence_bound_at.toISOString()
        : typeof row.evidence_bound_at === "string"
          ? row.evidence_bound_at
          : undefined,
  };
}

export async function bindShipmentApvRevisionEvidence(
  db: Database,
  input: {
    revisionId: string;
    actorId: string;
    documentSha256: string;
    providerDocumentId: string;
    surchargeCategory: string;
    surchargeType: string;
    amountMinor: number;
    currency: string;
  },
): Promise<ShipmentApvEvidenceResult> {
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT * FROM shipment_apv_adjustment_revisions
       WHERE id = ${input.revisionId}
       FOR UPDATE
    `)) as unknown as Array<Record<string, unknown>>;
    const revision = rows[0];
    if (!revision) return { outcome: "not_found" } as const;
    if (revision.evidence_sha256) {
      const existing = mapEvidence(revision);
      const same =
        existing.evidence_sha256 === input.documentSha256 &&
        existing.provider_document_id === input.providerDocumentId &&
        existing.surcharge_category === input.surchargeCategory &&
        existing.surcharge_type === input.surchargeType &&
        existing.evidence_amount_minor === input.amountMinor &&
        existing.evidence_currency === input.currency;
      return same
        ? ({ outcome: "duplicate", evidence: existing } as const)
        : ({ outcome: "evidence_conflict" } as const);
    }
    if (revision.status !== "PENDING_REVIEW") return { outcome: "invalid_state" } as const;
    if (Math.abs(numeric(revision.delta_minor)) !== input.amountMinor)
      return { outcome: "amount_conflict" } as const;

    const updatedRows = (await tx.execute(sql`
      UPDATE shipment_apv_adjustment_revisions
         SET evidence_sha256 = ${input.documentSha256}, provider_document_id = ${input.providerDocumentId},
             surcharge_category = ${input.surchargeCategory}, surcharge_type = ${input.surchargeType},
             evidence_amount_minor = ${input.amountMinor}, evidence_currency = ${input.currency},
             evidence_bound_by = ${input.actorId}, evidence_bound_at = now()
       WHERE id = ${input.revisionId} AND evidence_sha256 IS NULL AND status = 'PENDING_REVIEW'
      RETURNING *
    `)) as unknown as Array<Record<string, unknown>>;
    if (!updatedRows[0]) return { outcome: "evidence_conflict" } as const;
    return { outcome: "bound", evidence: mapEvidence(updatedRows[0]) } as const;
  });
}
