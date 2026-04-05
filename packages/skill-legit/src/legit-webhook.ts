import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify that an incoming LegitApp webhook payload is authentic by checking
 * its HMAC-SHA256 signature against the configured webhook secret.
 *
 * Mirrors the EasyPost webhook verification pattern from shipping-core.
 * The exact header name/format may need adjustment once LegitApp documents
 * their actual signing scheme.
 *
 * @param rawBody - Raw request body (string or Buffer, before JSON parsing)
 * @param headers - Incoming HTTP headers (keys lowercased)
 * @param webhookSecret - The webhook secret from LegitApp dashboard
 * @returns `true` if the signature is valid
 */
export function verifyLegitWebhook(
  rawBody: string | Buffer,
  headers: Record<string, string>,
  webhookSecret: string,
): boolean {
  try {
    const signature =
      headers["x-legitapp-signature"] ??
      headers["X-LegitApp-Signature"] ??
      headers["X-LEGITAPP-SIGNATURE"];

    if (!signature) return false;

    // Strip optional prefix (e.g. "sha256=")
    const rawSignature = signature.startsWith("sha256=")
      ? signature.slice("sha256=".length)
      : signature;

    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const sigBuf = Buffer.from(rawSignature, "hex");
    const expBuf = Buffer.from(expected, "hex");

    if (sigBuf.length !== expBuf.length) return false;

    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
