import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      selected: {
        true: "border-action-primary/40 bg-action-primary/10 text-action-primary",
        false: "border-line text-ink-secondary hover:border-line-strong hover:text-ink",
      },
      size: {
        sm: "px-2.5 py-1 text-xs",
        md: "px-3.5 py-1.5 text-sm",
      },
    },
    defaultVariants: { selected: false, size: "md" },
  },
);

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof chipVariants>;

/** Interactive/selectable pill (filter & choice chips). For static status labels use Badge. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected ?? false}
      className={cn(chipVariants({ selected, size }), className)}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";
