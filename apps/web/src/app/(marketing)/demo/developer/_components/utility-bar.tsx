"use client";

import type { DemoRoundResponse } from "@/lib/demo-types";

interface StateGaugeProps {
  round: DemoRoundResponse;
}

function fmt(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v % 100 === 0 ? 0 : 2,
  }).format(v / 100);
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
      <span className="text-[10px] text-ink-muted w-16 text-right shrink-0">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-surface-sunken overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono text-ink-secondary w-14 text-right shrink-0">
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
      className="rounded-xl border border-line bg-surface-raised p-4"
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">협상 현황</h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              decision.action === "ACCEPT"
                ? "bg-success-soft text-success"
                : decision.action === "REJECT"
                  ? "bg-error-soft text-error"
                  : decision.action === "COUNTER"
                    ? "bg-action-primary/20 text-action-primary"
                    : "bg-warning-soft text-warning"
            }`}
          >
            {decision.action}
          </span>
          <span className="text-[10px] font-mono text-ink-muted">{decision.tactic_used}</span>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <Bar label="구매자" value={buyer_price} maxValue={maxPrice} color="bg-info" />
        <Bar label="판매자" value={seller_price} maxValue={maxPrice} color="bg-badge" />
      </div>

      {/* Gap indicator */}
      <div className="flex items-center justify-between pt-2 border-t border-line-subtle">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-muted">격차</span>
          <span className="text-xs font-mono text-warning">{fmt(gap)}</span>
          <span className="text-[10px] font-mono text-ink-muted">({gap_pct})</span>
        </div>
        {decision.price > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-muted">AI 역제안</span>
            <span className="text-xs font-mono text-action-primary">{fmt(decision.price)}</span>
          </div>
        )}
      </div>

      {/* Reasoning */}
      {decision.reasoning && (
        <p className="mt-2 text-[11px] text-ink-secondary italic leading-relaxed">
          AI 판단: {decision.reasoning}
        </p>
      )}
    </div>
  );
}
