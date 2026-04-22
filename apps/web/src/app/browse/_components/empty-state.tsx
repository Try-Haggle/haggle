import Link from "next/link";
import { WaitlistForm } from "@/components/waitlist-form";
import { LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";

type Category = (typeof LISTING_CATEGORIES)[number];

export function BrowseEmptyState({
  activeCategory,
}: {
  activeCategory: Category | null;
}) {
  const source = activeCategory
    ? `browse-empty-${activeCategory}`
    : "browse-empty";

  return (
    <div className="py-16 sm:py-20">
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>

        <h3 className="mb-2 text-xl font-semibold text-slate-100">
          {activeCategory
            ? `No ${LISTING_CATEGORY_LABELS[activeCategory]} listings yet`
            : "No listings yet"}
        </h3>
        <p className="mb-8 text-sm text-slate-400">
          {activeCategory
            ? "Leave your email and we'll notify you when a seller lists something here."
            : "Be the first to know when new listings arrive. Tell us what you're looking for."}
        </p>

        <div>
          <WaitlistForm source={source} />
        </div>

        <div className="my-10 h-px w-full bg-slate-800" />

        <div>
          <p className="mb-4 text-sm text-slate-400">
            Or do you have something to sell?
          </p>
          <Link
            href="/sell/listings/new"
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
          >
            List your item
          </Link>
        </div>
      </div>
    </div>
  );
}
