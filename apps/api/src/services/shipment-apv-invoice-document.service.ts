import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { chmod, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { sql, type Database } from "@haggle/db";
import { isProductionRuntime } from "../config/runtime.js";

export const SHIPMENT_APV_INVOICE_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY_PATTERN = /^([0-9a-f-]{36})\/([0-9a-f]{64})\.(pdf|csv|json)$/;
const HEALTH_MAX_DOCUMENTS = 1000;
const HEALTH_MAX_FILESYSTEM_ENTRIES = 5000;
const HEALTH_MAX_HASH_BYTES = 100 * 1024 * 1024;
export type ShipmentInvoiceContentType = "application/pdf" | "text/csv" | "application/json";

export interface ShipmentApvInvoiceDocumentRecord {
  id: string;
  revision_id: string;
  provider_document_id: string;
  content_type: ShipmentInvoiceContentType;
  byte_size: number;
  sha256: string;
  created_at?: string;
}

type StoreResult = { outcome: "stored" | "duplicate"; document: ShipmentApvInvoiceDocumentRecord }
  | { outcome: "revision_not_found" | "evidence_not_bound" | "evidence_mismatch" | "document_conflict" | "invalid_document" };

export function resolveShipmentInvoiceDocumentRoot(): string {
  const configured = process.env.SHIPMENT_INVOICE_DOCUMENT_ROOT?.trim();
  if (configured) {
    if (!isAbsolute(configured)) throw new Error("SHIPMENT_INVOICE_DOCUMENT_ROOT_MUST_BE_ABSOLUTE");
    return configured;
  }
  if (isProductionRuntime()) throw new Error("SHIPMENT_INVOICE_DOCUMENT_ROOT_REQUIRED");
  return join(tmpdir(), "haggle-shipment-invoice-documents");
}

export function validateShipmentApvInvoiceDocumentBytes(
  bytes: Buffer, contentType: ShipmentInvoiceContentType,
): boolean {
  if (bytes.length < 2 || bytes.length > SHIPMENT_APV_INVOICE_DOCUMENT_MAX_BYTES) return false;
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (bytes.includes(0)) return false;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return false;
  if (contentType === "application/json") {
    try { JSON.parse(text); return true; } catch { return false; }
  }
  return /[,\n\r]/.test(text);
}

function mapDocument(row: Record<string, unknown>): ShipmentApvInvoiceDocumentRecord {
  return { id: String(row.id), revision_id: String(row.revision_id),
    provider_document_id: String(row.provider_document_id), content_type: String(row.content_type) as ShipmentInvoiceContentType,
    byte_size: Number(row.byte_size), sha256: String(row.sha256),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString()
      : typeof row.created_at === "string" ? row.created_at : undefined };
}

export async function storeShipmentApvInvoiceDocument(
  db: Database,
  input: { revisionId: string; providerDocumentId: string; contentType: ShipmentInvoiceContentType;
    bytes: Buffer; uploadedBy: string; storageRoot?: string },
): Promise<StoreResult> {
  if (!UUID_PATTERN.test(input.revisionId) || !UUID_PATTERN.test(input.uploadedBy)
    || !input.providerDocumentId.trim() || input.providerDocumentId.length > 128
    || !validateShipmentApvInvoiceDocumentBytes(input.bytes, input.contentType)) return { outcome: "invalid_document" };
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const extension = input.contentType === "application/pdf" ? "pdf" : input.contentType === "text/csv" ? "csv" : "json";
  const storageKey = `${input.revisionId}/${sha256}.${extension}`;
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  let newlyWrittenPath: string | null = null;
  try {
    return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`apv-invoice-document:${input.revisionId}`}, 0))`);
    const revisions = await tx.execute(sql`
      SELECT id, evidence_sha256, provider_document_id FROM shipment_apv_adjustment_revisions
       WHERE id = ${input.revisionId} LIMIT 1
    `) as unknown as Array<Record<string, unknown>>;
    const revision = revisions[0];
    if (!revision) return { outcome: "revision_not_found" } as const;
    if (!revision.evidence_sha256 || !revision.provider_document_id) return { outcome: "evidence_not_bound" } as const;
    if (revision.evidence_sha256 !== sha256 || revision.provider_document_id !== input.providerDocumentId) {
      return { outcome: "evidence_mismatch" } as const;
    }
    const existingRows = await tx.execute(sql`
      SELECT * FROM shipment_apv_invoice_documents WHERE revision_id = ${input.revisionId} LIMIT 1
    `) as unknown as Array<Record<string, unknown>>;
    if (existingRows[0]) {
      const existing = mapDocument(existingRows[0]);
      return existing.sha256 === sha256 && existing.provider_document_id === input.providerDocumentId
        && existing.content_type === input.contentType
        ? { outcome: "duplicate", document: existing } as const
        : { outcome: "document_conflict" } as const;
    }
    const path = join(root, storageKey);
    const revisionDirectory = join(root, input.revisionId);
    await mkdir(revisionDirectory, { recursive: true, mode: 0o700 });
    await chmod(revisionDirectory, 0o700);
    try {
      await writeFile(path, input.bytes, { flag: "wx", mode: 0o600 });
      newlyWrittenPath = path;
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== "EEXIST") throw error;
      const existingBytes = await readFile(path);
      if (!existingBytes.equals(input.bytes)) throw new Error("APV_INVOICE_STORAGE_CONFLICT");
    }
    const rows = await tx.execute(sql`
      INSERT INTO shipment_apv_invoice_documents
        (revision_id, provider_document_id, content_type, byte_size, sha256, storage_key, uploaded_by, created_at)
      VALUES (${input.revisionId}, ${input.providerDocumentId}, ${input.contentType}, ${input.bytes.length},
        ${sha256}, ${storageKey}, ${input.uploadedBy}, now())
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    return { outcome: "stored", document: mapDocument(rows[0]!) } as const;
    });
  } catch (error) {
    if (newlyWrittenPath) await rm(newlyWrittenPath, { force: true });
    throw error;
  }
}

