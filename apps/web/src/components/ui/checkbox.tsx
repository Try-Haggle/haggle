import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, disabled, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className={cn(
          "size-4 shrink-0 cursor-pointer rounded border-line accent-action-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
    if (!label) return input;
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox control is nested via {input}
      <label
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 text-ink text-sm",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {input}
        {label}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
