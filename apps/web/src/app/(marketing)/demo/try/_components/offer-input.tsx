"use client";

import { useEffect, useState } from "react";

interface OfferInputProps {
  round: number;
  sending: boolean;
  done: boolean;
  lastBuyerPrice: number | null;
  lastSellerPrice: number | null;
  onSubmit: (price: number) => void;
}

export function OfferInput({
  round,
  sending,
  done,
  lastBuyerPrice,
  lastSellerPrice,
  onSubmit,
}: OfferInputProps) {
  const [price, setPrice] = useState(920);
  const disabled = sending || done;

  const canSplit = lastBuyerPrice != null && lastSellerPrice != null;
  const splitPrice = canSplit
    ? Math.round((lastBuyerPrice / 100 + lastSellerPrice / 100) / 2 / 10) * 10
    : null;

  // Keep slider and input in sync
  useEffect(() => {
    if (round === 0) setPrice(920);
  }, [round]);

  const handleSubmit = () => {
    if (disabled) return;
    onSubmit(price);
  };

  const handleSplit = () => {
    if (disabled || splitPrice == null) return;
    setPrice(splitPrice);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !disabled) {
      handleSubmit();
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-sunken p-4">
      <div className="flex items-center justify-between mb-3">
        <label htmlFor="offer-price-input" className="text-xs font-medium text-ink-secondary">
          Your offer {round > 0 ? `(Round ${round + 1})` : ""}
        </label>
        {canSplit && (
          <button
            type="button"
            onClick={handleSplit}
            disabled={disabled}
            className="text-xs text-action-primary hover:text-action-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Split the Difference (${splitPrice})
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-ink-secondary text-lg">$</span>
        <input
          id="offer-price-input"
          type="number"
          value={price}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) setPrice(Math.min(1200, Math.max(500, v)));
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          min={500}
          max={1200}
          step={10}
          className="flex-1 bg-surface-overlay border border-line rounded-lg px-3 py-2 text-lg font-mono text-ink focus:border-focus focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          className="rounded-lg bg-cta px-5 py-2 text-sm font-medium text-on-cta hover:bg-cta-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? "Sending..." : "Send Offer"}
        </button>
      </div>

      <input
        type="range"
        aria-label="Offer price slider"
        value={price}
        onChange={(e) => setPrice(parseInt(e.target.value, 10))}
        disabled={disabled}
        min={500}
        max={1200}
        step={10}
        className="w-full h-1.5 rounded-full appearance-none bg-surface-sunken accent-action-primary disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-ink-muted">$500</span>
        <span className="text-[10px] text-ink-muted">$1,200</span>
      </div>
    </div>
  );
}
