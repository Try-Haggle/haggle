import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLegitWebhook } from "../legit-webhook.js";

const SECRET = "test-webhook-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyLegitWebhook", () => {
  const body = '{"event_type":"authentication.completed","case_id":"case_abc"}';

  it("returns true for valid signature", () => {
    const headers = { "x-legitapp-signature": sign(body) };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(true);
  });

  it("returns true for signature with sha256= prefix", () => {
    const headers = { "x-legitapp-signature": `sha256=${sign(body)}` };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const headers = { "x-legitapp-signature": "deadbeef".repeat(8) };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(false);
  });

  it("returns false for missing signature header", () => {
    expect(verifyLegitWebhook(body, {}, SECRET)).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const headers = { "x-legitapp-signature": sign(body, "wrong-secret") };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(false);
  });

  it("returns false for tampered body", () => {
    const headers = { "x-legitapp-signature": sign(body) };
    expect(verifyLegitWebhook(body + "tampered", headers, SECRET)).toBe(false);
  });

  it("works with Buffer body", () => {
    const buf = Buffer.from(body, "utf-8");
    const headers = { "x-legitapp-signature": sign(body) };
    expect(verifyLegitWebhook(buf, headers, SECRET)).toBe(true);
  });

  it("handles case-insensitive header names", () => {
    const headers = { "X-LegitApp-Signature": sign(body) };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(true);
  });

  it("handles uppercase header names", () => {
    const headers = { "X-LEGITAPP-SIGNATURE": sign(body) };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(true);
  });

  it("returns false for malformed hex signature", () => {
    const headers = { "x-legitapp-signature": "not-valid-hex" };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(false);
  });

  it("returns false for empty signature", () => {
    const headers = { "x-legitapp-signature": "" };
    expect(verifyLegitWebhook(body, headers, SECRET)).toBe(false);
  });
});
