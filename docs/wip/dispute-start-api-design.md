# Dispute Start API Design

## Scope

This slice hardens the first real-money boundary in the dispute system: opening a dispute against an existing commerce order. Demo pages can call this path, but the API is designed for production use first.

## Product Philosophy

- The server, not the client, decides who the actor is.
- A dispute freezes money movement before any adjudication starts.
- Every accepted dispute must be replay-safe: refreshes, retries, or dropped responses cannot create duplicate cases.
- Evidence is central, but file evidence should flow through Haggle-controlled storage rather than arbitrary external URLs.
- The system should grow into a dispute module that other commerce surfaces can call without inheriting UI assumptions.

## API Contract

### Open Dispute

`POST /orders/:orderId/disputes`

Request:

```json
{
  "reason_code": "ITEM_NOT_AS_DESCRIBED",
  "summary": "Battery health was listed as 92%, but the phone reports 72%.",
  "client_request_id": "optional-idempotency-key",
  "evidence": [
    { "type": "text", "text": "Initial text evidence." }
  ]
}
```

Server behavior:

- Auth is required.
- `orderId` is read from the path.
- Buyer/seller role is derived from the authenticated user and the order.
- `opened_by` and `submitted_by` are never trusted from the public body.
- The order must be in a disputable state.
- An active dispute for the order blocks new disputes.
- If the same `client_request_id` already opened the active dispute, the API returns that existing dispute.
- Creating the dispute and moving the order to `IN_DISPUTE` happen in one transaction.

Response:

```json
{
  "dispute": { "...": "..." },
  "opened_by": "buyer",
  "order_status": "IN_DISPUTE",
  "idempotent": false
}
```

## Security Decisions

- Disputable order states are intentionally narrow: `PAID`, `FULFILLMENT_PENDING`, `FULFILLMENT_ACTIVE`, `DELIVERED`, `IN_DISPUTE`.
- `IN_DISPUTE` allows idempotent replay only; it does not permit another independent dispute.
- Public text evidence is capped by the shared input limits.
- Public file evidence is not accepted in this slice. Image/video upload remains on the controlled upload-url path.
- A partial unique DB index prevents more than one active dispute per order even under race.

## Next Slices

- Draft dispute creation and explicit submit.
- Reason-code policy registry with role, order-state, and required-evidence rules.
- Append-only dispute audit event table.
- External platform dispute module contract.

## Controlled Evidence Upload

### Design

File evidence is powerful but risky: arbitrary URLs create phishing, tracking, and stale-file problems, while direct file uploads make it hard to prove which party submitted which artifact. Haggle should own the storage path and record an upload intent before the browser sends bytes.

### API Contract

`POST /disputes/:id/evidence/upload-url`

Request:

```json
{
  "filename": "battery-health.png",
  "content_type": "image/png",
  "file_size_bytes": 420000
}
```

Behavior:

- Auth and dispute-party access are required.
- The dispute must be in an evidence-accepting state.
- The server derives `uploaded_by` from the dispute order.
- The server validates type, size, count limits, and storage path.
- A pending upload intent is written before returning the signed URL.

`POST /disputes/:id/evidence/commit`

Request:

```json
{
  "storage_path": "dispute-evidence/<dispute-id>/<upload-id>_battery-health.png",
  "type": "image",
  "description": "Battery health screen."
}
```

Behavior:

- The storage path must belong to this dispute.
- A matching pending upload intent must exist.
- The caller's role must match the role that requested the upload URL.
- The committed evidence type must match the upload intent's content type.
- The uploaded object must exist in private storage.
- Commit and intent status change happen in one transaction.

### Security Decisions

- Commit cannot introduce an unissued storage path.
- Commit cannot relabel image uploads as video, or vice versa.
- Commit cannot be replayed after an upload intent is already committed.
- File evidence remains viewable only through short-lived signed view URLs.
