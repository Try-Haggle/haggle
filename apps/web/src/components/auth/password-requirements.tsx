import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/cn";

const RULES = [
  { label: "8+ characters", test: (pw: string) => pw.length >= 8 },
  { label: "One uppercase", test: (pw: string) => /[A-Z]/.test(pw) },
  { label: "One number", test: (pw: string) => /\d/.test(pw) },
  { label: "One symbol", test: (pw: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw) },
] as const;

/** True when `password` satisfies every rule shown by `PasswordRequirements`. */
export function meetsPasswordRequirements(password: string): boolean {
  return RULES.every((rule) => rule.test(password));
}

const STRENGTH = [
  { min: 4, label: "Strong", bar: "bg-success-500", text: "text-success" },
  { min: 3, label: "Fair", bar: "bg-warning-500", text: "text-warning" },
  { min: 0, label: "Weak", bar: "bg-error-500", text: "text-error" },
] as const;

/**
 * Strength bar + the password rules as a 2×2 checklist, under the field.
 *
 * Hidden until the person starts typing, then it unfolds (a grid-rows
 * transition, so it eases open instead of popping in and shoving the fields
 * below). Strength here is the share of rules met — a progress readout for
 * these rules, not an estimate of how guessable the password is.
 */
export function PasswordRequirements({
  password,
  id,
  className,
}: {
  password: string;
  id?: string;
  className?: string;
}) {
  const results = RULES.map((rule) => ({ label: rule.label, met: rule.test(password) }));
  const metCount = results.filter((rule) => rule.met).length;
  const strength = STRENGTH.find((level) => metCount >= level.min) ?? STRENGTH[2];
  const open = password.length > 0;

  return (
    <div
      id={id}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-standard motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div className={cn("space-y-2.5", className)}>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={cn("h-full rounded-full transition-all duration-200", strength.bar)}
                style={{ width: `${(metCount / RULES.length) * 100}%` }}
              />
            </div>
            <span className={cn("w-12 text-right font-medium text-sm", strength.text)}>
              {strength.label}
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {results.map((rule) => {
              const Icon = rule.met ? Check : Circle;
              return (
                <li
                  key={rule.label}
                  className={cn(
                    "flex items-center gap-2 text-sm transition-colors",
                    rule.met ? "text-success" : "text-ink-secondary",
                  )}
                >
                  {/* Fixed 16px slot: the circle is drawn smaller than the check, and
                      without the slot the label would shift as each rule is met. */}
                  <span
                    className="flex size-4 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    <Icon
                      className={rule.met ? "size-4" : "size-3.5"}
                      strokeWidth={rule.met ? 2.5 : 2}
                    />
                  </span>
                  <span className="sr-only">{rule.met ? "Met:" : "Not yet met:"}</span>
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
