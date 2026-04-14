"use client";

interface CostBadgeProps {
  totalUsd: number;
  promptTokens: number;
  completionTokens: number;
}

export function CostBadge({ totalUsd, promptTokens, completionTokens }: CostBadgeProps) {
  const totalTokens = promptTokens + completionTokens;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-mono">
      <span className="text-slate-400">비용</span>
      <span className="text-cyan-400 font-semibold">
        ${totalUsd.toFixed(4)}
      </span>
      <span className="text-slate-600">|</span>
      <span className="text-slate-400">
        {totalTokens.toLocaleString()} 토큰
      </span>
      <span className="text-slate-600 text-[10px]">
        (입력 {promptTokens.toLocaleString()} + 출력 {completionTokens.toLocaleString()})
      </span>
    </div>
  );
}
