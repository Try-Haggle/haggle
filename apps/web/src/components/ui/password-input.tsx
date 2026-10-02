"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";
import { Input, type InputProps } from "./input";

export type PasswordInputProps = Omit<InputProps, "type" | "endAdornment"> & {
  /**
   * Controlled visibility. Pass it (with `onVisibleChange`) when several
   * fields should reveal together — e.g. "password" and "confirm password".
   * Left out, each field keeps its own toggle state.
   */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
};

/** A password field with a show/hide toggle pinned to its end. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ visible, onVisibleChange, ...props }, ref) => {
    const [ownVisible, setOwnVisible] = useState(false);
    const isVisible = visible ?? ownVisible;
    const toggle = () => {
      const nextVisible = !isVisible;
      if (visible === undefined) setOwnVisible(nextVisible);
      onVisibleChange?.(nextVisible);
    };
    const Icon = isVisible ? EyeOff : Eye;

    return (
      <Input
        ref={ref}
        type={isVisible ? "text" : "password"}
        endAdornment={
          <button
            type="button"
            onClick={toggle}
            aria-label={isVisible ? "Hide password" : "Show password"}
            aria-pressed={isVisible}
            className="-mr-1 rounded p-1 text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        }
        {...props}
      />
    );
  },
);
PasswordInput.displayName = "PasswordInput";
