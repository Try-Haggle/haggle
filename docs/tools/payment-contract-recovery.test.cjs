const assert = require("node:assert/strict");
const recovery = require("./payment-contract-recovery.js");

const now = Date.parse("2026-07-12T17:00:00.000Z");
const base = {
  payment_id: "pi_recovery",
  order_id: "order_recovery",
  settlement_id: `0x${"11".repeat(32)}`,
  settlement_release_id: "release_recovery",
  contract_address: `0x${"22".repeat(20)}`,
  network: "base-sepolia",
  fund_tx_hash: `0x${"33".repeat(32)}`,
  funding_recorded: true,
};

const encoded = recovery.encode(base, now);
assert.ok(encoded);
const decoded = recovery.decode(encoded, now);
assert.equal(decoded.payment_id, base.payment_id);
assert.equal(decoded.contract_address, base.contract_address.toLowerCase());
assert.equal(decoded.funding_recorded, true);
assert.equal("signature" in decoded, false);
assert.equal("auth_token" in decoded, false);

assert.equal(recovery.decode("not-json", now), null);
assert.equal(recovery.decode("x".repeat(recovery.MAX_BYTES + 1), now), null);
assert.equal(recovery.decode(JSON.stringify({ ...JSON.parse(encoded), saved_at: "2026-07-01T00:00:00.000Z" }), now), null);
assert.equal(recovery.encode({ ...base, contract_address: `0x${"00".repeat(20)}` }, now), null);
assert.equal(recovery.encode({ ...base, fund_tx_hash: null, release_tx_hash: null, refund_tx_hash: null }, now), null);
assert.equal(recovery.encode({ ...base, release_tx_hash: `0x${"44".repeat(32)}`, settlement_release_id: null }, now), null);

assert.equal(recovery.bindingMatches(decoded, {
  payment_id: base.payment_id,
  settlement_id: base.settlement_id,
  contract_address: base.contract_address,
  network: base.network,
}, "funding"), true);
assert.equal(recovery.bindingMatches(decoded, {
  payment_id: "pi_other",
  settlement_id: base.settlement_id,
  contract_address: base.contract_address,
  network: base.network,
}, "funding"), false);
assert.equal(recovery.bindingMatches(decoded, {
  order_id: base.order_id,
  settlement_release_id: base.settlement_release_id,
  settlement_id: base.settlement_id,
  contract_address: base.contract_address,
  network: "base",
}, "release"), false);

console.log("payment contract recovery codec: 12 assertions PASS");
