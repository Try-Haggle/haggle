import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
  "aria-label"?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  size = "md",
  className,
  ...rest
}: SwitchProps) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50",
        sm ? "h-4 w-7" : "h-5 w-9",
        checked ? "bg-action-primary" : "bg-surface-sunken",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "inline-block transform rounded-full bg-on-accent shadow-sm transition-transform",
          sm ? "h-3 w-3" : "h-4 w-4",
          checked ? (sm ? "translate-x-3.5" : "translate-x-4.5") : "translate-x-0.5",
        )}
      />
    </button>
  );
}
