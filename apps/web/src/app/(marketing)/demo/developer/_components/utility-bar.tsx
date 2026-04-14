"use client";

import type { DemoRoundResponse } from "@/lib/demo-types";

interface StateGaugeProps {
  round: DemoRoundResponse;
}

/** Convert minor units to dollars for display */
function fmt(v: number): string {
  if (v > 1000) return `$${(v / 100).toFixed(0)}`;
  return `$${v}`;
}

function Bar({
  label,
  value,
  maxValue,
  color,
}: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
}) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-16 text-right shrink-0">
        {label}
      </span>
      <div className="flex-1 h-3 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono text-slate-300 w-14 text-right shrink-0">
        {fmt(value)}
      </span>
    </div>
  );
}

export function StateGauge({ round }: StateGaugeProps) {
  const { buyer_price, seller_price, gap, gap_pct } = round.state;
  const { decision } = round.final;
  const maxPrice = Math.max(buyer_price, seller_price) * 1.1;

  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-800/50 p-4"
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          협상 현황
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              decision.action === "ACCEPT"
                ? "bg-emerald-500/20 text-emerald-300"
                : decision.action === "REJECT"
                  ? "bg-red-500/20 text-red-300"
                  : decision.action === "COUNTER"
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "bg-amber-500/20 text-amber-300"
            }`}
          >
            {decision.action}
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {decision.tactic_used}
          </span>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <Bar label="구매자" value={buyer_price} maxValue={maxPrice} color="bg-blue-500" />
        <Bar label="판매자" value={seller_price} maxValue={maxPrice} color="bg-orange-500" />
      </div>

      {/* Gap indicator */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">격차</span>
          <span className="text-xs font-mono text-amber-400">{fmt(gap)}</span>
          <span className="text-[10px] font-mono text-slate-500">({gap_pct})</span>
        </div>
        {decision.price > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">AI 역제안</span>
            <span className="text-xs font-mono text-cyan-400">{fmt(decision.price)}</span>
          </div>
        )}
      </div>

      {/* Reasoning */}
      {decision.reasoning && (
        <p className="mt-2 text-[11px] text-slate-400 italic leading-relaxed">
          AI 판단: {decision.reasoning}
        </p>
      )}
    </div>
  );
}
