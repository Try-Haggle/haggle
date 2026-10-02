"use client";

import { useCallback, useState } from "react";

/**
 * Per-field validation messages for a form whose submit button stays enabled.
 *
 * `report` replaces the messages with a fresh validation result and moves
 * focus to the first failing field, so pressing submit always says exactly
 * what is missing (a disabled button only says "something"). Keys are the
 * inputs' ids, in form order. `clear` drops one message as soon as that
 * field is edited.
 */
export function useFieldErrors<Field extends string>(
  /** Maps a field key to its input id, when they differ. */
  idFor: (field: Field) => string = (field) => field,
) {
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const report = useCallback(
    (next: Partial<Record<Field, string>>) => {
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) document.getElementById(idFor(first as Field))?.focus();
      return first === undefined;
    },
    [idFor],
  );

  const clear = useCallback((field: Field) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _removed, ...rest } = current;
      return rest as Partial<Record<Field, string>>;
    });
  }, []);

  return { errors, report, clear };
}

/** A deliberately loose shape check; the auth server is the real judge. */
export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
