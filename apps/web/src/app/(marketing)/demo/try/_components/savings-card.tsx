"use client";

import Link from "next/link";

interface SavingsCardProps {
  finalPrice: number;
  accepted: boolean;
  onRestart: () => void;
}

const MARKET_PRICE = 920;
const EBAY_FEE_RATE = 0.156;
const EBAY_FIXED_FEE = 0.3;
const HAGGLE_FEE_RATE = 0.015;

export function SavingsCard({ finalPrice, accepted, onRestart }: SavingsCardProps) {
  const savings = MARKET_PRICE - finalPrice;
  const savingsPercent = ((savings / MARKET_PRICE) * 100).toFixed(1);

  const ebayFee = finalPrice * EBAY_FEE_RATE + EBAY_FIXED_FEE;
  const haggleFee = finalPrice * HAGGLE_FEE_RATE;
  const keepOnEbay = finalPrice - ebayFee;
  const keepOnHaggle = finalPrice - haggleFee;

  if (!accepted) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-error/30 bg-error-soft p-6 sm:p-8 text-center animate-fade-in">
        <p className="text-error text-sm mb-2">Negotiation Failed</p>
        <p className="text-lg font-semibold text-ink mb-2">No deal reached</p>
        <p className="text-sm text-ink-secondary mb-4">
          The AI buyer walked away. Try adjusting your asking price and negotiation approach.
        </p>
        <button
          type="button"
          onClick={onRestart}
          className="rounded-xl border border-line px-6 py-2.5 text-sm font-medium text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto rounded-2xl border border-action-primary/30 bg-surface-sunken p-6 sm:p-8 animate-fade-in">
      <div className="text-center mb-6">
        <p className="text-sm text-success mb-2">Deal Closed!</p>
        <p className="text-3xl font-bold text-ink mb-1">${finalPrice.toLocaleString()}</p>
        <p className="text-ink-secondary">
          Savings vs market: ${savings} ({savingsPercent}% off ${MARKET_PRICE})
        </p>
      </div>

      {/* Fee comparison */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg bg-surface-raised p-3 text-center">
          <p className="text-xs text-ink-secondary mb-1">You&apos;d keep on eBay</p>
          <p className="text-sm text-error font-medium">${keepOnEbay.toFixed(0)}</p>
          <p className="text-[10px] text-ink-muted mt-0.5">15.6% + $0.30 fee</p>
        </div>
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--action-primary)_10%,transparent)] p-3 text-center">
          <p className="text-xs text-ink-secondary mb-1">You keep on Haggle</p>
          <p className="text-sm text-action-primary font-medium">${keepOnHaggle.toFixed(0)}</p>
          <p className="text-[10px] text-ink-muted mt-0.5">1.5% fee</p>
        </div>
      </div>

      <div className="rounded-lg bg-success-soft border border-success/20 p-4 text-center mb-6">
        <p className="text-xs text-success mb-1">Extra you keep vs eBay</p>
        <p className="text-2xl font-bold text-success">${(keepOnHaggle - keepOnEbay).toFixed(0)}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/claim"
          className="flex-1 rounded-xl bg-action-primary px-5 py-2.5 text-sm font-medium text-on-accent text-center hover:bg-action-primary-hover transition-colors"
        >
          Sign Up for Early Access
        </Link>
        <button
          type="button"
          onClick={onRestart}
          className="flex-1 rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
