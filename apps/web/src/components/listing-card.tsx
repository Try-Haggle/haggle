import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Price } from "@/components/ui/price";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCondition, formatTimeAgo } from "@/lib/format";

export interface ListingCardListing {
  publicId: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  publishedAt?: string;
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
  const aspectClass = imageAspect === "square" ? "aspect-square" : "aspect-[4/3]";
  const href = from
    ? `/l/${listing.publicId}?from=${encodeURIComponent(from)}`
    : `/l/${listing.publicId}`;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group overflow-hidden rounded-xl border border-line bg-surface-raised transition-colors hover:border-line-strong hover:bg-surface-sunken ${className}`}
      style={style}
    >
      <div className={`${aspectClass} w-full overflow-hidden bg-surface-sunken`}>
        {listing.photoUrl ? (
          // biome-ignore lint/performance/noImgElement: remote listing photo
          <img
            src={listing.photoUrl}
            alt={listing.title ?? "Listing"}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-muted">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3 sm:p-4">
        <h3 className="mb-1 truncate font-medium text-ink text-sm">
          {listing.title ?? "Untitled"}
        </h3>
        <div className="mb-2 flex items-center gap-1.5 text-ink-secondary text-xs">
          {listing.category && <span className="capitalize">{listing.category}</span>}
          {listing.category && listing.condition && <span>·</span>}
          {listing.condition && <span>{formatCondition(listing.condition)}</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Price amount={Number(listing.targetPrice ?? 0)} tone="accent" />
          {listing.publishedAt && (
            <div className="text-ink-muted text-xs">{formatTimeAgo(listing.publishedAt)}</div>
          )}
        </div>
        {matchReasons && matchReasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {matchReasons.slice(0, 2).map((reason) => (
              <Badge key={reason} tone="neutral" size="sm">
                {reason}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function ListingCardSkeleton({ imageAspect = "4/3" }: { imageAspect?: "square" | "4/3" }) {
  const aspectClass = imageAspect === "square" ? "aspect-square" : "aspect-[4/3]";
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
      <Skeleton className={`${aspectClass} w-full rounded-none`} />
      <div className="space-y-2 p-3 sm:p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    </div>
  );
}
