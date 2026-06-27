import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
        outline: "border border-line text-ink-secondary hover:border-line-strong hover:text-ink",
        solid: "bg-cta text-on-cta hover:bg-cta-hover",
      },
      size: { sm: "size-8", md: "size-10", lg: "size-11" },
      shape: { square: "rounded-lg", circle: "rounded-full" },
    },
    defaultVariants: { variant: "ghost", size: "md", shape: "square" },
  },
);

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required — icon-only buttons need an accessible name. */
    "aria-label": string;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, shape, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size, shape }), className)}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
