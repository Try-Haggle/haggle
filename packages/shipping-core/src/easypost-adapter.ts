import EasyPost from "@easypost/api";
import { createId } from "./id.js";
import type {
  CarrierProvider,
  CarrierTrackingResult,
  CreateLabelResult,
  LabelRequest,
} from "./provider.js";
import type { Shipment, ShipmentEvent, ShipmentStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const EASYPOST_STATUS_MAP: Record<string, ShipmentStatus> = {
  pre_transit: "LABEL_CREATED",
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  return_to_sender: "RETURN_IN_TRANSIT",
  failure: "DELIVERY_EXCEPTION",
  unknown: "IN_TRANSIT",
  available_for_pickup: "OUT_FOR_DELIVERY",
  error: "DELIVERY_EXCEPTION",
};

/**
 * Map an EasyPost tracker status string to the canonical Haggle ShipmentStatus.
 */
export function mapEasyPostStatus(easypostStatus: string): ShipmentStatus {
  return EASYPOST_STATUS_MAP[easypostStatus] ?? "IN_TRANSIT";
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EasyPostConfig {
  api_key: string;
  /** When true the adapter uses the EasyPost test environment. Default false. */
  is_test?: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class EasyPostCarrierAdapter implements CarrierProvider {
  readonly carrier = "easypost";
  private readonly client: InstanceType<typeof EasyPost>;

  constructor(config: EasyPostConfig) {
    this.client = new EasyPost(config.api_key);
  }

  /**
   * Create a shipping label via EasyPost Shipment API, or fall back to
   * tracker-only registration when no `LabelRequest` is provided.
   *
   * When `request` is supplied the adapter:
   *   1. Creates an EasyPost Shipment with from/to addresses + parcel.
   *   2. Buys the cheapest rate (or a specific service if `service_level` is set).
   *   3. Returns the purchased label URL, tracking number, and rate.
   *
   * Without `request`, the original tracker-only behaviour is preserved so
   * existing call-sites remain backward-compatible.
   */
  async createLabel(shipment: Shipment, request?: LabelRequest): Promise<CreateLabelResult> {
    // -- Tracker-only fallback (no LabelRequest) -----------------------------
    if (!request) {
      if (!shipment.tracking_number) {
        throw new Error(
          `Shipment ${shipment.id} has no tracking_number — cannot register EasyPost tracker`,
        );
      }

      try {
        const tracker = await this.client.Tracker.create({
          tracking_code: shipment.tracking_number,
          carrier: shipment.carrier,
        });

        return {
          tracking_number: tracker.tracking_code ?? shipment.tracking_number,
          tracking_url: tracker.public_url ?? undefined,
          carrier_raw_status: tracker.status ?? "unknown",
          metadata: {
            easypost_tracker_id: tracker.id,
            easypost_carrier: tracker.carrier,
          },
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown EasyPost error";
        throw new Error(
          `EasyPost tracker creation failed for ${shipment.tracking_number}: ${message}`,
        );
      }
    }

    // -- Full label generation via EasyPost Shipment API ---------------------
    try {
      const epShipment = await this.client.Shipment.create({
        from_address: {
          name: request.from_address.name,
          street1: request.from_address.street1,
          street2: request.from_address.street2,
          city: request.from_address.city,
          state: request.from_address.state,
          zip: request.from_address.zip,
          country: request.from_address.country,
          phone: request.from_address.phone,
        },
        to_address: {
          name: request.to_address.name,
          street1: request.to_address.street1,
          street2: request.to_address.street2,
          city: request.to_address.city,
          state: request.to_address.state,
          zip: request.to_address.zip,
          country: request.to_address.country,
          phone: request.to_address.phone,
        },
        parcel: {
          weight: request.parcel.weight_oz,
          length: request.parcel.length_in,
          width: request.parcel.width_in,
          height: request.parcel.height_in,
        },
      });

      // Pick specific service or cheapest rate
      const rate = request.service_level
        ? epShipment.rates?.find((r: any) => r.service === request.service_level) ?? epShipment.lowestRate()
        : epShipment.lowestRate();

      const purchased = await this.client.Shipment.buy(epShipment.id, rate);

      return {
        tracking_number: purchased.tracking_code ?? "",
        tracking_url: purchased.tracker?.public_url ?? undefined,
        label_url: purchased.postage_label?.label_url ?? undefined,
        carrier_raw_status: purchased.status ?? "unknown",
        rate_minor: Math.round(parseFloat(rate.rate ?? "0") * 100),
        service: rate.service,
        metadata: {
          easypost_shipment_id: purchased.id,
          easypost_rate_id: rate.id,
          easypost_carrier: rate.carrier,
          easypost_service: rate.service,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown EasyPost error";
      throw new Error(`EasyPost label creation failed: ${message}`);
    }
  }

  /**
   * Retrieve the current tracking status from EasyPost.
   */
  async track(tracking_number: string): Promise<CarrierTrackingResult> {
    try {
      const tracker = await this.client.Tracker.create({
        tracking_code: tracking_number,
      });

      const latestDetail =
        tracker.tracking_details?.[tracker.tracking_details.length - 1];

      const location = latestDetail?.tracking_location
        ? [
            latestDetail.tracking_location.city,
            latestDetail.tracking_location.state,
          ]
            .filter(Boolean)
            .join(", ")
        : undefined;

      return {
        canonical_status: mapEasyPostStatus(tracker.status ?? "unknown"),
        carrier_raw_status: tracker.status ?? "unknown",
        location,
        message: latestDetail?.message ?? undefined,
        eta: tracker.est_delivery_date ?? undefined,
        delivered_at:
          tracker.status === "delivered"
            ? latestDetail?.datetime ?? undefined
            : undefined,
        metadata: {
          easypost_tracker_id: tracker.id,
          easypost_carrier: tracker.carrier,
          tracking_details_count: tracker.tracking_details?.length ?? 0,
        },
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown EasyPost error";
      throw new Error(
        `EasyPost tracking failed for ${tracking_number}: ${message}`,
      );
    }
  }

  /**
   * Parse an EasyPost webhook payload into our ShipmentEvent format.
   *
   * EasyPost webhook payloads have the shape:
   * ```json
   * {
   *   "description": "tracker.updated",
   *   "result": {
   *     "id": "trk_...",
   *     "tracking_code": "...",
   *     "status": "in_transit",
   *     "tracking_details": [...]
   *   }
   * }
   * ```
   */
  parseWebhookEvent(raw: Record<string, unknown>): ShipmentEvent | null {
    try {
      const result = raw.result as Record<string, unknown> | undefined;
      if (!result) return null;

      const trackingCode = result.tracking_code as string | undefined;
      const status = result.status as string | undefined;
      if (!trackingCode || !status) return null;

      const trackingDetails = result.tracking_details as
        | Array<Record<string, unknown>>
        | undefined;
      const latest = trackingDetails?.[trackingDetails.length - 1];

      const trackingLocation = latest?.tracking_location as
        | Record<string, string>
        | undefined;
      const location = trackingLocation
        ? [trackingLocation.city, trackingLocation.state]
            .filter(Boolean)
            .join(", ")
        : undefined;

      return {
        id: createId("evt"),
        shipment_id: (result.id as string) ?? "",
        status: mapEasyPostStatus(status),
        occurred_at:
          (latest?.datetime as string) ?? new Date().toISOString(),
        carrier_raw_status: status,
        message: (latest?.message as string) ?? undefined,
        location: location || undefined,
      };
    } catch {
      return null;
    }
  }
}
