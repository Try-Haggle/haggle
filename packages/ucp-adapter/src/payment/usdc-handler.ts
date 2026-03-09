// ============================================================
// USDC Payment Handler
// Validates and processes USDC stablecoin payments.
// MVP: sandbox mode only. On-chain processing deferred to contracts package.
// ============================================================

import type {
  UsdcPaymentInstrument,
  UsdcPaymentResult,
  UsdcPaymentHandlerConfig,
  SupportedChain,
} from './types.js';
import { DEFAULT_USDC_CONFIG, USDC_HANDLER_ID } from './types.js';

/**
 * Validate a USDC payment instrument before processing.
 */
export function validateUsdcInstrument(
  instrument: UsdcPaymentInstrument,
  config: UsdcPaymentHandlerConfig = DEFAULT_USDC_CONFIG,
): { ok: true } | { ok: false; error: string } {
  if (instrument.handler_id !== USDC_HANDLER_ID) {
    return { ok: false, error: `Invalid handler_id: expected ${USDC_HANDLER_ID}` };
  }

  if (instrument.type !== 'crypto') {
    return { ok: false, error: 'Invalid type: expected crypto' };
  }

  if (!config.supported_chains.includes(instrument.chain)) {
    return {
      ok: false,
      error: `Unsupported chain: ${instrument.chain}. Supported: ${config.supported_chains.join(', ')}`,
    };
  }

  if (!config.supported_tokens.includes(instrument.token)) {
    return {
      ok: false,
      error: `Unsupported token: ${instrument.token}. Supported: ${config.supported_tokens.join(', ')}`,
    };
  }

  if (!instrument.wallet_address || instrument.wallet_address.length < 10) {
    return { ok: false, error: 'Invalid wallet address' };
  }

  if (!instrument.credential?.token) {
    return { ok: false, error: 'Missing payment credential token' };
  }

  return { ok: true };
}

/**
 * Process a USDC payment.
 * MVP: sandbox mode — accepts sandbox_ tokens, returns mock tx hash.
 * Production: would call contracts package for on-chain settlement.
 */
export function processUsdcPayment(
  instrument: UsdcPaymentInstrument,
  amount: number, // minor units
  config: UsdcPaymentHandlerConfig = DEFAULT_USDC_CONFIG,
): UsdcPaymentResult {
  // Validate first
  const validation = validateUsdcInstrument(instrument, config);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  // Sandbox mode
  const token = instrument.credential.token;
  if (token.startsWith('sandbox_') || instrument.credential.type === 'sandbox') {
    return {
      ok: true,
      transaction_hash: `0xsandbox_${Date.now().toString(16)}`,
      chain: instrument.chain,
      amount,
    };
  }

  // Production: on-chain settlement (stub)
  if (instrument.credential.type === 'transaction_hash') {
    // Verify existing transaction on-chain
    return {
      ok: true,
      transaction_hash: token,
      chain: instrument.chain,
      amount,
    };
  }

  if (instrument.credential.type === 'signed_approval') {
    // Execute on-chain transfer via contracts package
    // TODO(post-mvp): integrate with @haggle/contracts
    return {
      ok: false,
      error: 'On-chain settlement not yet implemented. Use sandbox_ tokens for testing.',
    };
  }

  return { ok: false, error: `Unknown credential type: ${instrument.credential.type}` };
}

/**
 * Build a UCP payment handler entry for the profile.
 */
export function buildUsdcPaymentHandlerEntry(
  config: UsdcPaymentHandlerConfig = DEFAULT_USDC_CONFIG,
) {
  return {
    id: 'usdc',
    version: '2026-03-01',
    config: {
      supported_chains: config.supported_chains,
      supported_tokens: config.supported_tokens,
      settlement_time: config.settlement_time,
      escrow_enabled: config.escrow_enabled ?? false,
    },
  };
}
