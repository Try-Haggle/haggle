import type { ReactNode } from "react";
import { Alert } from "./alert";
import { Button } from "./button";
import { Stepper } from "./stepper";

export interface WizardShellProps {
  steps: string[];
  current: number;
  title?: ReactNode;
  subtitle?: ReactNode;
  error?: string;
  onBack?: () => void;
  onNext?: () => void;
  onSubmit?: () => void;
  /** Gate the Next/Submit button. */
  canProceed?: boolean;
  loading?: boolean;
  backLabel?: string;
  nextLabel?: string;
  submitLabel?: string;
  children: ReactNode;
  className?: string;
}

export function WizardShell({
  steps,
  current,
  title,
  subtitle,
  error,
  onBack,
  onNext,
  onSubmit,
  canProceed = true,
  loading = false,
  backLabel = "이전",
  nextLabel = "다음",
  submitLabel = "완료",
  children,
  className,
}: WizardShellProps) {
  const isLast = current >= steps.length - 1;
  return (
    <div className={className}>
      <Stepper steps={steps} current={current} />

      {(title || subtitle) && (
        <div className="mt-6">
          {title && <h2 className="font-bold text-ink text-xl">{title}</h2>}
          {subtitle && <p className="mt-1 text-ink-secondary text-sm">{subtitle}</p>}
        </div>
      )}

      <div className="mt-5">{children}</div>

      {error && (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <div>
          {current > 0 && onBack && (
            <Button variant="secondary" onClick={onBack} disabled={loading}>
              {backLabel}
            </Button>
          )}
        </div>
        {isLast ? (
          <Button onClick={onSubmit} loading={loading} disabled={!canProceed}>
            {submitLabel}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!canProceed || loading}>
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
