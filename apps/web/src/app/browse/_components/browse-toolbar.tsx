"use client";

import { ITEM_CONDITIONS, LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";
import { type ButtonHTMLAttributes, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { RangeSlider } from "@/components/ui/slider";
import { cn } from "@/lib/cn";
import type { BrowseFilters, BrowseSort } from "../page";
import {
  CONDITION_LABELS,
  formatBucketLabel,
  makeScale,
  type PriceBucket,
  priceLabel,
  SLIDER_RES,
  SORT_LABELS,
  useUpdateParams,
} from "./filter-shared";
import { FilterSheet } from "./filter-sheet";
import { SearchBar } from "./search-bar";

type Condition = (typeof ITEM_CONDITIONS)[number];
type Category = (typeof LISTING_CATEGORIES)[number];

function FilterButton({
  active,
  open,
  label,
  ...props
}: { active: boolean; open: boolean; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        active
          ? "border-action-primary bg-action-primary/10 text-action-primary"
          : "border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-sunken",
      )}
      {...props}
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
        aria-hidden="true"
        className={cn("transition-transform", open && "rotate-180")}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

function ClearAllButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full cursor-pointer rounded-lg border border-transparent px-4 py-2 text-ink-secondary text-xs transition-colors hover:border-line hover:text-ink"
    >
      Clear all
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
    const lo = filters.minPrice !== undefined ? scale.priceToSlider(filters.minPrice) : 0;
    const hi = filters.maxPrice !== undefined ? scale.priceToSlider(filters.maxPrice) : SLIDER_RES;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  };
  const [sliderValues, setSliderValues] = useState<[number, number]>(initial());

  const liveLo = scale ? scale.sliderToPrice(sliderValues[0]) : 0;
  const liveHi = scale ? scale.sliderToPrice(sliderValues[1]) : 0;

  const [minInput, setMinInput] = useState<string>(String(liveLo));
  const [maxInput, setMaxInput] = useState<string>(String(liveHi));

  // Sync slider state when popover opens or external filters/bounds change
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only on open / external filter change
  useEffect(() => {
    if (open) setSliderValues(initial());
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
  const label = active ? `Price: ${priceLabel(filters.minPrice, filters.maxPrice)}` : "Price";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      panelClassName="w-96 p-4"
      trigger={<FilterButton active={active} open={open} label={label} />}
    >
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
            onValueCommit={(v) => {
              if (scale) commitDollars(scale.sliderToPrice(v[0]), scale.sliderToPrice(v[1]));
            }}
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
              onBlur={commitFromInputs}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitFromInputs();
                }
              }}
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
              onBlur={commitFromInputs}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitFromInputs();
                }
              }}
              startAdornment="$"
              aria-label="Maximum price"
            />
          </div>

          {priceBuckets.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-ink-muted text-xs uppercase tracking-wide">Popular ranges</p>
              <div className="flex flex-wrap gap-1.5">
                {priceBuckets.map((b) => {
                  const lo = Math.max(b.min, bounds.min);
                  const hi = b.max === null ? bounds.max : Math.min(b.max, bounds.max);
                  const isActive =
                    filters.minPrice === lo &&
                    (b.max === null
                      ? filters.maxPrice === undefined || filters.maxPrice >= bounds.max
                      : filters.maxPrice === hi);
                  return (
                    <Chip
                      key={`${b.min}-${b.max}`}
                      size="sm"
                      selected={isActive}
                      onClick={() => applyBucket(b)}
                    >
                      {formatBucketLabel(b)}
                      <span className="text-[10px] text-ink-muted">{b.count}</span>
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}

          {active && (
            <div className="mt-4 border-line border-t pt-3">
              <ClearAllButton onClick={clear} />
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

function ConditionFilter({ filters }: { filters: BrowseFilters }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();

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
  const label = active ? `Condition (${filters.conditions.length})` : "Condition";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      panelClassName="w-72"
      trigger={<FilterButton active={active} open={open} label={label} />}
    >
      <div className="grid grid-cols-2 gap-1">
        {ITEM_CONDITIONS.map((c) => (
          <Checkbox
            key={c}
            checked={filters.conditions.includes(c)}
            onChange={() => toggle(c)}
            label={CONDITION_LABELS[c] ?? c}
          />
        ))}
      </div>
      {active && (
        <div className="mt-2 border-line border-t pt-2">
          <ClearAllButton onClick={clear} />
        </div>
      )}
    </Popover>
  );
}

function SortDropdown({ filters }: { filters: BrowseFilters }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();

  function pick(next: BrowseSort) {
    update((p) => {
      if (next === "newest") p.delete("sort");
      else p.set("sort", next);
    });
    setOpen(false);
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="right"
      trigger={
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink text-sm transition-colors hover:border-line-strong hover:bg-surface-sunken"
        >
          <span className="text-ink-muted">Sort:</span> {SORT_LABELS[filters.sort]}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      }
    >
      {(Object.keys(SORT_LABELS) as BrowseSort[]).map((opt) => (
        <DropdownMenuItem key={opt} selected={filters.sort === opt} onSelect={() => pick(opt)}>
          {SORT_LABELS[opt]}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}

function CategoryFilter({ filters }: { filters: BrowseFilters }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateParams();

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
    <Popover
      open={open}
      onOpenChange={setOpen}
      panelClassName="w-72"
      trigger={<FilterButton active={active} open={open} label={label} />}
    >
      <div className="grid grid-cols-2 gap-1">
        {LISTING_CATEGORIES.map((c) => (
          <Checkbox
            key={c}
            checked={filters.categories.includes(c)}
            onChange={() => toggle(c)}
            label={LISTING_CATEGORY_LABELS[c]}
          />
        ))}
      </div>
      {active && (
        <div className="mt-2 border-line border-t pt-2">
          <ClearAllButton onClick={clear} />
        </div>
      )}
    </Popover>
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
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        active
          ? "border-action-primary bg-action-primary/10 text-action-primary"
          : "border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-sunken",
      )}
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
        aria-hidden="true"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="10" y1="18" x2="14" y2="18" />
      </svg>
      Filters
      {active && (
        <span className="rounded-full bg-action-primary/20 px-1.5 py-0.5 font-medium text-[11px] text-action-primary">
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
        <PriceFilter filters={filters} priceRange={priceRange} priceBuckets={priceBuckets} />
        <ConditionFilter filters={filters} />
        {anyActive && (
          <button
            type="button"
            onClick={resetAll}
            className="ml-3 cursor-pointer text-ink-secondary text-xs underline-offset-2 hover:text-ink hover:underline"
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
          <MobileFiltersButton activeCount={activeCount} onClick={() => setSheetOpen(true)} />
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
