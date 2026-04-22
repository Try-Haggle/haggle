import type { BrowseListing } from "../page";
import { LISTING_CATEGORIES } from "@haggle/shared";
import { ListingCard } from "@/components/listing-card";
import { BrowseEmptyState } from "./empty-state";

type Category = (typeof LISTING_CATEGORIES)[number];

export function ListingGrid({
  listings,
  activeCategory,
}: {
  listings: BrowseListing[];
  activeCategory: Category | null;
}) {
  if (listings.length === 0) {
    return <BrowseEmptyState activeCategory={activeCategory} />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {listings.map((listing) => (
        <ListingCard key={listing.publicId} listing={listing} from="browse" />
      ))}
    </div>
  );
}
