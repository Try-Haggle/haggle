/**
 * Shipment SLA Check Job
 *
 * Detects shipments stuck in LABEL_PENDING after the shipment input
 * deadline has passed. For each, opens a dispute case with reason
 * SELLER_NO_FULFILLMENT so the buyer is protected.
 *
 * Schedule: every 15 minutes
 * Batch limit: 100 records per run
 */

import {
  type Database,
  shipments,
  disputeCases,
  commerceOrders,
  eq,
  and,
  lt,
  sql,
} from "@haggle/db";

const BATCH_LIMIT = 100;

export async function runShipmentSlaCheck(db: Database): Promise<void> {
  const now = new Date();

  // Find shipments past their input deadline that are still LABEL_PENDING
  const overdue = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
    })
    .from(shipments)
    .where(
      and(
        eq(shipments.status, "LABEL_PENDING"),
        lt(shipments.shipmentInputDueAt, now),
      ),
    )
    .limit(BATCH_LIMIT);

  if (overdue.length === 0) return;

  let disputes = 0;

  for (const row of overdue) {
    try {
      // Check if a dispute already exists for this order to avoid duplicates
      const existing = await db.query.disputeCases.findFirst({
        where: (fields, ops) =>
          ops.and(
            ops.eq(fields.orderId, row.orderId),
            ops.eq(fields.reasonCode, "SELLER_NO_FULFILLMENT"),
          ),
      });

      if (existing) continue;

      // Create dispute case
      await db.insert(disputeCases).values({
        orderId: row.orderId,
        reasonCode: "SELLER_NO_FULFILLMENT",
        status: "OPEN",
        openedBy: "system",
        openedAt: now,
        metadata: {
          source: "shipment-sla-check",
          shipment_id: row.id,
          detected_at: now.toISOString(),
        },
      });

      // Transition order to IN_DISPUTE — only if not already in a terminal state
      const terminalStatuses = ["CLOSED", "REFUNDED", "COMPLETED", "CANCELED", "IN_DISPUTE"];
      await db
        .update(commerceOrders)
        .set({ status: "IN_DISPUTE", updatedAt: now })
        .where(
          and(
            eq(commerceOrders.id, row.orderId),
            sql`${commerceOrders.status} NOT IN (${sql.join(terminalStatuses.map(s => sql`${s}`), sql`, `)})`,
          ),
        );

      disputes += 1;
    } catch (error) {
      console.error(
        `[shipment-sla-check] Failed to create dispute for order ${row.orderId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (disputes > 0) {
    console.log(`[shipment-sla-check] Created ${disputes} dispute(s) for SLA violations`);
  }
}
