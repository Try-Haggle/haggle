"use client";

import { ITEM_CONDITIONS, LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";
import * as Slider from "@radix-ui/react-slider";
import { useEffect, useState } from "react";
import { Drawer } from "vaul";
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

const SNAP_POINTS = [0.85, 1] as const;

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
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]);

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
    setSnap(SNAP_POINTS[0]);
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
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-line bg-surface outline-none"
          style={{
            height: typeof snap === "number" ? `${snap * 100}dvh` : "100dvh",
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-surface-sunken" />

          <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-3">
            <Drawer.Title className="text-lg font-semibold text-ink">Filters</Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="cursor-pointer rounded-lg p-1 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {/* Categories */}
            <section className="px-5 py-5">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Categories</h3>
              <div className="grid grid-cols-2 gap-1">
                {LISTING_CATEGORIES.map((c) => {
                  const checked = categories.includes(c);
                  return (
                    <label
                      key={c}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-sunken"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(c)}
                        className="h-4 w-4 accent-action-primary"
                      />
                      {LISTING_CATEGORY_LABELS[c]}
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Price */}
            <section className="border-t border-line px-5 py-5">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Price</h3>
              {!bounds ? (
                <p className="text-sm text-ink-secondary">No priced listings to filter.</p>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="text-ink-secondary">${liveLo}</span>
                    <span className="text-ink-secondary">${liveHi}</span>
                  </div>
                  <Slider.Root
                    className="relative flex h-5 w-full touch-none select-none items-center"
                    min={0}
                    max={SLIDER_RES}
                    step={1}
                    minStepsBetweenThumbs={1}
                    value={sliderValues}
                    onValueChange={(v) => setSliderValues([v[0], v[1]] as [number, number])}
                  >
                    <Slider.Track className="relative h-1 grow rounded-full bg-surface-sunken">
                      <Slider.Range className="absolute h-full rounded-full bg-action-primary" />
                    </Slider.Track>
                    <Slider.Thumb
                      className="block h-5 w-5 cursor-pointer rounded-full border-2 border-action-primary bg-surface-overlay shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      aria-label="Min price"
                    />
                    <Slider.Thumb
                      className="block h-5 w-5 cursor-pointer rounded-full border-2 border-action-primary bg-surface-overlay shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      aria-label="Max price"
                    />
                  </Slider.Root>
                  <div className="mt-1 flex items-center justify-between text-xs text-ink-muted">
                    <span>${bounds.min}</span>
                    <span>${bounds.max}</span>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                        $
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={bounds.min}
                        max={bounds.max}
                        placeholder="Min"
                        value={minInput}
                        onChange={(e) => setMinInput(e.target.value)}
                        onBlur={applyInputs}
                        className="w-full rounded-lg border border-line bg-surface-overlay py-2 pl-6 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-action-primary focus:outline-none"
                      />
                    </div>
                    <span className="text-ink-muted">–</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                        $
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={bounds.min}
                        max={bounds.max}
                        placeholder="Max"
                        value={maxInput}
                        onChange={(e) => setMaxInput(e.target.value)}
                        onBlur={applyInputs}
                        className="w-full rounded-lg border border-line bg-surface-overlay py-2 pl-6 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-action-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  {priceBuckets.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-muted">
                        Popular ranges
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {priceBuckets.map((b) => (
                          <button
                            key={`${b.min}-${b.max}`}
                            type="button"
                            onClick={() => applyBucket(b)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface-raised px-3 py-1 text-xs text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
                          >
                            {formatBucketLabel(b)}
                            <span className="text-[10px] text-ink-muted">{b.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Condition */}
            <section className="border-t border-line px-5 py-5">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Condition</h3>
              <div className="grid grid-cols-2 gap-1">
                {ITEM_CONDITIONS.map((c) => {
                  const checked = conditions.includes(c);
                  return (
                    <label
                      key={c}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-sunken"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCondition(c)}
                        className="h-4 w-4 accent-action-primary"
                      />
                      {CONDITION_LABELS[c] ?? c}
                    </label>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={resetLocal}
              className="cursor-pointer text-sm text-ink-secondary hover:text-ink"
            >
              Reset all
            </button>
            <button
              type="button"
              onClick={applyAll}
              className="ml-auto cursor-pointer rounded-lg bg-cta px-5 py-2 text-sm font-medium text-on-cta transition-colors hover:bg-cta-hover"
            >
              Apply{localActiveCount > 0 ? ` (${localActiveCount})` : ""}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
