export function createShipmentMutationHeaders(
  operation: string,
  shipmentId: string,
  resourceId: string,
  nonce = crypto.randomUUID(),
): Record<string, string> {
  return {
    "Idempotency-Key": `shipment-${operation}-${shipmentId}-${resourceId}-${nonce}`,
  };
}
