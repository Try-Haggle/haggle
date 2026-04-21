import Link from "next/link";

export interface ListingCardListing {
  publicId: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
}

function formatPrice(price: string | null): string {
  if (!price) return "$0";
  const n = parseFloat(price);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCondition(condition: string | null): string {
  if (!condition) return "";
  const map: Record<string, string> = {
    new: "New",
    like_new: "Like New",
    good: "Good",
    fair: "Fair",
    poor: "Poor",
  };
  return map[condition] ?? condition;
}

export function ListingCard({
  listing,
  matchReasons,
  onClick,
  className = "",
  style,
  imageAspect = "4/3",
  from,
}: {
  listing: ListingCardListing;
  matchReasons?: string[];
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  imageAspect?: "square" | "4/3";
  from?: string | null;
}) {
  const aspectClass =
    imageAspect === "square" ? "aspect-square" : "aspect-[4/3]";
  const href = from
    ? `/l/${listing.publicId}?from=${encodeURIComponent(from)}`
    : `/l/${listing.publicId}`;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-700 hover:bg-slate-800/50 ${className}`}
      style={style}
    >
      <div className={`${aspectClass} w-full overflow-hidden bg-slate-800`}>
        {listing.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.photoUrl}
            alt={listing.title ?? "Listing"}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-600">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3 sm:p-4">
        <h3 className="mb-1 truncate text-sm font-medium text-white">
          {listing.title ?? "Untitled"}
        </h3>
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
          {listing.category && (
            <span className="capitalize">{listing.category}</span>
          )}
          {listing.category && listing.condition && <span>·</span>}
          {listing.condition && (
            <span>{formatCondition(listing.condition)}</span>
          )}
        </div>
        <div className="text-base font-semibold text-emerald-400">
          {formatPrice(listing.targetPrice)}
        </div>
        {matchReasons && matchReasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {matchReasons.slice(0, 2).map((reason) => (
              <span
                key={reason}
                className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400"
              >
                {reason}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
