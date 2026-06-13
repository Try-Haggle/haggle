"use client";

interface CostBadgeProps {
  totalUsd: number;
  promptTokens: number;
  completionTokens: number;
}

export function CostBadge({ totalUsd, promptTokens, completionTokens }: CostBadgeProps) {
  const totalTokens = promptTokens + completionTokens;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-2 text-xs font-mono">
      <span className="text-ink-secondary">비용</span>
      <span className="text-action-primary font-semibold">${totalUsd.toFixed(4)}</span>
      <span className="text-ink-muted">|</span>
      <span className="text-ink-secondary">{totalTokens.toLocaleString()} 토큰</span>
      <span className="text-ink-muted text-[10px]">
        (입력 {promptTokens.toLocaleString()} + 출력 {completionTokens.toLocaleString()})
      </span>
    </div>
  );
}
