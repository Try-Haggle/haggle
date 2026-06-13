"use client";

import { useState } from "react";

interface RoundControlProps {
  roundNumber: number;
  lastBuyerPrice: number;
  onExecute: (params: { seller_price_minor: number; seller_message?: string }) => void;
  loading: boolean;
  disabled: boolean;
}

function dollarsToMinor(v: number): number {
  return Math.round(v * 100);
}

function formatMinor(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v % 100 === 0 ? 0 : 2,
  }).format(v / 100);
}

const PRESETS = [
  { label: "$920 고수", price: 920 },
  { label: "$850 양보", price: 850 },
  { label: "$780 적극", price: 780 },
] as const;

export function RoundControl({
  roundNumber,
  lastBuyerPrice,
  onExecute,
  loading,
  disabled,
}: RoundControlProps) {
  const [sellerPrice, setSellerPrice] = useState(920);
  const [sellerMessage, setSellerMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onExecute({
      seller_price_minor: dollarsToMinor(sellerPrice),
      seller_message: sellerMessage.trim() || undefined,
    });
  };

  const handleAcceptBuyer = () => {
    onExecute({
      seller_price_minor: lastBuyerPrice,
      seller_message: "그 가격에 판매하겠습니다.",
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-surface-raised p-5"
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink">판매자 입력</h3>
        <span className="text-xs font-mono text-ink-muted bg-surface-sunken px-2 py-0.5 rounded">
          라운드 {roundNumber}
        </span>
      </div>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.price}
            type="button"
            onClick={() => setSellerPrice(p.price)}
            disabled={loading || disabled}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              sellerPrice === p.price
                ? "border-action-primary/40 bg-action-primary/10 text-action-primary"
                : "border-line bg-surface-sunken text-ink-secondary hover:border-line-strong hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
        {lastBuyerPrice > 0 && (
          <button
            type="button"
            onClick={handleAcceptBuyer}
            disabled={loading || disabled}
            className="rounded-lg border border-success/30 bg-success-soft px-3 py-1.5 text-xs font-medium text-success hover:bg-success-soft transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {formatMinor(lastBuyerPrice)} 수락
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Seller Price */}
        <div>
          <label
            htmlFor="round-seller-price"
            className="block text-xs font-medium text-ink-secondary mb-1"
          >
            판매 가격 ($)
          </label>
          <input
            id="round-seller-price"
            type="number"
            value={sellerPrice}
            onChange={(e) => setSellerPrice(Number(e.target.value))}
            disabled={loading || disabled}
            min={1}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink font-mono focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>

        {/* Seller Message */}
        <div>
          <label
            htmlFor="round-seller-message"
            className="block text-xs font-medium text-ink-secondary mb-1"
          >
            메시지 (선택)
          </label>
          <input
            id="round-seller-message"
            type="text"
            value={sellerMessage}
            onChange={(e) => setSellerMessage(e.target.value)}
            placeholder="비워두면 자동 생성됩니다"
            disabled={loading || disabled}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || disabled}
        className="w-full rounded-xl bg-action-primary px-6 py-2.5 text-sm font-semibold text-on-accent hover:bg-action-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <svg
              className="animate-spin h-4 w-4 text-on-accent"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            파이프라인 실행 중... (Stage 1~6)
          </>
        ) : (
          "다음 라운드 실행"
        )}
      </button>
    </form>
  );
}
