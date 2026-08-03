# hUSDC Physical Shipping Rehearsal

Date: 2026-08-01

## Goal

Stage 2 keeps product payment on Base Sepolia hUSDC while exercising the real physical shipping
boundary. It proves that a seller can buy a real EasyPost label, hand a parcel to a carrier, receive
real tracking webhooks, and continue into buyer review, release, or dispute without using real USDC.

This mode is a paid rehearsal: hUSDC has no monetary value, but EasyPost live labels create real
carrier charges. Haggle's staging fiat budget pays those charges; hUSDC never reaches EasyPost and
does not reimburse the staging budget.

## Payment Boundary

EasyPost is a postage provider, not a crypto payment recipient. Haggle therefore separates the
buyer settlement rail from the provider funding rail.

### Staging rehearsal

1. The buyer funds the conditional settlement with hUSDC.
2. The seller selects the negotiated carrier service and requests a label.
3. Haggle buys the live EasyPost label from its EasyPost wallet/card/ACH balance in USD.
4. The shipment records `haggle_staging_fiat_subsidy`, the USD postage amount, and hUSDC as the
   buyer settlement asset in existing shipment metadata.
5. hUSDC remains inside the test settlement flow until release or dispute resolution.

### Production target

1. The negotiated order total identifies product amount, agreed shipping allowance, Haggle fee,
   and any disclosed measurement buffer separately.
2. The buyer funds that total in real USDC.
3. Haggle retains the shipping allowance in a shipping treasury and pays EasyPost in USD from a
   prefunded wallet/card/ACH balance.
4. Treasury reconciliation links the USDC shipping reserve to the EasyPost USD charge. Haggle can
   periodically off-ramp or rebalance the aggregate reserve; EasyPost never needs to accept USDC.
5. A buyer-requested service upgrade requires explicit additional USDC authorization. A seller's
   incorrect weight, dimensions, or declared value is charged against the disclosed buffer or the
   seller, not silently passed to the buyer.

The production treasury conversion and reconciliation ledger are intentionally outside this
staging rehearsal. This test proves the settlement and carrier boundaries without pretending that
hUSDC funds real postage.

## Two Test Cases

| Boundary | Integration test | Physical shipping rehearsal |
| --- | --- | --- |
| Product money | hUSDC on Base Sepolia | hUSDC on Base Sepolia |
| Addresses | EasyPost-safe test data | Real buyer and seller addresses |
| EasyPost | Test key | Live key |
| Label charge | No real carrier charge | Real carrier charge |
| Tracking | Team-controlled EasyPost test tracker | Actual carrier scans and signed webhook |
| Delivery | Manually advanced in order UI | Cannot be manually advanced |
| Release/dispute | Enabled after simulated delivery | Enabled after verified delivery |

For a new checkout, the buyer explicitly selects the execution mode before payment preparation.
The API stores `shipping_execution_mode` in the payment intent provider context and copies it into
shipment metadata when funding creates the shipment. Reusing an active payment intent with a
different mode is rejected. The seller can still select a mode on legacy `LABEL_PENDING` shipments,
but it becomes immutable once rates have been prepared.

Shipping mode and settlement asset are independent controls. The checkout displays the asset bound
to the deployed environment; it does not offer a per-order asset switch. Staging is bound to
`base-sepolia-husdc`, while real USDC requires a separately configured Base mainnet deployment. This
prevents a browser choice from mixing token addresses, networks, signers, and settlement contracts.

## Required Staging Configuration

### EasyPost account prerequisites

Before treating the rehearsal as operationally ready, the EasyPost account must have:

- a production API key;
- a verified ship-from address;
- an enabled Wallet Carrier account or an appropriate connected carrier account; and
- a primary/secondary payment method or sufficient EasyPost Wallet balance for the approved label.

Environment readiness only proves that Haggle is configured correctly. After receiving the live
key, run a provider preflight that authenticates the key, checks billing readiness, registers or
verifies the production webhook, and requests one live rate before authorizing a paid label.

Payment settings remain the existing hUSDC profile:

```text
HAGGLE_ENV=staging
HAGGLE_X402_NETWORK=base-sepolia
HAGGLE_SETTLEMENT_ASSET_PROFILE=base-sepolia-husdc
```

Integration shipping:

```text
EASYPOST_TEST_API_KEY=EZTK...
EASYPOST_TEST_WEBHOOK_SECRET=...
```

Physical shipping rehearsal:

```text
HAGGLE_ENABLE_STAGING_LIVE_SHIPPING=true
HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR=5000
EASYPOST_LIVE_API_KEY=<EasyPost production key>
EASYPOST_LIVE_WEBHOOK_SECRET=<signing secret for the staging API webhook>
```

Register the live EasyPost webhook endpoint as:

```text
https://api.staging.tryhaggle.ai/shipments/webhooks/easypost
```

Never put an EasyPost key in Vercel or a browser variable. These values belong only to the Railway
API service.

## Physical Shipping Runbook

1. Complete a negotiation and choose **Physical shipping rehearsal** in checkout.
2. Fund the order with hUSDC on Base Sepolia and open the resulting order.
3. Confirm that the order already shows the locked `physical_live` execution mode.
4. Enter the real ship-from address and the packed parcel's measured dimensions and weight.
5. Request live rates and verify the carrier/service agreed during negotiation.
6. Select the rate and confirm the warning that a real EasyPost label charge will occur.
7. Print the label or use an available USPS QR option, then hand the parcel to the carrier.
8. Confirm that carrier scans update `LABEL_CREATED -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED`.
9. On delivery, verify buyer review starts. Test either buyer release or an eligible dispute.
10. Record order ID, shipment ID, EasyPost shipment ID, tracking number, label cost, webhook times,
    settlement transaction, and final release/dispute result.

## Safety Invariants

- A test key can never serve a `physical_live` shipment, and a live key can never serve an
  `integration_manual` shipment.
- Rate cache identity includes execution mode, so test and live quotes cannot collide.
- Live label purchase requires `acknowledge_live_charge=true`; the web UI asks the seller again.
- Staging rejects outbound and return labels above `HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR`. The
  default is $50 and code enforces an absolute $500 ceiling.
- The prepared quote and the provider's current rate are both checked before EasyPost purchase.
- Successful staging live labels record the USD charge and `haggle_staging_fiat_subsidy` in shipment
  metadata without changing the hUSDC settlement amount.
- Physical shipment status cannot be changed through manual event or test-tracker endpoints.
- Webhook signatures are required in deployed runtimes. Environment-specific secrets reject a
  test webhook attempting to update a live shipment, or the inverse.
- Existing shipments without mode metadata retain their environment's backward-compatible default.
- New payment preparation stores the selected mode before any wallet authorization; an active intent
  cannot be reused under a different mode.
- A shipment created from that payment carries `shipping_execution_mode_payment_locked=true`, so
  the seller cannot change the checkout choice before requesting rates. Legacy/manual shipments
  keep the earlier seller-selection path.
- The settlement asset is environment-bound, not user-selectable. Real USDC is never offered from
  the hUSDC staging deployment.
- No database migration is required; the mode is additive shipment metadata.

## Pass Criteria

- Staging readiness reports both hUSDC and live EasyPost configuration as ready.
- A live rate is returned and the exact selected rate is used for label purchase.
- The label and tracking number are visible to the seller.
- The first transition to transit comes from a verified carrier event, not a manual action.
- Delivery begins buyer review and preserves the conditional hUSDC settlement.
- A happy-path release moves hUSDC according to the settlement contract.
- A dispute freezes release and only the resolved outcome can move the settlement.
