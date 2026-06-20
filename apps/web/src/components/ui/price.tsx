import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";

const sizeClass = { sm: "text-sm", md: "text-base", lg: "text-2xl", xl: "text-3xl" } as const;
const toneClass = {
  default: "text-ink",
  accent: "text-action-primary",
  success: "text-success",
  muted: "text-ink-muted",
} as const;

export interface PriceProps {
  amount: number;
  /** `amount` is in minor units (cents). */
  minor?: boolean;
  currency?: string;
  size?: keyof typeof sizeClass;
  tone?: keyof typeof toneClass;
  className?: string;
}

export function Price({
  amount,
  minor,
  currency,
  size = "md",
  tone = "default",
  className,
}: PriceProps) {
  return (
    <span className={cn("font-bold tabular-nums", sizeClass[size], toneClass[tone], className)}>
      {formatPrice(amount, { minor, currency })}
    </span>
  );
}
