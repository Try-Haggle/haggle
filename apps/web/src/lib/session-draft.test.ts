import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "./session-draft";

interface Draft {
  choice: string;
}

function isDraft(value: unknown): value is Draft {
  return Boolean(value && typeof value === "object" && typeof (value as Draft).choice === "string");
}

describe("session drafts", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("round-trips a valid draft", () => {
    writeSessionDraft("draft", { choice: "saved" });
    expect(readSessionDraft("draft", isDraft)).toEqual({ choice: "saved" });
  });

  it("rejects malformed or invalid drafts", () => {
    window.sessionStorage.setItem("malformed", "{");
    window.sessionStorage.setItem("invalid", JSON.stringify({ choice: 3 }));
    expect(readSessionDraft("malformed", isDraft)).toBeNull();
    expect(readSessionDraft("invalid", isDraft)).toBeNull();
  });

  it("clears a draft", () => {
    writeSessionDraft("draft", { choice: "saved" });
    clearSessionDraft("draft");
    expect(readSessionDraft("draft", isDraft)).toBeNull();
  });
});
