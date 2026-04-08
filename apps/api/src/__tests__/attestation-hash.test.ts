import { describe, it, expect } from "vitest";
import {
  canonicalizeAttestation,
  computeCommitHash,
  ATTESTATION_CANONICAL_VERSION,
  type AttestationInput,
} from "../lib/attestation-hash.js";

const FIXTURE: AttestationInput = {
  listingId: "11111111-1111-1111-1111-111111111111",
  sellerId: "22222222-2222-2222-2222-222222222222",
  imei: "359123456789012",
  batteryHealthPct: 92,
  findMyOff: true,
  photoKeys: [
    "attestation/2026-04-08/front.jpg",
    "attestation/2026-04-08/back.jpg",
    "attestation/2026-04-08/side.jpg",
    "attestation/2026-04-08/screen.jpg",
  ],
  committedAt: "2026-04-08T12:00:00.000Z",
};

// Regression guard — if canonicalizeAttestation ever drifts, this hash
// changes and the test fails loudly. Updating this constant requires
// explicit acknowledgement that every historical commit is invalidated.
const FIXTURE_EXPECTED_HASH =
  "7f9a1f9853ec8fa5c485249a379ab8e56fafcf11b5e7a44de9ec7ce9a6d256f7";

describe("canonicalizeAttestation", () => {
  it("produces a deterministic string for the fixture", () => {
    const a = canonicalizeAttestation(FIXTURE);
    const b = canonicalizeAttestation(FIXTURE);
    expect(a).toBe(b);
  });

  it("includes the schema version marker", () => {
    const canonical = canonicalizeAttestation(FIXTURE);
    expect(canonical).toContain(`"version","${ATTESTATION_CANONICAL_VERSION}"`);
  });

  it("normalizes IMEI by stripping non-digit characters", () => {
    const withDashes = canonicalizeAttestation({
      ...FIXTURE,
      imei: "35-9123-456789012",
    });
    const clean = canonicalizeAttestation(FIXTURE);
    expect(withDashes).toBe(clean);
  });

  it("preserves photoKeys array order (semantically significant)", () => {
    const reordered = canonicalizeAttestation({
      ...FIXTURE,
      photoKeys: [...FIXTURE.photoKeys].reverse(),
    });
    const original = canonicalizeAttestation(FIXTURE);
    expect(reordered).not.toBe(original);
  });

  it("rejects non-integer battery health", () => {
    expect(() =>
      canonicalizeAttestation({ ...FIXTURE, batteryHealthPct: 92.5 }),
    ).toThrow(/batteryHealthPct/);
  });

  it("rejects out-of-range battery health", () => {
    expect(() =>
      canonicalizeAttestation({ ...FIXTURE, batteryHealthPct: 150 }),
    ).toThrow(/out of range/);
  });

  it("rejects empty listingId/sellerId/imei/committedAt", () => {
    expect(() =>
      canonicalizeAttestation({ ...FIXTURE, listingId: "" }),
    ).toThrow();
    expect(() =>
      canonicalizeAttestation({ ...FIXTURE, sellerId: "" }),
    ).toThrow();
    expect(() => canonicalizeAttestation({ ...FIXTURE, imei: "" })).toThrow();
    expect(() =>
      canonicalizeAttestation({ ...FIXTURE, committedAt: "" }),
    ).toThrow();
  });
});

describe("computeCommitHash", () => {
  it("matches the locked fixture hash (regression guard)", () => {
    const canonical = canonicalizeAttestation(FIXTURE);
    const hash = computeCommitHash(canonical);
    expect(hash).toBe(FIXTURE_EXPECTED_HASH);
  });

  it("is deterministic for identical input", () => {
    const h1 = computeCommitHash(canonicalizeAttestation(FIXTURE));
    const h2 = computeCommitHash(canonicalizeAttestation(FIXTURE));
    expect(h1).toBe(h2);
  });

  it("differs when any field changes", () => {
    const base = computeCommitHash(canonicalizeAttestation(FIXTURE));
    const changedBattery = computeCommitHash(
      canonicalizeAttestation({ ...FIXTURE, batteryHealthPct: 91 }),
    );
    const changedFindMy = computeCommitHash(
      canonicalizeAttestation({ ...FIXTURE, findMyOff: false }),
    );
    expect(changedBattery).not.toBe(base);
    expect(changedFindMy).not.toBe(base);
  });

  it("produces a 64-char hex digest (sha256)", () => {
    const hash = computeCommitHash(canonicalizeAttestation(FIXTURE));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
