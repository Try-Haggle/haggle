"use client";

const PHASE_STYLES: Record<string, { bg: string; text: string }> = {
  OPENING: { bg: "bg-blue-500/20", text: "text-blue-300" },
  BARGAINING: { bg: "bg-amber-500/20", text: "text-amber-300" },
  CLOSING: { bg: "bg-emerald-500/20", text: "text-emerald-300" },
  SETTLEMENT: { bg: "bg-emerald-500/20", text: "text-emerald-300" },
};

interface DemoHeaderProps {
  phase: string;
  round: number;
}

export function DemoHeader({ phase, round }: DemoHeaderProps) {
  const style = PHASE_STYLES[phase] ?? PHASE_STYLES.OPENING;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" role="img" aria-label="iPhone">
            📱
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              iPhone 15 Pro 256GB
            </p>
            <p className="text-xs text-slate-400">
              Market Price: $920 (Swappa)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${style.bg} ${style.text}`}
          >
            {phase}
          </span>
          {round > 0 && (
            <span className="text-xs font-mono text-slate-400">
              Round {round}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
