import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Text that navigates. Colour says "link" at rest; hover adds the underline,
 * because a shade change alone is too faint to read as a response.
 *
 * - `accent` — a standalone call to act ("Sign up", "View all").
 * - `subtle` — a secondary way out that should not compete ("Forgot password?").
 * - `inline` — a link inside running prose. Underlined at rest too: next to
 *   body text, colour alone does not reliably mark it as a link.
 *
 * Links rest in the brand gold and deepen on hover (`text-link` →
 * `text-link-hover`). A deliberate brand call: the gold is only ~2.3:1 as
 * text on cream, so keep link text at 16px+ and medium weight, never small.
 *
 * Buttons that should look like a link use `textLinkVariants()` directly.
 */
export const textLinkVariants = cva(
  "rounded-sm underline-offset-4 transition-colors not-disabled:hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      variant: {
        accent: "font-medium text-link not-disabled:hover:text-link-hover",
        subtle: "font-medium text-ink-secondary not-disabled:hover:text-ink",
        inline:
          "text-link underline decoration-link/40 hover:text-link-hover hover:decoration-current",
      },
    },
    defaultVariants: { variant: "accent" },
  },
);

export type TextLinkProps = ComponentProps<typeof Link> & VariantProps<typeof textLinkVariants>;

export function TextLink({ variant, className, ...props }: TextLinkProps) {
  return <Link className={cn(textLinkVariants({ variant }), className)} {...props} />;
}
