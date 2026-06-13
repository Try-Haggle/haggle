"use client";

const PHASE_STYLES: Record<string, { bg: string; text: string }> = {
  OPENING: { bg: "bg-info-soft", text: "text-info" },
  BARGAINING: { bg: "bg-warning-soft", text: "text-warning" },
  CLOSING: { bg: "bg-success-soft", text: "text-success" },
  SETTLEMENT: { bg: "bg-success-soft", text: "text-success" },
};

interface DemoHeaderProps {
  phase: string;
  round: number;
}

export function DemoHeader({ phase, round }: DemoHeaderProps) {
  const style = PHASE_STYLES[phase] ?? PHASE_STYLES.OPENING;

  return (
    <div className="rounded-xl border border-line bg-surface-sunken p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" role="img" aria-label="iPhone">
            📱
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">iPhone 15 Pro 256GB</p>
            <p className="text-xs text-ink-secondary">Market Price: $920 (Swappa)</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${style.bg} ${style.text}`}
          >
            {phase}
          </span>
          {round > 0 && <span className="text-xs font-mono text-ink-secondary">Round {round}</span>}
        </div>
      </div>
    </div>
  );
}
