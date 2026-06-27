import { cn } from "@/lib/cn";
import { Chip } from "./chip";
import { Slider } from "./slider";

export interface VoteSliderProps {
  /** 0–100 (share toward the buyer). */
  value: number;
  onChange: (value: number) => void;
  presets?: number[];
  /** Total amount to split; shows a $ readout when provided. */
  amount?: number;
  buyerLabel?: string;
  sellerLabel?: string;
  className?: string;
}

export function VoteSlider({
  value,
  onChange,
  presets = [0, 25, 50, 75, 100],
  amount,
  buyerLabel = "구매자",
  sellerLabel = "판매자",
  className,
}: VoteSliderProps) {
  const buyerAmt = amount != null ? Math.round((amount * value) / 100) : null;
  const sellerAmt = amount != null ? amount - (buyerAmt ?? 0) : null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex justify-between text-ink-muted text-xs">
        <span>{buyerLabel}</span>
        <span>{sellerLabel}</span>
      </div>
      <Slider value={value} onValueChange={onChange} aria-label={`${buyerLabel} 비율`} />
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Chip key={p} size="sm" selected={value === p} onClick={() => onChange(p)}>
            {p}%
          </Chip>
        ))}
      </div>
      <div className="flex justify-between rounded-lg bg-surface-sunken px-3 py-2 text-sm">
        <span className="text-ink-secondary">
          {buyerLabel}{" "}
          <b className="text-ink">
            {value}%{buyerAmt != null && ` · $${buyerAmt.toLocaleString()}`}
          </b>
        </span>
        <span className="text-ink-secondary">
          {sellerLabel}{" "}
          <b className="text-ink">
            {100 - value}%{sellerAmt != null && ` · $${sellerAmt.toLocaleString()}`}
          </b>
        </span>
      </div>
    </div>
  );
}
