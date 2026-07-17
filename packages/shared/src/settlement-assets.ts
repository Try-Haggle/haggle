export const BASE_MAINNET_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_SEPOLIA_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS =
  "0x579807433033757E895437EEfa9Ae25F387c3fCa" as const;

export const SETTLEMENT_ASSET_PROFILES = {
  "base-sepolia-husdc": {
    id: "base-sepolia-husdc",
    chainId: 84532,
    x402Network: "base-sepolia",
    walletNetwork: "eip155:84532",
    address: BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
    symbol: "hUSDC",
    name: "Haggle Test USDC",
    decimals: 6,
    testOnly: true,
  },
  "base-sepolia-usdc": {
    id: "base-sepolia-usdc",
    chainId: 84532,
    x402Network: "base-sepolia",
    walletNetwork: "eip155:84532",
    address: BASE_SEPOLIA_USDC_ADDRESS,
    symbol: "USDC",
    name: "Base Sepolia USDC",
    decimals: 6,
    testOnly: true,
  },
  "base-usdc": {
    id: "base-usdc",
    chainId: 8453,
    x402Network: "base",
    walletNetwork: "eip155:8453",
    address: BASE_MAINNET_USDC_ADDRESS,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    testOnly: false,
  },
} as const;

export type SettlementAssetProfileId = keyof typeof SETTLEMENT_ASSET_PROFILES;
export type SettlementAssetProfile = (typeof SETTLEMENT_ASSET_PROFILES)[SettlementAssetProfileId];

export function isSettlementAssetProfileId(value: string): value is SettlementAssetProfileId {
  return value in SETTLEMENT_ASSET_PROFILES;
}

export function getSettlementAssetProfile(id: SettlementAssetProfileId): SettlementAssetProfile {
  return SETTLEMENT_ASSET_PROFILES[id];
}
