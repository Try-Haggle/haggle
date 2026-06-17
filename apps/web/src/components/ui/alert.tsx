import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const alertVariants = cva("flex items-start gap-3 rounded-xl p-4 text-sm", {
  variants: {
    tone: {
      success: "bg-success-soft text-success",
      info: "bg-info-soft text-info",
      warning: "bg-warning-soft text-warning",
      error: "bg-error-soft text-error",
    },
  },
  defaultVariants: { tone: "info" },
});

const toneIcons = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & { title?: string };

export function Alert({ className, tone, title, children, ...props }: AlertProps) {
  const resolvedTone = tone ?? "info";
  const Icon = toneIcons[resolvedTone];
  return (
    <div role="alert" className={cn(alertVariants({ tone: resolvedTone }), className)} {...props}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div>
        {title && <b className="mb-0.5 block font-semibold">{title}</b>}
        {children}
      </div>
    </div>
  );
}
