import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const cardVariants = cva("rounded-2xl", {
  variants: {
    tone: {
      default: "border border-line bg-surface-raised text-ink shadow-card",
      sunken: "border border-line bg-surface-sunken text-ink",
      premium: "bg-premium text-on-accent shadow-card",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      md: "p-7",
    },
  },
  defaultVariants: { tone: "default", padding: "md" },
});

export type CardProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>;

export function Card({ className, tone, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ tone, padding }), className)} {...props} />;
}