export async function readShipmentApvInvoiceDocumentBytes(
  db: Database, revisionId: string, storageRoot?: string,
): Promise<Buffer | null> {
  const rows = await db.execute(sql`
    SELECT storage_key FROM shipment_apv_invoice_documents WHERE revision_id = ${revisionId} LIMIT 1
  `) as unknown as Array<{ storage_key: string }>;
  if (!rows[0]) return null;
  return readFile(join(storageRoot ?? resolveShipmentInvoiceDocumentRoot(), rows[0].storage_key));
}

export async function deleteShipmentApvInvoiceDocumentForFixture(
  db: Database, revisionId: string, storageRoot: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    DELETE FROM shipment_apv_invoice_documents WHERE revision_id = ${revisionId} RETURNING storage_key
  `) as unknown as Array<{ storage_key: string }>;
  if (!rows[0]) return false;
  await rm(join(storageRoot, rows[0].storage_key), { force: true });
  return true;
}

export interface ShipmentApvInvoiceDocumentStorageHealth {
  status: "healthy" | "warning" | "critical";
  totalDocuments: number;
  activeDocuments?: number;
  missingDocuments?: number;
  quarantinedDocuments?: number;
  checkedDocuments: number;
  missingFiles: number;
  sizeMismatches: number;
  hashMismatches: number;
  orphanFiles: number;
  invalidEntries: number;
  scanTruncated: boolean;
  checkedBytes: number;
  recordedAt: string;
}

export async function getShipmentApvInvoiceDocumentStorageHealth(
  db: Database,
  options: { storageRoot?: string; revisionId?: string } = {},
): Promise<ShipmentApvInvoiceDocumentStorageHealth> {
  if (options.revisionId && !UUID_PATTERN.test(options.revisionId)) {
    throw new Error("INVALID_APV_INVOICE_DOCUMENT_HEALTH_SCOPE");
  }
  const root = options.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  const countRows = await db.execute(sql`
    SELECT count(*) AS count,
      count(*) FILTER (WHERE integrity_status = 'ACTIVE') AS active_count,
      count(*) FILTER (WHERE integrity_status = 'MISSING') AS missing_count,
      count(*) FILTER (WHERE integrity_status = 'QUARANTINED') AS quarantined_count
    FROM shipment_apv_invoice_documents
     WHERE (${options.revisionId ?? null}::uuid IS NULL OR revision_id = ${options.revisionId ?? null}::uuid)
  `) as unknown as Array<Record<string, string | number>>;
  const totalDocuments = Number(countRows[0]?.count ?? 0);
  const activeDocuments = Number(countRows[0]?.active_count ?? 0);
  const missingDocuments = Number(countRows[0]?.missing_count ?? 0);
  const quarantinedDocuments = Number(countRows[0]?.quarantined_count ?? 0);
  const rows = await db.execute(sql`
    SELECT revision_id, storage_key, byte_size, sha256 FROM shipment_apv_invoice_documents
     WHERE integrity_status = 'ACTIVE'
       AND (${options.revisionId ?? null}::uuid IS NULL OR revision_id = ${options.revisionId ?? null}::uuid)
     ORDER BY created_at ASC LIMIT ${HEALTH_MAX_DOCUMENTS}
  `) as unknown as Array<{ revision_id: string; storage_key: string; byte_size: number | string; sha256: string }>;
  let missingFiles = 0;
  let sizeMismatches = 0;
  let hashMismatches = 0;
  let invalidEntries = 0;
  let checkedBytes = 0;
  let scanTruncated = activeDocuments > rows.length;
  const expectedKeys = new Set<string>();
  for (const row of rows) {
    const match = STORAGE_KEY_PATTERN.exec(row.storage_key);
    if (!match || match[1] !== row.revision_id || match[2] !== row.sha256) {
      invalidEntries += 1;
      continue;
    }
    expectedKeys.add(row.storage_key);
    try {
      const path = join(root, row.storage_key);
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) { invalidEntries += 1; continue; }
      const expectedSize = Number(row.byte_size);
      if (metadata.size !== expectedSize) { sizeMismatches += 1; continue; }
      if (checkedBytes + metadata.size > HEALTH_MAX_HASH_BYTES) { scanTruncated = true; continue; }
      const bytes = await readFile(path);
      checkedBytes += bytes.length;
      if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) hashMismatches += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") missingFiles += 1;
      else invalidEntries += 1;
    }
  }
  let orphanFiles = 0;
  let filesystemEntries = 0;
  try {
    const rootEntries = options.revisionId
      ? await readdir(join(root, options.revisionId), { withFileTypes: true })
        .then((files) => [{ name: options.revisionId!, files }])
      : await readdir(root, { withFileTypes: true }).then(async (directories) => {
        const entries: Array<{ name: string; files: Dirent[] }> = [];
        for (const directory of directories) {
          if (directory.name === ".quarantine" || directory.name === ".restoration") continue;
          filesystemEntries += 1;
          if (filesystemEntries > HEALTH_MAX_FILESYSTEM_ENTRIES) { scanTruncated = true; break; }
          if (!directory.isDirectory() || directory.isSymbolicLink() || !UUID_PATTERN.test(directory.name)) {
            invalidEntries += 1;
            continue;
          }
          entries.push({ name: directory.name, files: await readdir(join(root, directory.name), { withFileTypes: true }) });
        }
        return entries;
      });
    for (const entry of rootEntries) {
      for (const file of entry.files) {
        filesystemEntries += 1;
        if (filesystemEntries > HEALTH_MAX_FILESYSTEM_ENTRIES) { scanTruncated = true; break; }
        const key = `${entry.name}/${file.name}`;
        if (!file.isFile() || file.isSymbolicLink() || !STORAGE_KEY_PATTERN.test(key)) invalidEntries += 1;
        else if (!scanTruncated && !expectedKeys.has(key)) orphanFiles += 1;
      }
      if (scanTruncated && filesystemEntries > HEALTH_MAX_FILESYSTEM_ENTRIES) break;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") invalidEntries += 1;
  }
  const critical = missingFiles > 0 || hashMismatches > 0 || missingDocuments > 0;
  const warning = sizeMismatches > 0 || orphanFiles > 0 || invalidEntries > 0 || scanTruncated
    || quarantinedDocuments > 0;
  return { status: critical ? "critical" : warning ? "warning" : "healthy", totalDocuments,
    activeDocuments, missingDocuments, quarantinedDocuments,
    checkedDocuments: rows.length, missingFiles, sizeMismatches, hashMismatches, orphanFiles,
    invalidEntries, scanTruncated, checkedBytes, recordedAt: new Date().toISOString() };
}

export async function runShipmentApvInvoiceDocumentReconciliationDryRun(
  db: Database, options: { storageRoot?: string; revisionId?: string } = {},
) {
  const health = await getShipmentApvInvoiceDocumentStorageHealth(db, options);
  return { dryRun: true, mutated: false, health,
    wouldMarkMissingOrCorrupt: health.missingFiles + health.sizeMismatches + health.hashMismatches,
    wouldQuarantineOrphans: health.orphanFiles + health.invalidEntries };
}
