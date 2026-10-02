/**
 * US phone numbers, the only kind the shipping flow handles today.
 *
 * The form shows "(555) 123-4567" while the person types; the API stores the
 * 10 digits. Formatting is progressive so it never fights backspace: the
 * punctuation only appears once there is a digit after it.
 */

/**
 * Digits only, capped at 10. A leading 1 is kept as typed; only a pasted
 * 11-digit "+1 …" number has its country code dropped.
 */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** "5551234567" → "(555) 123-4567", built up as digits arrive. */
export function formatUsPhone(input: string): string {
  const digits = phoneDigits(input);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Complete when it has all 10 digits. */
export function isCompleteUsPhone(input: string): boolean {
  return phoneDigits(input).length === 10;
}
