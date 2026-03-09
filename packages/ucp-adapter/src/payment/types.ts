// ============================================================
// USDC Payment Handler Types
// ai.tryhaggle.usdc — UCP Payment Handler for stablecoin
// ============================================================

export type SupportedChain = 'base' | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism';
export type SupportedToken = 'USDC';

export interface UsdcPaymentHandlerConfig {
  supported_chains: SupportedChain[];
  supported_tokens: SupportedToken[];
  settlement_time: 'instant' | 'finalized';
  escrow_enabled?: boolean;
}

export interface UsdcPaymentInstrument {
  id: string;
  handler_id: 'ai.tryhaggle.usdc';
  type: 'crypto';
  chain: SupportedChain;
  wallet_address: string;
  token: SupportedToken;
  credential: {
    type: 'transaction_hash' | 'signed_approval' | 'sandbox';
    token: string;
  };
}

export interface UsdcPaymentResult {
  ok: boolean;
  transaction_hash?: string;
  chain?: SupportedChain;
  amount?: number; // minor units
  error?: string;
}

export const USDC_HANDLER_ID = 'ai.tryhaggle.usdc' as const;

export const DEFAULT_USDC_CONFIG: UsdcPaymentHandlerConfig = {
  supported_chains: ['base', 'ethereum', 'polygon'],
  supported_tokens: ['USDC'],
  settlement_time: 'instant',
  escrow_enabled: false,
};
