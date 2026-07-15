import { createHmac, timingSafeEqual } from "node:crypto";
import { mapEasyPostStatus } from "./easypost-adapter.js";
import type { ShipmentStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

export interface VerifyEasyPostWebhookOptions {
  method?: string;
  timestampToleranceMinutes?: number;
  now?: Date;
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name];
  const lower = headers[name.toLowerCase()];
  const upper = headers[name.toUpperCase()];
  const value = direct ?? lower ?? upper;
  if (Array.isArray(value)) return value[0];
  return value;
}

function stripHmacPrefix(signature: string): string {
  const prefix = "hmac-sha256-hex=";
  return signature.toLowerCase().startsWith(prefix) ? signature.slice(prefix.length) : signature;
}

function timingSafeHexEqual(received: string, expected: string): boolean {
  const receivedHex = stripHmacPrefix(received).toLowerCase();
  const expectedHex = expected.toLowerCase();
  const sigBuf = Buffer.from(receivedHex, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");

  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}

function isTimestampWithinTolerance(
  timestamp: string,
  toleranceMinutes: number,
  now: Date,
): boolean {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return false;

  const ageMs = now.getTime() - timestampMs;
  const toleranceMs = toleranceMinutes * 60 * 1000;
  const futureSkewMs = 30 * 1000;

  return ageMs <= toleranceMs && ageMs >= -futureSkewMs;
}

/**
 * Verify that an incoming EasyPost webhook payload is authentic by checking
 * its HMAC-SHA256 signature against the configured webhook secret.
 *
 * EasyPost's v2 webhook HMAC signs timestamp + method + path + raw body and
 * includes replay protection via `x-timestamp`. The legacy body-only
 * `x-hmac-signature` form is still accepted for older webhook configurations.
 *
 * @param rawBody - The raw request body (string or Buffer, before JSON parsing)
 * @param headers - Incoming HTTP headers
 * @param webhookSecret - The webhook secret configured in the EasyPost dashboard
 * @returns `true` if the signature is valid
 */
export function verifyEasyPostWebhook(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
  options: VerifyEasyPostWebhookOptions = {},
): boolean {
  try {
    if (!webhookSecret) return false;

    const signatureV2 = getHeader(headers, "x-hmac-signature-v2");
    if (signatureV2) {
      const timestamp = getHeader(headers, "x-timestamp");
      const path = getHeader(headers, "x-path");
      if (!timestamp || !path) return false;

      const toleranceMinutes = options.timestampToleranceMinutes ?? 1;
      if (!isTimestampWithinTolerance(timestamp, toleranceMinutes, options.now ?? new Date())) {
        return false;
      }

      const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
      const method = (options.method ?? "POST").toUpperCase();
      const stringToSign = `${timestamp}${method}${path}${body}`;
      const expected = createHmac("sha256", webhookSecret)
        .update(stringToSign, "utf8")
        .digest("hex");

      return timingSafeHexEqual(signatureV2, expected);
    }

    const signature = getHeader(headers, "x-hmac-signature");
    if (!signature) return false;

    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    return timingSafeHexEqual(signature, expected);
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
  occurred_at?: string;
  carrier_raw_status: string;
  message?: string;
  location?: string;
}

// ---------------------------------------------------------------------------
// ShipmentInvoice (APV weight adjustment) parsing
// ---------------------------------------------------------------------------

export interface EasyPostInvoiceAdjustment {
  invoice_event: "created" | "updated";
  invoice_id: string;
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
 *   "description": "shipment.invoice.created",
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
export function parseEasyPostInvoicePayload(body: unknown): EasyPostInvoiceAdjustment | null {
  try {
    if (!body || typeof body !== "object") return null;

    const event = body as Record<string, unknown>;
    const description = event.description as string | undefined;

    // EasyPost documents dotted event names. Keep the legacy underscore form
    // for already-recorded fixtures while normalizing both to one event type.
    const invoiceEvent =
      description === "shipment.invoice.created" || description === "shipment_invoice.created"
        ? "created"
        : description === "shipment.invoice.updated" || description === "shipment_invoice.updated"
          ? "updated"
          : null;
    if (!invoiceEvent) return null;

    const result = event.result as Record<string, unknown> | undefined;
    if (!result) return null;

    const invoice_id = result.id as string | undefined;
    const shipment_id = result.shipment_id as string | undefined;
    const tracking_code = result.tracking_code as string | undefined;
    const original_rate_str = result.original_rate as string | undefined;

    if (!invoice_id || !shipment_id || !tracking_code || !original_rate_str) return null;
    if (invoice_id.length > 128 || shipment_id.length > 128 || tracking_code.length > 128)
      return null;

    const original_rate = parseFloat(original_rate_str);
    if (!Number.isFinite(original_rate) || original_rate < 0 || original_rate > 100_000)
      return null;

    // Sum all shipping charges to get the adjusted total
    const charges = result.charges as Array<Record<string, unknown>> | undefined;
    if (!charges || charges.length === 0) return null;

    let adjusted_total = 0;
    let shippingChargeCount = 0;
    for (const charge of charges) {
      if (charge.type === "shipping") {
        const amount = parseFloat(charge.amount as string);
        if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) return null;
        adjusted_total += amount;
        shippingChargeCount += 1;
      }
    }
    if (shippingChargeCount === 0 || !Number.isFinite(adjusted_total) || adjusted_total > 100_000)
      return null;

    const original_rate_minor = Math.round(original_rate * 100);
    const adjusted_rate_minor = Math.round(adjusted_total * 100);
    const adjustment_minor = adjusted_rate_minor - original_rate_minor;

    return {
      invoice_event: invoiceEvent,
      invoice_id,
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
export function parseEasyPostWebhookPayload(body: unknown): EasyPostWebhookPayload | null {
  try {
    if (!body || typeof body !== "object") return null;

    const event = body as Record<string, unknown>;
    const result = event.result as Record<string, unknown> | undefined;
    if (!result) return null;

    const trackingCode = result.tracking_code as string | undefined;
    const rawStatus = result.status as string | undefined;
    const carrier = result.carrier as string | undefined;

    if (!trackingCode || !rawStatus || !carrier) return null;

    const rawDetails = result.tracking_details as Array<Record<string, unknown>> | undefined;

    const trackingDetails: EasyPostWebhookTrackingDetail[] = (rawDetails ?? []).map((detail) => {
      const loc = detail.tracking_location as Record<string, string> | undefined;
      return {
        message: (detail.message as string) ?? "",
        status: (detail.status as string) ?? "",
        datetime: (detail.datetime as string) ?? "",
        city: loc?.city ?? undefined,
        state: loc?.state ?? undefined,
      };
    });

    const latestDetail = trackingDetails.reduce<EasyPostWebhookTrackingDetail | undefined>(
      (latest, detail) => {
        const detailTime = new Date(detail.datetime).getTime();
        if (!Number.isFinite(detailTime)) return latest;
        if (!latest) return detail;
        return detailTime > new Date(latest.datetime).getTime() ? detail : latest;
      },
      undefined,
    );
    const location = latestDetail
      ? [latestDetail.city, latestDetail.state].filter(Boolean).join(", ")
      : undefined;

    return {
      tracking_code: trackingCode,
      status: mapEasyPostStatus(rawStatus),
      carrier,
      est_delivery_date: (result.est_delivery_date as string) ?? undefined,
      tracking_details: trackingDetails,
      occurred_at: latestDetail?.datetime || undefined,
      carrier_raw_status: rawStatus,
      message: latestDetail?.message || undefined,
      location: location || undefined,
    };
  } catch {
    return null;
  }
}
