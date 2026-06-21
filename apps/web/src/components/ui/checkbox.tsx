import { Check } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, disabled, ...props }, ref) => {
    const control = (
      <span className="relative inline-flex size-4 shrink-0">
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          className={cn(
            "peer size-4 cursor-pointer appearance-none rounded border border-line bg-surface-overlay transition-colors",
            "checked:border-cta checked:bg-cta",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3 text-on-cta opacity-0 transition-opacity peer-checked:opacity-100"
        />
      </span>
    );
    if (!label) return control;
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox control is nested via {control}
      <label
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 text-ink text-sm",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {control}
        {label}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
