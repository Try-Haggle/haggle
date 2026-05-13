"use client";

import { useEffect, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import {
  ITEM_CONDITIONS,
  LISTING_CATEGORIES,
  LISTING_CATEGORY_LABELS,
} from "@haggle/shared";
import type { BrowseFilters, BrowseSort } from "../page";
import { SearchBar } from "./search-bar";
import { FilterSheet } from "./filter-sheet";
import {
  CONDITION_LABELS,
  PriceBucket,
  SLIDER_RES,
  SORT_LABELS,
  formatBucketLabel,
  makeScale,
  priceLabel,
  useClickOutside,
  useUpdateParams,
} from "./filter-shared";

type Condition = (typeof ITEM_CONDITIONS)[number];
type Category = (typeof LISTING_CATEGORIES)[number];

function FilterButton({
  active,
  open,
  label,
  onClick,
}: {
  active: boolean;
  open: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
          : "border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-600 hover:bg-slate-800"
      }`}
    >
      {label}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform ${open ? "rotate-180" : ""}`}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

function PriceFilter({
  filters,
  priceRange,
  priceBuckets,
}: {
  filters: BrowseFilters;
  priceRange: { min: number; max: number } | null;
  priceBuckets: PriceBucket[];
}) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const bounds =
    priceRange && priceRange.max > priceRange.min
      ? { min: Math.floor(priceRange.min), max: Math.ceil(priceRange.max) }
      : null;

  const scale = bounds ? makeScale(bounds.min, bounds.max) : null;

  // Slider state in slider-space (0..SLIDER_RES). Source of truth for both
  // the slider and the live readout; inputs sync from this except while the
  // user is actively typing.
  const initial = (): [number, number] => {
    if (!bounds || !scale) return [0, SLIDER_RES];
    const lo = filters.minPrice !== undefined
      ? scale.priceToSlider(filters.minPrice)
      : 0;
    const hi = filters.maxPrice !== undefined
      ? scale.priceToSlider(filters.maxPrice)
      : SLIDER_RES;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  };
  const [sliderValues, setSliderValues] = useState<[number, number]>(initial());

  const liveLo = scale ? scale.sliderToPrice(sliderValues[0]) : 0;
  const liveHi = scale ? scale.sliderToPrice(sliderValues[1]) : 0;

  const [minInput, setMinInput] = useState<string>(String(liveLo));
  const [maxInput, setMaxInput] = useState<string>(String(liveHi));

  // Sync slider state when popover opens or external filters/bounds change
  useEffect(() => {
    if (open) setSliderValues(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bounds?.min, bounds?.max, filters.minPrice, filters.maxPrice]);

  // Mirror slider movement into the input fields (slider drives inputs).
  // When the user types into inputs, they update local state without
  // moving the slider until they commit (Enter/blur).
  useEffect(() => {
    setMinInput(String(liveLo));
    setMaxInput(String(liveHi));
  }, [liveLo, liveHi]);

  function commitDollars(loDollar: number, hiDollar: number) {
    if (!bounds || !scale) return;
    const a = Math.max(bounds.min, Math.min(loDollar, bounds.max));
    const b = Math.max(bounds.min, Math.min(hiDollar, bounds.max));
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    setSliderValues([scale.priceToSlider(lo), scale.priceToSlider(hi)]);
    update((p) => {
      if (lo <= bounds.min) p.delete("minPrice");
      else p.set("minPrice", String(lo));
      if (hi >= bounds.max) p.delete("maxPrice");
      else p.set("maxPrice", String(hi));
    });
  }

  function commitFromSlider(next: [number, number]) {
    if (!scale) return;
    commitDollars(scale.sliderToPrice(next[0]), scale.sliderToPrice(next[1]));
  }

  function commitFromInputs() {
    const loN = Number(minInput);
    const hiN = Number(maxInput);
    if (!Number.isFinite(loN) || !Number.isFinite(hiN)) return;
    commitDollars(loN, hiN);
  }

  function applyBucket(b: PriceBucket) {
    if (!bounds) return;
    const lo = Math.max(b.min, bounds.min);
    const hi = b.max === null ? bounds.max : Math.min(b.max, bounds.max);
    commitDollars(lo, hi);
  }

  function clear() {
    setSliderValues([0, SLIDER_RES]);
    update((p) => {
      p.delete("minPrice");
      p.delete("maxPrice");
    });
  }

  const active = filters.minPrice !== undefined || filters.maxPrice !== undefined;
  const label = active
    ? `Price: ${priceLabel(filters.minPrice, filters.maxPrice)}`
    : "Price";

  return (
    <div ref={ref} className="relative">
      <FilterButton
        active={active}
        open={open}
        label={label}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-96 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
          {!bounds ? (
            <p className="text-sm text-slate-400">
              No priced listings to filter.
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-slate-300">${liveLo}</span>
                <span className="text-slate-300">${liveHi}</span>
              </div>
              <Slider.Root
                className="relative flex h-5 w-full touch-none select-none items-center"
                min={0}
                max={SLIDER_RES}
                step={1}
                minStepsBetweenThumbs={1}
                value={sliderValues}
                onValueChange={(v) => setSliderValues([v[0], v[1]] as [number, number])}
                onValueCommit={(v) => commitFromSlider([v[0], v[1]] as [number, number])}
              >
                <Slider.Track className="relative h-1 grow rounded-full bg-slate-700">
                  <Slider.Range className="absolute h-full rounded-full bg-cyan-500" />
                </Slider.Track>
                <Slider.Thumb
                  className="block h-4 w-4 cursor-pointer rounded-full border-2 border-cyan-500 bg-slate-950 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  aria-label="Min price"
                />
                <Slider.Thumb
                  className="block h-4 w-4 cursor-pointer rounded-full border-2 border-cyan-500 bg-slate-950 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  aria-label="Max price"
                />
              </Slider.Root>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                <span>${bounds.min}</span>
                <span>${bounds.max}</span>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
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
                    onBlur={commitFromInputs}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitFromInputs();
                      }
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-6 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <span className="text-slate-500">–</span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
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
                    onBlur={commitFromInputs}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitFromInputs();
                      }
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-6 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {priceBuckets.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    Popular ranges
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {priceBuckets.map((b) => {
                      const lo = Math.max(b.min, bounds.min);
                      const hi = b.max === null ? bounds.max : Math.min(b.max, bounds.max);
                      const isActive =
                        filters.minPrice === lo &&
                        (b.max === null
                          ? filters.maxPrice === undefined ||
                            filters.maxPrice >= bounds.max
                          : filters.maxPrice === hi);
                      return (
                        <button
                          key={`${b.min}-${b.max}`}
                          type="button"
                          onClick={() => applyBucket(b)}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                            isActive
                              ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white"
                          }`}
                        >
                          {formatBucketLabel(b)}
                          <span className="text-[10px] text-slate-500">
                            {b.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {active && (
                <div className="mt-4 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={clear}
                    className="block w-full cursor-pointer rounded-lg border border-transparent px-4 py-2 text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConditionFilter({ filters }: { filters: BrowseFilters }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  function toggle(c: Condition) {
    const next = filters.conditions.includes(c)
      ? filters.conditions.filter((x) => x !== c)
      : [...filters.conditions, c];
    update((p) => {
      if (next.length === 0) p.delete("condition");
      else p.set("condition", next.join(","));
    });
  }

  function clear() {
    update((p) => p.delete("condition"));
  }

  const active = filters.conditions.length > 0;
  const label = active
    ? `Condition (${filters.conditions.length})`
    : "Condition";

  return (
    <div ref={ref} className="relative">
      <FilterButton
        active={active}
        open={open}
        label={label}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-1">
            {ITEM_CONDITIONS.map((c) => {
              const checked = filters.conditions.includes(c);
              return (
                <label
                  key={c}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c)}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  {CONDITION_LABELS[c] ?? c}
                </label>
              );
            })}
          </div>
          {active && (
            <div className="mt-2 border-t border-slate-800 pt-2">
              <button
                type="button"
                onClick={clear}
                className="block w-full cursor-pointer rounded-lg border border-transparent px-4 py-2 text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SortDropdown({ filters }: { filters: BrowseFilters }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  function pick(next: BrowseSort) {
    update((p) => {
      if (next === "newest") p.delete("sort");
      else p.set("sort", next);
    });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800"
      >
        <span className="text-slate-500">Sort:</span> {SORT_LABELS[filters.sort]}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {(Object.keys(SORT_LABELS) as BrowseSort[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              className={`block w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:bg-slate-800 ${
                filters.sort === opt ? "bg-slate-800 text-cyan-300" : "text-slate-200"
              }`}
            >
              {SORT_LABELS[opt]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryFilter({ filters }: { filters: BrowseFilters }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  function toggle(c: Category) {
    const next = filters.categories.includes(c)
      ? filters.categories.filter((x) => x !== c)
      : [...filters.categories, c];
    update((p) => {
      if (next.length === 0) p.delete("category");
      else p.set("category", next.join(","));
    });
  }

  function clear() {
    update((p) => p.delete("category"));
  }

  const active = filters.categories.length > 0;
  const label = active
    ? filters.categories.length === 1
      ? LISTING_CATEGORY_LABELS[filters.categories[0]]
      : `Categories (${filters.categories.length})`
    : "All categories";

  return (
    <div ref={ref} className="relative">
      <FilterButton
        active={active}
        open={open}
        label={label}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-1">
            {LISTING_CATEGORIES.map((c) => {
              const checked = filters.categories.includes(c);
              return (
                <label
                  key={c}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c)}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  {LISTING_CATEGORY_LABELS[c]}
                </label>
              );
            })}
          </div>
          {active && (
            <div className="mt-2 border-t border-slate-800 pt-2">
              <button
                type="button"
                onClick={clear}
                className="block w-full cursor-pointer rounded-lg border border-transparent px-4 py-2 text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MobileFiltersButton({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  const active = activeCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
          : "border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-600 hover:bg-slate-800"
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="10" y1="18" x2="14" y2="18" />
      </svg>
      Filters
      {active && (
        <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[11px] font-medium text-cyan-200">
          {activeCount}
        </span>
      )}
    </button>
  );
}

export function BrowseToolbar({
  filters,
  priceRange,
  priceBuckets,
}: {
  filters: BrowseFilters;
  priceRange: { min: number; max: number } | null;
  priceBuckets: PriceBucket[];
}) {
  const update = useUpdateParams();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount =
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.minPrice !== undefined || filters.maxPrice !== undefined ? 1 : 0) +
    (filters.conditions.length > 0 ? 1 : 0);

  const anyActive = activeCount > 0;

  function resetAll() {
    update((p) => {
      p.delete("category");
      p.delete("minPrice");
      p.delete("maxPrice");
      p.delete("condition");
    });
  }

  return (
    <>
      {/* Desktop: full inline filter row */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <div className="w-72 shrink-0">
          <SearchBar initialQ={filters.q} />
        </div>
        <CategoryFilter filters={filters} />
        <PriceFilter
          filters={filters}
          priceRange={priceRange}
          priceBuckets={priceBuckets}
        />
        <ConditionFilter filters={filters} />
        {anyActive && (
          <button
            type="button"
            onClick={resetAll}
            className="ml-3 cursor-pointer text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline"
          >
            Reset filters
          </button>
        )}
        <div className="flex-1" />
        <SortDropdown filters={filters} />
      </div>

      {/* Mobile: search row + filters/sort row + bottom sheet */}
      <div className="flex flex-col gap-2 md:hidden">
        <SearchBar initialQ={filters.q} />
        <div className="flex items-center justify-between gap-2">
          <MobileFiltersButton
            activeCount={activeCount}
            onClick={() => setSheetOpen(true)}
          />
          <SortDropdown filters={filters} />
        </div>
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        priceRange={priceRange}
        priceBuckets={priceBuckets}
      />
    </>
  );
}
