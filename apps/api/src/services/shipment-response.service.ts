interface ShipmentWithLabelAssets {
  seller_id: string;
  buyer_id: string;
  shipment_type?: string;
  label_url?: string;
  label_qr_code_url?: string;
  label_qr_code_available?: boolean;
  metadata?: Record<string, unknown>;
}

interface ShipmentViewer {
  id: string;
  role?: string;
}

const SELLER_ONLY_LABEL_METADATA_KEYS = [
  "label_qr_code_url",
  "label_qr_code_form_id",
  "label_qr_code_status",
  "label_qr_code_reason",
  "label_print_methods",
] as const;

/**
 * Label assets belong to the party fulfilling the shipment: the seller for an
 * outbound shipment and the buyer for a return shipment. Other participants
 * can still see tracking and delivery status without receiving printable
 * labels or carrier QR credentials.
 */
export function shipmentForViewer<T extends ShipmentWithLabelAssets>(
  shipment: T,
  viewer: ShipmentViewer | undefined,
): T {
  const labelOwnerId = shipment.shipment_type === "return" ? shipment.buyer_id : shipment.seller_id;
  if (viewer?.role === "admin" || viewer?.id === labelOwnerId) {
    return shipment;
  }

  const redacted = { ...shipment } as Record<string, unknown>;
  delete redacted.label_url;
  delete redacted.label_qr_code_url;
  delete redacted.label_qr_code_available;

  if (shipment.metadata) {
    const metadata = { ...shipment.metadata };
    for (const key of SELLER_ONLY_LABEL_METADATA_KEYS) {
      delete metadata[key];
    }
    redacted.metadata = metadata;
  }

  return redacted as T;
}
