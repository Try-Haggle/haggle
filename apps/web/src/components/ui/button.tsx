import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-[-0.005em] transition active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none",
  {
    variants: {
      variant: {
        // Adaptive primary CTA: navy in light, gold in dark (contrasts the surface).
        primary:
          "border border-transparent bg-cta text-on-cta hover:bg-cta-hover disabled:border-line disabled:bg-surface-disabled disabled:text-ink-muted",
        secondary:
          "border border-line bg-transparent text-action-secondary hover:border-line-strong disabled:opacity-50",
        ink: "bg-action-secondary text-surface hover:bg-action-secondary-hover disabled:opacity-50",
        ghost:
          "bg-transparent text-ink-secondary hover:bg-surface-sunken hover:text-ink disabled:opacity-50",
        destructive:
          "border border-error/30 bg-error-soft text-error hover:border-error/60 disabled:opacity-50",
        success:
          "border border-success/30 bg-success-soft text-success hover:border-success/60 disabled:opacity-50",
        "grad-gold": "bg-cta-primary text-on-accent hover:brightness-95 disabled:opacity-50",
        "grad-navy": "bg-cta-secondary text-on-ink hover:brightness-110 disabled:opacity-50",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Show a spinner and disable interaction. */
    loading?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      loading = false,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
