"use client";

import { ITEM_CONDITIONS, LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { RangeSlider } from "@/components/ui/slider";
import type { BrowseFilters } from "../page";
import {
  CONDITION_LABELS,
  formatBucketLabel,
  makeScale,
  type PriceBucket,
  SLIDER_RES,
  useUpdateParams,
} from "./filter-shared";

type Condition = (typeof ITEM_CONDITIONS)[number];
type Category = (typeof LISTING_CATEGORIES)[number];

export function FilterSheet({
  open,
  onClose,
  filters,
  priceRange,
  priceBuckets,
}: {
  open: boolean;
  onClose: () => void;
  filters: BrowseFilters;
  priceRange: { min: number; max: number } | null;
  priceBuckets: PriceBucket[];
}) {
  const update = useUpdateParams();

  const bounds =
    priceRange && priceRange.max > priceRange.min
      ? { min: Math.floor(priceRange.min), max: Math.ceil(priceRange.max) }
      : null;
  const scale = bounds ? makeScale(bounds.min, bounds.max) : null;

  // Local temp state — applied to URL only on Apply
  const [categories, setCategories] = useState<Category[]>(filters.categories);
  const [conditions, setConditions] = useState<Condition[]>(filters.conditions);
  const [sliderValues, setSliderValues] = useState<[number, number]>(() => {
    if (!bounds || !scale) return [0, SLIDER_RES];
    const lo = filters.minPrice !== undefined ? scale.priceToSlider(filters.minPrice) : 0;
    const hi = filters.maxPrice !== undefined ? scale.priceToSlider(filters.maxPrice) : SLIDER_RES;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  });
  const [minInput, setMinInput] = useState<string>("");
  const [maxInput, setMaxInput] = useState<string>("");

  const liveLo = scale ? scale.sliderToPrice(sliderValues[0]) : 0;
  const liveHi = scale ? scale.sliderToPrice(sliderValues[1]) : 0;

  // Re-sync local state when sheet opens or external filters/bounds change
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only on open / external filter change
  useEffect(() => {
    if (!open) return;
    setCategories(filters.categories);
    setConditions(filters.conditions);
    if (bounds && scale) {
      const lo = filters.minPrice !== undefined ? scale.priceToSlider(filters.minPrice) : 0;
      const hi =
        filters.maxPrice !== undefined ? scale.priceToSlider(filters.maxPrice) : SLIDER_RES;
      setSliderValues([Math.min(lo, hi), Math.max(lo, hi)]);
    }
  }, [
    open,
    filters.categories,
    filters.conditions,
    filters.minPrice,
    filters.maxPrice,
    bounds?.min,
    bounds?.max,
  ]);

  // Mirror slider into inputs
  useEffect(() => {
    setMinInput(String(liveLo));
    setMaxInput(String(liveHi));
  }, [liveLo, liveHi]);

  function toggleCategory(c: Category) {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }
  function toggleCondition(c: Condition) {
    setConditions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }
  function applyInputs() {
    if (!bounds || !scale) return;
    const loN = Number(minInput);
    const hiN = Number(maxInput);
    if (!Number.isFinite(loN) || !Number.isFinite(hiN)) return;
    const a = Math.max(bounds.min, Math.min(loN, bounds.max));
    const b = Math.max(bounds.min, Math.min(hiN, bounds.max));
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    setSliderValues([scale.priceToSlider(lo), scale.priceToSlider(hi)]);
  }
  function applyBucket(b: PriceBucket) {
    if (!bounds || !scale) return;
    const lo = Math.max(b.min, bounds.min);
    const hi = b.max === null ? bounds.max : Math.min(b.max, bounds.max);
    setSliderValues([scale.priceToSlider(lo), scale.priceToSlider(hi)]);
  }

  function applyAll() {
    update((p) => {
      if (categories.length === 0) p.delete("category");
      else p.set("category", categories.join(","));

      if (bounds && scale) {
        const lo = scale.sliderToPrice(sliderValues[0]);
        const hi = scale.sliderToPrice(sliderValues[1]);
        if (sliderValues[0] <= 0) p.delete("minPrice");
        else p.set("minPrice", String(lo));
        if (sliderValues[1] >= SLIDER_RES) p.delete("maxPrice");
        else p.set("maxPrice", String(hi));
      } else {
        p.delete("minPrice");
        p.delete("maxPrice");
      }

      if (conditions.length === 0) p.delete("condition");
      else p.set("condition", conditions.join(","));
    });
    onClose();
  }

  function resetLocal() {
    setCategories([]);
    setConditions([]);
    setSliderValues([0, SLIDER_RES]);
  }

  const localActiveCount =
    (categories.length > 0 ? 1 : 0) +
    (sliderValues[0] > 0 || sliderValues[1] < SLIDER_RES ? 1 : 0) +
    (conditions.length > 0 ? 1 : 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="bottom"
      title="Filters"
      footer={
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={resetLocal}>
            Reset all
          </Button>
          <Button className="ml-auto" onClick={applyAll}>
            Apply{localActiveCount > 0 ? ` (${localActiveCount})` : ""}
          </Button>
        </div>
      }
    >
      {/* Categories */}
      <section className="pb-5">
        <h3 className="mb-2 text-ink-muted text-xs uppercase tracking-wide">Categories</h3>
        <div className="grid grid-cols-2 gap-1">
          {LISTING_CATEGORIES.map((c) => (
            <Checkbox
              key={c}
              checked={categories.includes(c)}
              onChange={() => toggleCategory(c)}
              label={LISTING_CATEGORY_LABELS[c]}
            />
          ))}
        </div>
      </section>

      {/* Price */}
      <section className="border-line border-t py-5">
        <h3 className="mb-2 text-ink-muted text-xs uppercase tracking-wide">Price</h3>
        {!bounds ? (
          <p className="text-ink-secondary text-sm">No priced listings to filter.</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-ink-secondary">${liveLo}</span>
              <span className="text-ink-secondary">${liveHi}</span>
            </div>
            <RangeSlider
              min={0}
              max={SLIDER_RES}
              step={1}
              minStepsBetweenThumbs={1}
              value={sliderValues}
              onValueChange={setSliderValues}
              minLabel="Min price"
              maxLabel="Max price"
            />
            <div className="mt-1 flex items-center justify-between text-ink-muted text-xs">
              <span>${bounds.min}</span>
              <span>${bounds.max}</span>
            </div>

            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={bounds.min}
                max={bounds.max}
                placeholder="Min"
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                onBlur={applyInputs}
                startAdornment="$"
                aria-label="Minimum price"
              />
              <span className="text-ink-muted">–</span>
              <Input
                type="number"
                inputMode="numeric"
                min={bounds.min}
                max={bounds.max}
                placeholder="Max"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                onBlur={applyInputs}
                startAdornment="$"
                aria-label="Maximum price"
              />
            </div>

            {priceBuckets.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] text-ink-muted uppercase tracking-wide">
                  Popular ranges
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {priceBuckets.map((b) => (
                    <Chip key={`${b.min}-${b.max}`} size="sm" onClick={() => applyBucket(b)}>
                      {formatBucketLabel(b)}
                      <span className="text-[10px] text-ink-muted">{b.count}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Condition */}
      <section className="border-line border-t py-5">
        <h3 className="mb-2 text-ink-muted text-xs uppercase tracking-wide">Condition</h3>
        <div className="grid grid-cols-2 gap-1">
          {ITEM_CONDITIONS.map((c) => (
            <Checkbox
              key={c}
              checked={conditions.includes(c)}
              onChange={() => toggleCondition(c)}
              label={CONDITION_LABELS[c] ?? c}
            />
          ))}
        </div>
      </section>
    </Drawer>
  );
}
