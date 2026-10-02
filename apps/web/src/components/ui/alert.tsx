import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// 16px text: an alert is usually the most important line on screen and must
// not be the smallest. py-3 keeps it visibly shorter than a 52px field, so a
// form-level alert reads as a message rather than one more input.
export const alertVariants = cva("flex items-start gap-3 rounded-xl px-4 py-3 text-base", {
  variants: {
    tone: {
      success: "bg-success-soft text-success",
      info: "bg-info-soft text-info",
      warning: "bg-warning-soft text-warning",
      error: "bg-error-soft text-error",
      neutral: "bg-surface-sunken text-ink-secondary",
    },
  },
  defaultVariants: { tone: "info" },
});

const toneIcons = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  neutral: Info,
} as const;

export type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & {
    title?: string;
    /** Hide the leading tone icon. */
    hideIcon?: boolean;
    /** Render a dismiss (X) button; called when clicked. */
    onClose?: () => void;
  };

export function Alert({
  className,
  tone,
  title,
  hideIcon = false,
  onClose,
  children,
  ...props
}: AlertProps) {
  const resolvedTone = tone ?? "info";
  const Icon = toneIcons[resolvedTone];
  return (
    <div role="alert" className={cn(alertVariants({ tone: resolvedTone }), className)} {...props}>
      {!hideIcon && <Icon className="mt-0.5 size-5 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <b className="mb-0.5 block font-semibold">{title}</b>}
        {children}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 shrink-0 rounded p-1.5 opacity-70 transition hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
