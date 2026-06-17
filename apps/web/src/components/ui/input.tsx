import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

export const inputVariants = cva(
  "h-11 w-full rounded-[10px] border bg-surface-overlay px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-muted disabled:opacity-50",
  {
    variants: {
      invalid: {
        true: "border-error focus:border-error focus:ring-4 focus:ring-error/20",
        false: "border-line focus:border-focus focus:ring-4 focus:ring-action-primary/20",
      },
    },
    defaultVariants: { invalid: false },
  },
);

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof inputVariants>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input ref={ref} className={cn(inputVariants({ invalid }), className)} {...props} />
  ),
);
Input.displayName = "Input";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: reusable Label primitive; htmlFor/control supplied by caller
    <label
      className={cn("mb-1.5 block text-xs font-medium text-ink-secondary", className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("mb-4", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
      {!error && hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
