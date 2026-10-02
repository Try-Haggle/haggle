import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

// Hover/press styles are gated on `not-disabled:` so a disabled button keeps
// its resting look under the pointer and shows the not-allowed cursor (it no
// longer uses pointer-events-none, which hid that cursor). `not-disabled:` and
// not `enabled:` because these classes also style <Link>s, which never match
// :enabled. A loading button is disabled too and is dimmed so it plainly
// can't be pressed again — to 60%, not the 40% of a plain disabled button, so
// the spinner and "Signing in…" label stay readable. globals.css gives it a
// progress cursor.
export const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-[-0.005em] transition not-disabled:active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed aria-busy:opacity-60",
  {
    variants: {
      variant: {
        // Adaptive primary CTA: navy in light, gold in dark (contrasts the surface).
        // Disabled keeps the fill and fades it, so the CTA still reads as a button.
        primary:
          "border border-transparent bg-cta text-on-cta not-disabled:hover:bg-cta-hover disabled:opacity-40",
        // Hover tints the fill with the ink colour (a state layer) rather than
        // darkening the border: a dark outline is how a focused field looks.
        secondary:
          "border border-line bg-transparent text-action-secondary not-disabled:hover:bg-ink/5 disabled:opacity-50",
        ink: "bg-action-secondary text-surface not-disabled:hover:bg-action-secondary-hover disabled:opacity-50",
        ghost:
          "bg-transparent text-ink-secondary not-disabled:hover:bg-surface-sunken not-disabled:hover:text-ink disabled:opacity-50",
        destructive:
          "border border-error/30 bg-error-soft text-error not-disabled:hover:border-error/60 disabled:opacity-50",
        success:
          "border border-success/30 bg-success-soft text-success not-disabled:hover:border-success/60 disabled:opacity-50",
        "grad-gold":
          "bg-cta-primary text-on-accent not-disabled:hover:brightness-95 disabled:opacity-50",
        "grad-navy":
          "bg-cta-secondary text-on-ink not-disabled:hover:brightness-110 disabled:opacity-50",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-12 px-6 text-base",
        lg: "h-13 px-7 text-lg",
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
