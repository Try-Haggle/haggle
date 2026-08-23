"use client";

import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  type ListingParcelInput,
  listingParcelToInput,
  matchingParcelGuideId,
  PARCEL_SIZE_GUIDES,
} from "@/lib/fulfillment-options";
import { ParcelSizeGuideArt } from "./parcel-size-guide";

export function ListingParcelFields({
  value,
  onChange,
  required,
}: {
  value: ListingParcelInput;
  onChange: (next: ListingParcelInput) => void;
  required?: boolean;
}) {
  const selectedGuideId = matchingParcelGuideId(value);
  const set = (field: keyof ListingParcelInput, next: string) => {
    onChange({ ...value, [field]: next });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Parcel {required ? <span className="text-warning">*</span> : null}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Skip the tape measure. Pick the closest box, or guess within a couple of inches. Carriers
          almost never add a surcharge unless the package is clearly a different size or much
          heavier.
        </p>
      </div>

      <ParcelSizeGuideArt />

      <div className="flex flex-wrap gap-2">
        {PARCEL_SIZE_GUIDES.map((guide) => (
          <Chip
            key={guide.id}
            type="button"
            size="sm"
            selected={selectedGuideId === guide.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(listingParcelToInput(guide.parcel))}
          >
            {guide.title}
          </Chip>
        ))}
      </div>

      {selectedGuideId && (
        <p className="text-xs text-ink-secondary">
          {PARCEL_SIZE_GUIDES.find((guide) => guide.id === selectedGuideId)?.hint}. You can still
          tweak the numbers if your box is a bit off.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-ink-muted" htmlFor="listing-parcel-weight">
          Weight (oz)
          <Input
            id="listing-parcel-weight"
            className="mt-1"
            inputMode="decimal"
            value={value.weight_oz}
            placeholder="16"
            onChange={(event) => set("weight_oz", event.target.value)}
          />
        </label>
        <label className="text-xs text-ink-muted" htmlFor="listing-parcel-length">
          Length (in)
          <Input
            id="listing-parcel-length"
            className="mt-1"
            inputMode="decimal"
            value={value.length_in}
            placeholder="10"
            onChange={(event) => set("length_in", event.target.value)}
          />
        </label>
        <label className="text-xs text-ink-muted" htmlFor="listing-parcel-width">
          Width (in)
          <Input
            id="listing-parcel-width"
            className="mt-1"
            inputMode="decimal"
            value={value.width_in}
            placeholder="8"
            onChange={(event) => set("width_in", event.target.value)}
          />
        </label>
        <label className="text-xs text-ink-muted" htmlFor="listing-parcel-height">
          Height (in)
          <Input
            id="listing-parcel-height"
            className="mt-1"
            inputMode="decimal"
            value={value.height_in}
            placeholder="4"
            onChange={(event) => set("height_in", event.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-ink-muted">16 oz is 1 lb. A few ounces off is usually fine.</p>
    </div>
  );
}
