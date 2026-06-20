import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full rounded-[10px] border bg-surface-overlay text-sm text-ink outline-none transition placeholder:text-ink-muted disabled:opacity-50";

export const inputVariants = cva(`h-11 px-3.5 ${fieldBase}`, {
  variants: {
    invalid: {
      true: "border-error focus:border-error focus:ring-4 focus:ring-error/20",
      false: "border-line focus:border-focus focus:ring-4 focus:ring-action-primary/20",
    },
  },
  defaultVariants: { invalid: false },
});

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof inputVariants> & {
    /** Decorative or interactive content pinned to the start (e.g. "$"). */
    startAdornment?: ReactNode;
    /** Content pinned to the end (e.g. "%", a show-password toggle). */
    endAdornment?: ReactNode;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, startAdornment, endAdornment, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        className={cn(
          inputVariants({ invalid }),
          startAdornment && "pl-8",
          endAdornment && "pr-9",
          className,
        )}
        {...props}
      />
    );
    if (!startAdornment && !endAdornment) return input;
    return (
      <div className="relative">
        {startAdornment && (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-muted text-sm">
            {startAdornment}
          </span>
        )}
        {input}
        {endAdornment && (
          <span className="absolute inset-y-0 right-3 flex items-center text-ink-muted text-sm">
            {endAdornment}
          </span>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid = false, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "min-h-[88px] resize-y py-2.5 px-3.5",
        fieldBase,
        invalid
          ? "border-error focus:border-error focus:ring-4 focus:ring-error/20"
          : "border-line focus:border-focus focus:ring-4 focus:ring-action-primary/20",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid = false, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-11 cursor-pointer appearance-none pr-9 pl-3.5",
          fieldBase,
          invalid
            ? "border-error focus:border-error focus:ring-4 focus:ring-error/20"
            : "border-line focus:border-focus focus:ring-4 focus:ring-action-primary/20",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted" />
    </div>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: reusable Label primitive; htmlFor/control supplied by caller
    <label
      className={cn("mb-1.5 block font-medium text-ink-secondary text-xs", className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("mb-4", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-warning">*</span>}
        </Label>
      )}
      {children}
      {error && <p className="mt-1.5 text-error text-xs">{error}</p>}
      {!error && hint && <p className="mt-1.5 text-ink-muted text-xs">{hint}</p>}
    </div>
  );
}
