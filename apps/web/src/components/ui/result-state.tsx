import { Check, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const toneStyles = {
  success: { chip: "bg-success-soft text-success", Icon: Check },
  error: { chip: "bg-error-soft text-error", Icon: X },
  info: { chip: "bg-info-soft text-info", Icon: Info },
  neutral: { chip: "bg-surface-sunken text-ink-muted", Icon: Info },
} as const;

export interface ResultStateProps {
  tone?: keyof typeof toneStyles;
  /** Override the default tone icon. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function ResultState({
  tone = "success",
  icon,
  title,
  description,
  action,
  className,
}: ResultStateProps) {
  const { chip, Icon } = toneStyles[tone];
  return (
    <div className={cn("flex flex-col items-center gap-3 py-8 text-center", className)}>
      <div className={cn("flex size-14 items-center justify-center rounded-full", chip)}>
        {icon ?? <Icon className="size-7" />}
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-ink text-lg">{title}</p>
        {description && <p className="text-ink-secondary text-sm">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
