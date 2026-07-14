WITH latest_carrier_event AS (
  SELECT DISTINCT ON (shipment_id)
         shipment_id,
         id,
         occurred_at
    FROM shipment_events
   ORDER BY shipment_id, occurred_at DESC, id DESC
)
UPDATE shipments AS shipment
   SET last_carrier_event_at = latest.occurred_at,
       last_carrier_event_key = 'legacy:' || latest.id::text
  FROM latest_carrier_event AS latest
 WHERE shipment.id = latest.shipment_id
   AND shipment.last_carrier_event_at IS NULL;
