import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getShipmentApvInvoiceRestorationStagingHealth } from "../services/shipment-apv-invoice-restoration.service.js";

const roots: string[] = [];
const now = new Date("2026-07-12T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from('{"invoice":"verified"}');
  const id = randomUUID();
  return {
    id,
    status: "PENDING",
    staging_status: "STAGED",
    staging_key: `.restoration/${id}/invoice.json`,
    replacement_sha256: createHash("sha256").update(bytes).digest("hex"),
    replacement_byte_size: bytes.length,
    expires_at: "2026-07-12T12:30:00.000Z",
    updated_at: "2026-07-12T11:59:00.000Z",
    created_at: "2026-07-12T11:59:00.000Z",
    bytes,
    ...overrides,
  };
}

async function root() {
  const value = await mkdtemp(join(tmpdir(), "haggle-apv-restore-health-"));
  roots.push(value);
  return value;
}

function dbWith(rows: Array<Record<string, unknown>>) {
  return {
    execute: vi.fn().mockResolvedValue(rows.map(({ bytes: _bytes, ...value }) => value)),
  } as unknown as Database;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("shipment APV invoice restoration staging health", () => {
  it("returns healthy aggregate without identifiers when no staging is tracked", async () => {
    const health = await getShipmentApvInvoiceRestorationStagingHealth(dbWith([]), {
      storageRoot: await root(),
      now,
    });
    expect(health).toMatchObject({
      status: "healthy",
      trackedStaging: 0,
      missingSources: 0,
      hashMismatches: 0,
      invalidEntries: 0,
      scanTruncated: false,
    });
    expect(JSON.stringify(health)).not.toContain("request");
  });

  it("classifies stale, missing, tampered, and escaping staging without exposing paths", async () => {
    const storageRoot = await root();
    const valid = row({
      status: "REJECTED",
      staging_status: "MOVING",
      updated_at: "2026-07-12T11:54:00.000Z",
    });
    const tampered = row({ status: "EXPIRED" });
    const missing = row({ status: "REJECTED" });
    const escaping = row({ status: "REJECTED", staging_key: "../outside.json" });
    for (const item of [valid, tampered]) {
      const path = join(storageRoot, String(item.staging_key));
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        item === tampered
          ? Buffer.alloc(Number(item.replacement_byte_size), 0x78)
          : (item.bytes as Buffer),
      );
    }
    const health = await getShipmentApvInvoiceRestorationStagingHealth(
      dbWith([valid, tampered, missing, escaping]),
      { storageRoot, now },
    );
    expect(health).toMatchObject({
      status: "critical",
      trackedStaging: 4,
      pendingDisposition: 4,
      staleMoving: 1,
      missingSources: 1,
      hashMismatches: 1,
      invalidEntries: 1,
    });
    expect(JSON.stringify(health)).not.toContain(".restoration");
    expect(JSON.stringify(health)).not.toContain(String(valid.id));
  });

  it("stops hashing at the configured byte budget and reports truncation", async () => {
    const storageRoot = await root();
    const candidate = row({ status: "REJECTED" });
    const path = join(storageRoot, String(candidate.staging_key));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, candidate.bytes as Buffer);
    const health = await getShipmentApvInvoiceRestorationStagingHealth(dbWith([candidate]), {
      storageRoot,
      now,
      maxCheckedBytes: 1,
    });
    expect(health).toMatchObject({
      status: "warning",
      trackedStaging: 1,
      pendingDisposition: 1,
      checkedBytes: 0,
      scanTruncated: true,
    });
  });
});
