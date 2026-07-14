import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getShipmentApvInvoiceDocumentStorageHealth,
  runShipmentApvInvoiceDocumentReconciliationDryRun,
} from "../services/shipment-apv-invoice-document.service.js";

const roots: string[] = [];

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "haggle-apv-invoice-health-test-"));
  roots.push(root);
  return root;
}

function fixtureDb(row: { revision_id: string; storage_key: string; byte_size: number; sha256: string }) {
  return { execute: vi.fn()
    .mockResolvedValueOnce([{ count: "1", active_count: "1", missing_count: "0", quarantined_count: "0" }])
    .mockResolvedValueOnce([row]) } as unknown as Database;
}

function documentFixture(revisionId: string, bytes: Buffer) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { revision_id: revisionId, storage_key: `${revisionId}/${sha256}.json`,
    byte_size: bytes.length, sha256 };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("APV invoice document storage health", () => {
  it("rejects a non-UUID revision scope before touching storage or the database", async () => {
    const execute = vi.fn();
    await expect(getShipmentApvInvoiceDocumentStorageHealth({ execute } as unknown as Database, {
      storageRoot: "/tmp", revisionId: "../outside",
    })).rejects.toThrow("INVALID_APV_INVOICE_DOCUMENT_HEALTH_SCOPE");
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports a matching regular file as healthy", async () => {
    const root = await fixtureRoot();
    const revisionId = randomUUID();
    const bytes = Buffer.from('{"invoice":"healthy"}');
    const row = documentFixture(revisionId, bytes);
    await mkdir(join(root, revisionId));
    await writeFile(join(root, row.storage_key), bytes);

    const health = await getShipmentApvInvoiceDocumentStorageHealth(fixtureDb(row), { storageRoot: root, revisionId });
    expect(health).toMatchObject({ status: "healthy", totalDocuments: 1, checkedDocuments: 1,
      missingFiles: 0, hashMismatches: 0, orphanFiles: 0, scanTruncated: false });
  });

  it("reports a missing DB-bound file as critical", async () => {
    const root = await fixtureRoot();
    const revisionId = randomUUID();
    const row = documentFixture(revisionId, Buffer.from('{"invoice":"missing"}'));

    const health = await getShipmentApvInvoiceDocumentStorageHealth(fixtureDb(row), { storageRoot: root, revisionId });
    expect(health).toMatchObject({ status: "critical", missingFiles: 1, hashMismatches: 0 });
  });

  it("reports same-size content tampering as a critical hash mismatch", async () => {
    const root = await fixtureRoot();
    const revisionId = randomUUID();
    const bytes = Buffer.from('{"invoice":"original"}');
    const row = documentFixture(revisionId, bytes);
    await mkdir(join(root, revisionId));
    await writeFile(join(root, row.storage_key), Buffer.from('{"invoice":"tampered"}'));

    const health = await getShipmentApvInvoiceDocumentStorageHealth(fixtureDb(row), { storageRoot: root, revisionId });
    expect(health).toMatchObject({ status: "critical", sizeMismatches: 0, hashMismatches: 1 });
  });

  it("scopes orphan detection and keeps reconciliation dry-run non-mutating", async () => {
    const root = await fixtureRoot();
    const revisionId = randomUUID();
    const otherRevisionId = randomUUID();
    const bytes = Buffer.from('{"invoice":"scoped"}');
    const row = documentFixture(revisionId, bytes);
    await mkdir(join(root, revisionId));
    await mkdir(join(root, otherRevisionId));
    await writeFile(join(root, row.storage_key), bytes);
    const orphanBytes = Buffer.from('{"orphan":true}');
    const orphanHash = createHash("sha256").update(orphanBytes).digest("hex");
    await writeFile(join(root, revisionId, `${orphanHash}.json`), orphanBytes);
    await writeFile(join(root, otherRevisionId, `${orphanHash}.json`), orphanBytes);

    const db = { execute: vi.fn()
      .mockResolvedValueOnce([{ count: "1", active_count: "1", missing_count: "0", quarantined_count: "0" }]).mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ count: "1", active_count: "1", missing_count: "0", quarantined_count: "0" }]).mockResolvedValueOnce([row]) } as unknown as Database;
    const health = await getShipmentApvInvoiceDocumentStorageHealth(db, { storageRoot: root, revisionId });
    const reconciliation = await runShipmentApvInvoiceDocumentReconciliationDryRun(db, { storageRoot: root, revisionId });
    expect(health).toMatchObject({ status: "warning", orphanFiles: 1, invalidEntries: 0 });
    expect(reconciliation).toMatchObject({ dryRun: true, mutated: false,
      wouldMarkMissingOrCorrupt: 0, wouldQuarantineOrphans: 1 });
  });
});
