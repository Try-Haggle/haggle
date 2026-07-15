(function initHaggleContractRecovery(root) {
  "use strict";

  const VERSION = 1;
  const MAX_BYTES = 4096;
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
  const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
  const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
  const NETWORKS = new Set(["base", "base-sepolia"]);

  function optionalString(value, maxLength) {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
  }

  function optionalHex32(value) {
    return typeof value === "string" && HEX_32.test(value) ? value.toLowerCase() : null;
  }

  function optionalAddress(value) {
    return typeof value === "string" && ADDRESS.test(value) && !/^0x0{40}$/i.test(value)
      ? value.toLowerCase()
      : null;
  }

  function sanitize(input, nowMs) {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== VERSION) return null;
    const savedAtMs = Date.parse(input.saved_at);
    if (!Number.isFinite(savedAtMs)) return null;
    if (savedAtMs < nowMs - MAX_AGE_MS || savedAtMs > nowMs + MAX_FUTURE_SKEW_MS) return null;
    if (!NETWORKS.has(input.network)) return null;

    const paymentId = optionalString(input.payment_id, 200);
    const orderId = optionalString(input.order_id, 200);
    const settlementId = optionalHex32(input.settlement_id);
    const contractAddress = optionalAddress(input.contract_address);
    if (!settlementId || !contractAddress || (!paymentId && !orderId)) return null;

    const checkpoint = {
      version: VERSION,
      saved_at: new Date(savedAtMs).toISOString(),
      payment_id: paymentId,
      order_id: orderId,
      settlement_id: settlementId,
      settlement_release_id: optionalString(input.settlement_release_id, 200),
      contract_address: contractAddress,
      network: input.network,
      fund_tx_hash: optionalHex32(input.fund_tx_hash),
      release_tx_hash: optionalHex32(input.release_tx_hash),
      refund_tx_hash: optionalHex32(input.refund_tx_hash),
      funding_recorded: input.funding_recorded === true,
      funding_confirmed: input.funding_confirmed === true,
      release_recorded: input.release_recorded === true,
      refund_recorded: input.refund_recorded === true,
    };
    if (!checkpoint.fund_tx_hash && !checkpoint.release_tx_hash && !checkpoint.refund_tx_hash) return null;
    if (checkpoint.release_tx_hash && !checkpoint.settlement_release_id) return null;
    return checkpoint;
  }

  function decode(raw, nowMs) {
    if (typeof raw !== "string" || raw.length === 0 || new TextEncoder().encode(raw).length > MAX_BYTES) return null;
    try {
      return sanitize(JSON.parse(raw), nowMs ?? Date.now());
    } catch {
      return null;
    }
  }

  function encode(input, nowMs) {
    const checkpoint = sanitize({
      ...input,
      version: VERSION,
      saved_at: new Date(nowMs ?? Date.now()).toISOString(),
    }, nowMs ?? Date.now());
    return checkpoint ? JSON.stringify(checkpoint) : null;
  }

  function bindingMatches(checkpoint, current, operation) {
    if (!checkpoint || !current) return false;
    if (checkpoint.network !== current.network) return false;
    if (checkpoint.contract_address !== optionalAddress(current.contract_address)) return false;
    if ((operation === "funding" || operation === "refund") && checkpoint.payment_id !== optionalString(current.payment_id, 200)) return false;
    if (operation === "release") {
      if (checkpoint.order_id !== optionalString(current.order_id, 200)) return false;
      if (checkpoint.settlement_release_id !== optionalString(current.settlement_release_id, 200)) return false;
    }
    return checkpoint.settlement_id === optionalHex32(current.settlement_id);
  }

  const api = Object.freeze({ VERSION, MAX_BYTES, MAX_AGE_MS, decode, encode, bindingMatches });
  root.HaggleContractRecovery = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
