import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-[-0.005em] transition active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "border border-transparent bg-cta text-on-cta hover:bg-cta-hover disabled:border-line disabled:bg-surface-disabled disabled:text-ink-muted",
        secondary:
          "border border-line bg-transparent text-action-secondary hover:border-line-strong",
        ink: "bg-action-secondary text-surface hover:bg-action-secondary-hover",
        ghost: "bg-transparent text-ink-secondary hover:bg-surface-sunken hover:text-ink",
        "grad-gold": "bg-cta-primary text-on-accent hover:brightness-95",
        "grad-navy": "bg-cta-secondary text-on-ink hover:brightness-110",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
