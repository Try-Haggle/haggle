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

export function SavingsCard({
  finalPrice,
  accepted,
  onRestart,
}: SavingsCardProps) {
  const savings = MARKET_PRICE - finalPrice;
  const savingsPercent = ((savings / MARKET_PRICE) * 100).toFixed(1);

  const ebayFee = finalPrice * EBAY_FEE_RATE + EBAY_FIXED_FEE;
  const haggleFee = finalPrice * HAGGLE_FEE_RATE;
  const keepOnEbay = finalPrice - ebayFee;
  const keepOnHaggle = finalPrice - haggleFee;

  if (!accepted) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-red-500/30 bg-red-500/5 p-6 sm:p-8 text-center animate-fade-in">
        <p className="text-red-400 text-sm mb-2">Negotiation Failed</p>
        <p className="text-lg font-semibold text-white mb-2">No deal reached</p>
        <p className="text-sm text-slate-400 mb-4">
          The AI buyer walked away. Try adjusting your asking price and
          negotiation approach.
        </p>
        <button
          onClick={onRestart}
          className="rounded-xl border border-slate-700 px-6 py-2.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto rounded-2xl border border-cyan-500/30 bg-slate-800/50 p-6 sm:p-8 animate-fade-in">
      <div className="text-center mb-6">
        <p className="text-sm text-emerald-400 mb-2">Deal Closed!</p>
        <p className="text-3xl font-bold text-white mb-1">
          ${finalPrice.toLocaleString()}
        </p>
        <p className="text-slate-400">
          Savings vs market: ${savings} ({savingsPercent}% off $
          {MARKET_PRICE})
        </p>
      </div>

      {/* Fee comparison */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg bg-slate-800/80 p-3 text-center">
          <p className="text-xs text-slate-500 mb-1">
            You&apos;d keep on eBay
          </p>
          <p className="text-sm text-red-400 font-medium">
            ${keepOnEbay.toFixed(0)}
          </p>
          <p className="text-[10px] text-slate-600 mt-0.5">
            15.6% + $0.30 fee
          </p>
        </div>
        <div className="rounded-lg bg-cyan-500/10 p-3 text-center">
          <p className="text-xs text-slate-500 mb-1">
            You keep on Haggle
          </p>
          <p className="text-sm text-cyan-400 font-medium">
            ${keepOnHaggle.toFixed(0)}
          </p>
          <p className="text-[10px] text-slate-600 mt-0.5">1.5% fee</p>
        </div>
      </div>

      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center mb-6">
        <p className="text-xs text-emerald-400 mb-1">
          Extra you keep vs eBay
        </p>
        <p className="text-2xl font-bold text-emerald-300">
          ${(keepOnHaggle - keepOnEbay).toFixed(0)}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/claim"
          className="flex-1 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white text-center hover:bg-cyan-500 transition-colors"
        >
          Sign Up for Early Access
        </Link>
        <button
          onClick={onRestart}
          className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
