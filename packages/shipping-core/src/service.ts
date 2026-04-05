import type { TrustTriggerEvent } from "@haggle/commerce-core";
import { createId } from "./id.js";
import type { CarrierProvider } from "./provider.js";
import { transitionShipmentStatus } from "./state-machine.js";
import type { Shipment, ShipmentEvent, ShipmentStatus } from "./types.js";

export interface CreateShipmentInput {
  order_id: string;
  carrier: string;
  now?: string;
}

export interface ShippingServiceResult<T = undefined> {
  shipment: Shipment;
  value?: T;
  trust_triggers: TrustTriggerEvent[];
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function transitionOrThrow(
  status: ShipmentStatus,
  event: Parameters<typeof transitionShipmentStatus>[1],
): ShipmentStatus {
  const next = transitionShipmentStatus(status, event);
  if (!next) {
    throw new Error(`invalid shipment transition: ${status} -> ${event}`);
  }
  return next;
}

export class ShippingService {
  constructor(
    private readonly carriers: Partial<Record<string, CarrierProvider>>,
  ) {}

  createShipment(input: CreateShipmentInput): Shipment {
    const ts = nowIso(input.now);
    return {
      id: createId("shp"),
      order_id: input.order_id,
      carrier: input.carrier,
      status: "LABEL_PENDING",
      created_at: ts,
      updated_at: ts,
      events: [],
    };
  }

  async createLabel(
    shipment: Shipment,
    now?: string,
  ): Promise<ShippingServiceResult> {
    const carrier = this.resolveCarrier(shipment.carrier);
    const result = await carrier.createLabel(shipment);
    const nextStatus = transitionOrThrow(shipment.status, "label_create");
    const ts = nowIso(now);

    const event: ShipmentEvent = {
      id: createId("evt"),
      shipment_id: shipment.id,
      status: nextStatus,
      occurred_at: ts,
      carrier_raw_status: result.carrier_raw_status,
      message: "Label created",
    };

    return {
      shipment: {
        ...shipment,
        status: nextStatus,
        tracking_number: result.tracking_number,
        tracking_url: result.tracking_url,
        updated_at: ts,
        events: [...shipment.events, event],
      },
      trust_triggers: [],
    };
  }

  recordEvent(
    shipment: Shipment,
    eventType: Parameters<typeof transitionShipmentStatus>[1],
    eventData?: Partial<
      Pick<ShipmentEvent, "carrier_raw_status" | "message" | "location">
    >,
    now?: string,
  ): ShippingServiceResult {
    const nextStatus = transitionOrThrow(shipment.status, eventType);
    const ts = nowIso(now);

    const event: ShipmentEvent = {
      id: createId("evt"),
      shipment_id: shipment.id,
      status: nextStatus,
      occurred_at: ts,
      carrier_raw_status: eventData?.carrier_raw_status,
      message: eventData?.message,
      location: eventData?.location,
    };

    const updates: Partial<Shipment> = {
      status: nextStatus,
      updated_at: ts,
      events: [...shipment.events, event],
    };

    if (nextStatus === "DELIVERED") {
      updates.delivered_at = ts;
    }

    return {
      shipment: { ...shipment, ...updates } as Shipment,
      trust_triggers: [],
    };
  }

  async trackShipment(
    shipment: Shipment,
    now?: string,
  ): Promise<ShippingServiceResult> {
    if (!shipment.tracking_number) {
      throw new Error("cannot track shipment without tracking number");
    }

    const carrier = this.resolveCarrier(shipment.carrier);
    const result = await carrier.track(shipment.tracking_number);

    const currentStatus = shipment.status;
    if (result.canonical_status === currentStatus) {
      return { shipment, trust_triggers: [] };
    }

    const eventType = this.statusToEvent(result.canonical_status);
    if (!eventType) {
      return { shipment, trust_triggers: [] };
    }

    return this.recordEvent(
      shipment,
      eventType,
      {
        carrier_raw_status: result.carrier_raw_status,
        message: result.message,
        location: result.location,
      },
      now,
    );
  }

  processWebhook(
    shipment: Shipment,
    raw: Record<string, unknown>,
  ): ShippingServiceResult | null {
    const carrier = this.resolveCarrier(shipment.carrier);
    const event = carrier.parseWebhookEvent(raw);
    if (!event) return null;

    const eventType = this.statusToEvent(event.status);
    if (!eventType) return null;

    return this.recordEvent(shipment, eventType, {
      carrier_raw_status: event.carrier_raw_status,
      message: event.message,
      location: event.location,
    });
  }

  private resolveCarrier(name: string): CarrierProvider {
    const carrier = this.carriers[name];
    if (!carrier) {
      throw new Error(`no carrier provider registered: ${name}`);
    }
    return carrier;
  }

  private statusToEvent(
    status: ShipmentStatus,
  ): Parameters<typeof transitionShipmentStatus>[1] | null {
    const map: Partial<
      Record<ShipmentStatus, Parameters<typeof transitionShipmentStatus>[1]>
    > = {
      LABEL_CREATED: "label_create",
      IN_TRANSIT: "ship",
      OUT_FOR_DELIVERY: "out_for_delivery",
      DELIVERED: "deliver",
      DELIVERY_EXCEPTION: "exception",
      RETURN_IN_TRANSIT: "return_ship",
      RETURNED: "return_complete",
    };
    return map[status] ?? null;
  }
}
