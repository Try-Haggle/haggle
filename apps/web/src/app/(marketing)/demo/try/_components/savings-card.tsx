"use client";

import Link from "next/link";
import { EbayComparisonNotice } from "@/components/ebay-comparison-notice";
import { describeFeeDifference, ebayFeeEstimate } from "@/components/ebay-fee-terms";

interface SavingsCardProps {
  finalPrice: number;
  accepted: boolean;
  onRestart: () => void;
}

const HAGGLE_FEE_RATE = 0.015;

export function SavingsCard({ finalPrice, accepted, onRestart }: SavingsCardProps) {
  const ebayFee = ebayFeeEstimate(finalPrice);
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
        <p className="text-ink-secondary">Demo result · no sale was made</p>
      </div>

      {/* Fee comparison */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg bg-surface-raised p-3 text-center">
          <p className="text-xs text-ink-secondary mb-1">Est. you&apos;d keep on eBay (Demo)</p>
          <p className="text-sm text-error font-medium">~${keepOnEbay.toFixed(0)}</p>
          <p className="text-[10px] text-ink-muted mt-0.5">13.6% + $0.40 fee (est.)</p>
        </div>
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--action-primary)_10%,transparent)] p-3 text-center">
          <p className="text-xs text-ink-secondary mb-1">Illustrative: keep at 1.5% fee</p>
          <p className="text-sm text-action-primary font-medium">${keepOnHaggle.toFixed(0)}</p>
          <p className="text-[10px] text-ink-muted mt-0.5">assumption, not a quote</p>
        </div>
      </div>

      <div className="rounded-lg bg-success-soft border border-success/20 p-4 text-center mb-6">
        <p className="text-xs text-success mb-1">Demo est. seller fee vs eBay</p>
        <p className="text-2xl font-bold text-success">
          {describeFeeDifference(keepOnHaggle - keepOnEbay).label}
        </p>
      </div>
      <EbayComparisonNotice variant="demo" terms testId="savings-ebay-notice" className="mb-6" />

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/claim"
          className="flex-1 rounded-xl bg-cta px-5 py-2.5 text-sm font-medium text-on-cta text-center hover:bg-cta-hover transition-colors"
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
