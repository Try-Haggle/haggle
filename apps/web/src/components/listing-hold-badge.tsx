import { Badge } from "@/components/ui/badge";
import { listingHoldLabel, type PublicListingHoldState } from "@/lib/listing-hold";

const TONE: Record<PublicListingHoldState, "warning" | "info" | "neutral"> = {
  held: "warning",
  funding: "info",
  sold: "neutral",
};

export function ListingHoldBadge({
  holdState,
  className,
}: {
  holdState: PublicListingHoldState | null | undefined;
  className?: string;
}) {
  const label = listingHoldLabel(holdState);
  if (!label || !holdState) return null;
  return (
    <Badge tone={TONE[holdState]} size="sm" className={className}>
      {label}
    </Badge>
  );
}
