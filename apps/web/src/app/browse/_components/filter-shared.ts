"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { BrowseSort } from "../page";
import { scrollToStickyToolbar } from "./sticky-toolbar";

export const SORT_LABELS: Record<BrowseSort, string> = {
  newest: "Newest",
  price_asc: "Price: Low to High",
  price_desc: "Price: High to Low",
};

export const CONDITION_LABELS: Record<string, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export function priceLabel(min?: number, max?: number): string | null {
  if (min !== undefined && max !== undefined) return `$${min}–$${max}`;
  if (min !== undefined) return `≥ $${min}`;
  if (max !== undefined) return `≤ $${max}`;
  return null;
}

// Slider position is an internal 0..SLIDER_RES integer mapped to dollars
// via a log scale, so the cheap end (where most listings cluster) gets
// the majority of the visual range and the expensive tail stays usable
// without dominating it.
export const SLIDER_RES = 1000;

export function niceRound(x: number): number {
  if (x <= 100) return Math.round(x);
  if (x <= 1000) return Math.round(x / 5) * 5;
  if (x <= 10000) return Math.round(x / 50) * 50;
  if (x <= 100000) return Math.round(x / 500) * 500;
  return Math.round(x / 5000) * 5000;
}

export function makeScale(boundsMin: number, boundsMax: number) {
  const lnMin = Math.log(Math.max(boundsMin, 1));
  const lnMax = Math.log(Math.max(boundsMax, boundsMin + 1));
  const sliderToPrice = (s: number): number => {
    if (s <= 0) return boundsMin;
    if (s >= SLIDER_RES) return boundsMax;
    const ln = lnMin + (s / SLIDER_RES) * (lnMax - lnMin);
    return niceRound(Math.exp(ln));
  };
  const priceToSlider = (p: number): number => {
    if (p <= boundsMin) return 0;
    if (p >= boundsMax) return SLIDER_RES;
    const ln = Math.log(Math.max(p, 1));
    return Math.round(((ln - lnMin) / (lnMax - lnMin)) * SLIDER_RES);
  };
  return { sliderToPrice, priceToSlider };
}

export type PriceBucket = { min: number; max: number | null; count: number };

export function formatBucketLabel(b: PriceBucket): string {
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;
  if (b.min === 0 && b.max !== null) return `Under ${fmt(b.max)}`;
  if (b.max === null) return `Over ${fmt(b.min)}`;
  return `${fmt(b.min)}–${fmt(b.max)}`;
}

export function useClickOutside<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);
  return ref;
}

export function useUpdateParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (mut: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mut(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    requestAnimationFrame(scrollToStickyToolbar);
  };
}
