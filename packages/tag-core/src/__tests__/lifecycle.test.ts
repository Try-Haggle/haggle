import { describe, it, expect } from "vitest";
import {
  promote,
  autoPromote,
  deprecate,
  reactivate,
  isValidTransition,
  VALID_TRANSITIONS,
} from "../lifecycle.js";
import type { Tag } from "../types.js";
import { defaultTagConfig } from "../types.js";

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-1",
    name: "Electronics",
    normalizedName: "electronics",
    status: "CANDIDATE",
    category: "ELECTRONICS_SMALL",
    useCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    lastUsedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

describe("promote", () => {
  it("promotes CANDIDATE to EMERGING at threshold", () => {
    const tag = makeTag({ useCount: 10 });
    const result = promote(tag);
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("EMERGING");
    expect(result.previousStatus).toBe("CANDIDATE");
  });

  it("promotes EMERGING to OFFICIAL at threshold", () => {
    const tag = makeTag({ status: "EMERGING", useCount: 50 });
    const result = promote(tag);
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("OFFICIAL");
  });

  it("does not promote CANDIDATE below threshold", () => {
    const tag = makeTag({ useCount: 5 });
    const result = promote(tag);
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("CANDIDATE");
  });

  it("does not promote OFFICIAL further", () => {
    const tag = makeTag({ status: "OFFICIAL", useCount: 100 });
    const result = promote(tag);
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("OFFICIAL");
  });

  it("uses custom config thresholds", () => {
    const config = { ...defaultTagConfig(), candidateToEmergingUses: 5 };
    const tag = makeTag({ useCount: 5 });
    const result = promote(tag, config);
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("EMERGING");
  });

  it("does not promote DEPRECATED tag", () => {
    const tag = makeTag({ status: "DEPRECATED", useCount: 100 });
    const result = promote(tag);
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("DEPRECATED");
  });

  it("does not mutate the input tag", () => {
    const tag = makeTag({ useCount: 10 });
    promote(tag);
    expect(tag.status).toBe("CANDIDATE");
  });
});

describe("autoPromote", () => {
  it("skips CANDIDATE straight to OFFICIAL when count is high enough", () => {
    const tag = makeTag({ useCount: 50 });
    const result = autoPromote(tag);
    expect(result.transitioned).toBe(true);
    expect(result.previousStatus).toBe("CANDIDATE");
    expect(result.newStatus).toBe("OFFICIAL");
  });

  it("promotes CANDIDATE to EMERGING only when count is between thresholds", () => {
    const tag = makeTag({ useCount: 15 });
    const result = autoPromote(tag);
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("EMERGING");
  });

  it("is a no-op on OFFICIAL tag", () => {
    const tag = makeTag({ status: "OFFICIAL", useCount: 100 });
    const result = autoPromote(tag);
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("OFFICIAL");
  });

  it("is a no-op on DEPRECATED tag", () => {
    const tag = makeTag({ status: "DEPRECATED", useCount: 100 });
    const result = autoPromote(tag);
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("DEPRECATED");
  });
});

describe("deprecate (invalid date handling)", () => {
  it("returns error result for garbage nowIso", () => {
    const tag = makeTag({ status: "OFFICIAL", lastUsedAt: "2026-01-01T00:00:00Z" });
    const result = deprecate(tag, "not-a-date");
    expect(result.transitioned).toBe(false);
    expect(result.reason).toBe("Invalid date: nowIso");
  });

  it("returns error result for invalid lastUsedAt", () => {
    const tag = makeTag({ status: "OFFICIAL", lastUsedAt: "garbage" });
    const result = deprecate(tag, "2026-04-02T00:00:00Z");
    expect(result.transitioned).toBe(false);
    expect(result.reason).toBe("Invalid date: lastUsedAt");
  });
});

describe("deprecate", () => {
  it("deprecates tag unused for 90+ days", () => {
    const tag = makeTag({ status: "OFFICIAL", lastUsedAt: "2026-01-01T00:00:00Z" });
    const result = deprecate(tag, "2026-04-02T00:00:00Z");
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("DEPRECATED");
  });

  it("does not deprecate recently used tag", () => {
    const tag = makeTag({ status: "OFFICIAL", lastUsedAt: "2026-03-30T00:00:00Z" });
    const result = deprecate(tag, "2026-04-02T00:00:00Z");
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("OFFICIAL");
  });

  it("does not deprecate already deprecated tag", () => {
    const tag = makeTag({ status: "DEPRECATED", lastUsedAt: "2025-01-01T00:00:00Z" });
    const result = deprecate(tag, "2026-04-02T00:00:00Z");
    expect(result.transitioned).toBe(false);
    expect(result.reason).toBe("Tag is already deprecated");
  });

  it("respects custom deprecation threshold", () => {
    const config = { ...defaultTagConfig(), deprecationDaysUnused: 30 };
    const tag = makeTag({ status: "OFFICIAL", lastUsedAt: "2026-03-01T00:00:00Z" });
    const result = deprecate(tag, "2026-04-02T00:00:00Z", config);
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("DEPRECATED");
  });
});

describe("reactivate", () => {
  it("reactivates DEPRECATED tag to CANDIDATE", () => {
    const tag = makeTag({ status: "DEPRECATED" });
    const result = reactivate(tag);
    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe("CANDIDATE");
  });

  it("does not reactivate non-deprecated tag", () => {
    const tag = makeTag({ status: "OFFICIAL" });
    const result = reactivate(tag);
    expect(result.transitioned).toBe(false);
    expect(result.newStatus).toBe("OFFICIAL");
  });
});

describe("isValidTransition", () => {
  it("allows CANDIDATE -> EMERGING", () => {
    expect(isValidTransition("CANDIDATE", "EMERGING")).toBe(true);
  });

  it("allows DEPRECATED -> CANDIDATE", () => {
    expect(isValidTransition("DEPRECATED", "CANDIDATE")).toBe(true);
  });

  it("disallows CANDIDATE -> OFFICIAL (skip)", () => {
    expect(isValidTransition("CANDIDATE", "OFFICIAL")).toBe(false);
  });

  it("disallows OFFICIAL -> CANDIDATE", () => {
    expect(isValidTransition("OFFICIAL", "CANDIDATE")).toBe(false);
  });
});
