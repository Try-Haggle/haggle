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
  "w-full rounded-[10px] border bg-surface-overlay text-ink outline-none transition placeholder:text-ink-placeholder disabled:opacity-50";

// Same steps as Button's `md` / `lg`, so a field and a button of the same size
// always line up when they share a row.
const fieldSizes = {
  md: "h-12 px-4 text-base",
  lg: "h-13 px-5 text-base",
} as const;

export const inputVariants = cva(fieldBase, {
  variants: {
    size: fieldSizes,
    invalid: {
      true: "border-error focus:border-error focus:ring-1 focus:ring-error",
      false: "border-line focus:border-ink focus:ring-1 focus:ring-ink",
    },
  },
  defaultVariants: { size: "md", invalid: false },
});

// Wrapper for adorned inputs: the box owns the border/background/focus ring while
// adornments and the input sit in a flex row, so any adornment (icon or text) keeps
// a consistent gap from the value.
const adornedFieldVariants = cva(
  "flex w-full items-center gap-2 rounded-[10px] border bg-surface-overlay transition has-[:disabled]:opacity-50",
  {
    variants: {
      size: fieldSizes,
      invalid: {
        true: "border-error focus-within:border-error focus-within:ring-1 focus-within:ring-error",
        false: "border-line focus-within:border-ink focus-within:ring-1 focus-within:ring-ink",
      },
    },
    defaultVariants: { size: "md", invalid: false },
  },
);

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof inputVariants> & {
    /** Decorative or interactive content pinned to the start (e.g. a search icon, "$"). */
    startAdornment?: ReactNode;
    /** Content pinned to the end (e.g. "%", a clear button, a show-password toggle). */
    endAdornment?: ReactNode;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, invalid, startAdornment, endAdornment, ...props }, ref) => {
    if (!startAdornment && !endAdornment) {
      return (
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(inputVariants({ size, invalid }), className)}
          {...props}
        />
      );
    }
    return (
      <div className={adornedFieldVariants({ size, invalid })}>
        {startAdornment && (
          <span className="flex shrink-0 items-center text-ink-secondary">{startAdornment}</span>
        )}
        <input
          ref={ref}
          // Lets globals.css tell the bare inner field of an adorned input apart:
          // its focus ring belongs to the wrapper, not to this element.
          data-adorned=""
          aria-invalid={invalid || undefined}
          className={cn(
            "h-full w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-placeholder",
            className,
          )}
          {...props}
        />
        {endAdornment && (
          <span className="flex shrink-0 items-center text-ink-secondary">{endAdornment}</span>
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
        "min-h-[96px] resize-y px-4 py-3 text-base",
        fieldBase,
        invalid
          ? "border-error focus:border-error focus:ring-1 focus:ring-error"
          : "border-line focus:border-ink focus:ring-1 focus:ring-ink",
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
          "h-12 cursor-pointer appearance-none pr-10 pl-4 text-base",
          fieldBase,
          invalid
            ? "border-error focus:border-error focus:ring-1 focus:ring-error"
            : "border-line focus:border-ink focus:ring-1 focus:ring-ink",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-ink-secondary" />
    </div>
  ),
);
Select.displayName = "Select";

/**
 * The red asterisk after a required field's label. Visual only: the input's
 * own `required` attribute is what tells assistive tech, so this is hidden
 * from it rather than read out as "star".
 */
export function RequiredMark() {
  return (
    <span className="ml-0.5 text-error" aria-hidden="true">
      *
    </span>
  );
}

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  /** Append a `RequiredMark`. Keep `required` on the input as well. */
  required?: boolean;
};

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: reusable Label primitive; htmlFor/control supplied by caller
    <label className={cn("mb-2 block font-medium text-ink text-sm", className)} {...props}>
      {children}
      {required && <RequiredMark />}
    </label>
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

/**
 * The message under a field that failed validation. Give it an `id` and point
 * the input's `aria-describedby` at it so screen readers read it with the field.
 */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-error text-sm">
      {children}
    </p>
  );
}

export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("mb-4", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error && <FieldError>{error}</FieldError>}
      {!error && hint && <p className="mt-1.5 text-ink-secondary text-sm">{hint}</p>}
    </div>
  );
}
