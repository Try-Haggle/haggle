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
      className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">
          판매자 입력
        </h3>
        <span className="text-xs font-mono text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">
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
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-300"
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
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {formatMinor(lastBuyerPrice)} 수락
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Seller Price */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            판매 가격 ($)
          </label>
          <input
            type="number"
            value={sellerPrice}
            onChange={(e) => setSellerPrice(Number(e.target.value))}
            disabled={loading || disabled}
            min={1}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white font-mono focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>

        {/* Seller Message */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            메시지 (선택)
          </label>
          <input
            type="text"
            value={sellerMessage}
            onChange={(e) => setSellerMessage(e.target.value)}
            placeholder="비워두면 자동 생성됩니다"
            disabled={loading || disabled}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || disabled}
        className="w-full rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
