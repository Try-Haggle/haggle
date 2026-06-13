import { type LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { WaitlistForm } from "@/components/waitlist-form";

type Category = (typeof LISTING_CATEGORIES)[number];

export function BrowseEmptyState({ categories, q }: { categories: Category[]; q: string }) {
  const single = categories.length === 1 ? categories[0] : null;
  const source = q
    ? "browse-empty-search"
    : single
      ? `browse-empty-${single}`
      : categories.length > 1
        ? "browse-empty-multi"
        : "browse-empty";

  const heading = q
    ? `No results for "${q}"`
    : single
      ? `No ${LISTING_CATEGORY_LABELS[single]} listings yet`
      : categories.length > 1
        ? "No listings match these categories"
        : "No listings yet";

  const subtitle = q
    ? "Try a different keyword, or adjust your filters."
    : categories.length > 0
      ? "Try adjusting your filters or leave your email to get notified."
      : "Be the first to know when new listings arrive. Tell us what you're looking for.";

  return (
    <div className="py-16 sm:py-20">
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-surface-sunken">
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-muted"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>

        <h3 className="mb-2 font-semibold text-ink text-xl">{heading}</h3>
        <p className="mb-8 text-ink-secondary text-sm">{subtitle}</p>

        <div>
          <WaitlistForm source={source} />
        </div>

        <div className="my-10 h-px w-full bg-line" />

        <div>
          <p className="mb-4 text-ink-secondary text-sm">Or do you have something to sell?</p>
          <Link href="/sell/listings/new" className={buttonVariants({ variant: "secondary" })}>
            List your item
          </Link>
        </div>
      </div>
    </div>
  );
}
