export interface MoneyLike {
  currency: string;
  amount_minor: number;
}

export type SettlementAsset = "USDC";

export type DisplayMoney<T extends MoneyLike = MoneyLike> = T & {
  decimals: number;
};

export const USD_MINOR_DECIMALS = 2;
export const USDC_DECIMALS = 6;
export const USDC_ATOMIC_UNITS_PER_USD_CENT = 10_000;

export function assertValidMoney(money: MoneyLike): void {
  if (!Number.isInteger(money.amount_minor) || money.amount_minor < 0) {
    throw new Error(`amount_minor must be a non-negative integer, got ${money.amount_minor}`);
  }
}

export function getMoneyDecimals(currency: string): number {
  switch (currency.toUpperCase()) {
    case "USD":
      return USD_MINOR_DECIMALS;
    case "USDC":
      return USDC_DECIMALS;
    default:
      throw new Error(`unsupported money currency for display: ${currency}`);
  }
}

export function withMoneyDecimals<T extends MoneyLike>(money: T): DisplayMoney<T> {
  assertValidMoney(money);
  return {
    ...money,
    decimals: getMoneyDecimals(money.currency),
  };
}

export function toSettlementAssetMoney(
  money: MoneyLike,
  asset: SettlementAsset = "USDC",
): DisplayMoney {
  assertValidMoney(money);
  if (asset !== "USDC") {
    throw new Error(`unsupported settlement asset: ${asset}`);
  }

  switch (money.currency.toUpperCase()) {
    case "USDC":
      return {
        currency: "USDC",
        amount_minor: money.amount_minor,
        decimals: USDC_DECIMALS,
      };
    case "USD":
      return {
        currency: "USDC",
        amount_minor: money.amount_minor * USDC_ATOMIC_UNITS_PER_USD_CENT,
        decimals: USDC_DECIMALS,
      };
    default:
      throw new Error(`unsupported source currency for ${asset} settlement: ${money.currency}`);
  }
}

export function formatMoney(money: MoneyLike & { decimals?: number }): string {
  const decimals = money.decimals ?? getMoneyDecimals(money.currency);
  const major = money.amount_minor / 10 ** decimals;
  return `${major.toFixed(2)} ${money.currency}`;
}
