import { createHmac, timingSafeEqual } from "node:crypto";
import { mapEasyPostStatus } from "./easypost-adapter.js";
import type { ShipmentStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify that an incoming EasyPost webhook payload is authentic by checking
 * its HMAC-SHA256 signature against the configured webhook secret.
 *
 * EasyPost sends the signature in the `x-hmac-signature` header as a
 * hex-encoded HMAC-SHA256 digest of the raw request body.
 *
 * @param rawBody - The raw request body (string or Buffer, before JSON parsing)
 * @param headers - Incoming HTTP headers (keys lowercased)
 * @param webhookSecret - The webhook secret configured in the EasyPost dashboard
 * @returns `true` if the signature is valid
 */
export function verifyEasyPostWebhook(
  rawBody: string | Buffer,
  headers: Record<string, string>,
  webhookSecret: string,
): boolean {
  try {
    // EasyPost uses the header "x-hmac-signature" (lowercased in most frameworks)
    const signature =
      headers["x-hmac-signature"] ??
      headers["X-Hmac-Signature"] ??
      headers["X-HMAC-SIGNATURE"];

    if (!signature) return false;

    // Strip the optional "hmac-sha256-hex=" prefix that EasyPost may include
    const rawSignature = signature.startsWith("hmac-sha256-hex=")
      ? signature.slice("hmac-sha256-hex=".length)
      : signature;

    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(rawSignature, "hex");
    const expBuf = Buffer.from(expected, "hex");

    if (sigBuf.length !== expBuf.length) return false;

    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook payload parsing
// ---------------------------------------------------------------------------

export interface EasyPostWebhookTrackingDetail {
  message: string;
  status: string;
  datetime: string;
  city?: string;
  state?: string;
}

export interface EasyPostWebhookPayload {
  tracking_code: string;
  status: ShipmentStatus;
  carrier: string;
  est_delivery_date?: string;
  tracking_details: EasyPostWebhookTrackingDetail[];
}

// ---------------------------------------------------------------------------
// ShipmentInvoice (APV weight adjustment) parsing
// ---------------------------------------------------------------------------

export interface EasyPostInvoiceAdjustment {
  shipment_id: string;
  tracking_code: string;
  original_rate_minor: number;
  adjusted_rate_minor: number;
  /** adjusted - original (positive = carrier underpaid, seller owes more) */
  adjustment_minor: number;
}

/**
 * Parse an EasyPost ShipmentInvoice webhook payload into an adjustment record.
 *
 * Expected shape:
 * ```json
 * {
 *   "description": "shipment_invoice.created",
 *   "result": {
 *     "id": "shinv_...",
 *     "shipment_id": "shp_...",
 *     "charges": [{ "type": "shipping", "amount": "7.50" }],
 *     "original_rate": "5.50",
 *     "tracking_code": "..."
 *   }
 * }
 * ```
 *
 * @returns Parsed adjustment or `null` if the body is not a shipment_invoice event.
 */
export function parseEasyPostInvoicePayload(
  body: unknown,
): EasyPostInvoiceAdjustment | null {
  try {
    if (!body || typeof body !== "object") return null;

    const event = body as Record<string, unknown>;
    const description = event.description as string | undefined;

    // Only handle shipment_invoice events
    if (!description || !description.startsWith("shipment_invoice")) return null;

    const result = event.result as Record<string, unknown> | undefined;
    if (!result) return null;

    const shipment_id = result.shipment_id as string | undefined;
    const tracking_code = result.tracking_code as string | undefined;
    const original_rate_str = result.original_rate as string | undefined;

    if (!shipment_id || !tracking_code || !original_rate_str) return null;

    const original_rate = parseFloat(original_rate_str);
    if (Number.isNaN(original_rate)) return null;

    // Sum all shipping charges to get the adjusted total
    const charges = result.charges as Array<Record<string, unknown>> | undefined;
    if (!charges || charges.length === 0) return null;

    let adjusted_total = 0;
    for (const charge of charges) {
      if (charge.type === "shipping") {
        const amount = parseFloat(charge.amount as string);
        if (!Number.isNaN(amount)) {
          adjusted_total += amount;
        }
      }
    }

    const original_rate_minor = Math.round(original_rate * 100);
    const adjusted_rate_minor = Math.round(adjusted_total * 100);
    const adjustment_minor = adjusted_rate_minor - original_rate_minor;

    return {
      shipment_id,
      tracking_code,
      original_rate_minor,
      adjusted_rate_minor,
      adjustment_minor,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tracker webhook payload parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw EasyPost webhook body into a normalised tracking payload.
 *
 * Expected EasyPost event shape:
 * ```json
 * {
 *   "description": "tracker.updated",
 *   "result": {
 *     "tracking_code": "...",
 *     "status": "in_transit",
 *     "carrier": "USPS",
 *     "est_delivery_date": "2026-04-01T00:00:00Z",
 *     "tracking_details": [
 *       {
 *         "message": "Arrived at facility",
 *         "status": "in_transit",
 *         "datetime": "2026-03-25T14:00:00Z",
 *         "tracking_location": { "city": "LA", "state": "CA" }
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * @returns Parsed payload or `null` if the body is not a valid tracker event.
 */
export function parseEasyPostWebhookPayload(
  body: unknown,
): EasyPostWebhookPayload | null {
  try {
    if (!body || typeof body !== "object") return null;

    const event = body as Record<string, unknown>;
    const result = event.result as Record<string, unknown> | undefined;
    if (!result) return null;

    const trackingCode = result.tracking_code as string | undefined;
    const rawStatus = result.status as string | undefined;
    const carrier = result.carrier as string | undefined;

    if (!trackingCode || !rawStatus || !carrier) return null;

    const rawDetails = result.tracking_details as
      | Array<Record<string, unknown>>
      | undefined;

    const trackingDetails: EasyPostWebhookTrackingDetail[] = (
      rawDetails ?? []
    ).map((detail) => {
      const loc = detail.tracking_location as
        | Record<string, string>
        | undefined;
      return {
        message: (detail.message as string) ?? "",
        status: (detail.status as string) ?? "",
        datetime: (detail.datetime as string) ?? "",
        city: loc?.city ?? undefined,
        state: loc?.state ?? undefined,
      };
    });

    return {
      tracking_code: trackingCode,
      status: mapEasyPostStatus(rawStatus),
      carrier,
      est_delivery_date:
        (result.est_delivery_date as string) ?? undefined,
      tracking_details: trackingDetails,
    };
  } catch {
    return null;
  }
}
