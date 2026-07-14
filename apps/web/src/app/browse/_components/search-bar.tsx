"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { scrollToStickyToolbar } from "./sticky-toolbar";

const DEBOUNCE_MS = 300;

export function SearchBar({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQ);
  const lastPushedRef = useRef(initialQ);

  // Sync local state only when the URL changed externally (browser back,
  // navigation, etc.) — never when the change came from our own push, so
  // in-flight user input isn't overwritten by a stale SSR roundtrip.
  useEffect(() => {
    if (initialQ === lastPushedRef.current) return;
    setValue(initialQ);
    lastPushedRef.current = initialQ;
  }, [initialQ]);

  // Debounced URL update
  useEffect(() => {
    const next = value.trim();
    if (next === lastPushedRef.current) return;
    const t = setTimeout(() => {
      lastPushedRef.current = next;
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      requestAnimationFrame(scrollToStickyToolbar);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, pathname, router, searchParams]);

  return (
    <Input
      type="search"
      inputMode="search"
      placeholder="Search by name or tag..."
      maxLength={100}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      aria-label="Search listings"
      className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      startAdornment={<Search className="size-4.5" aria-hidden="true" />}
      endAdornment={
        value ? (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label="Clear search"
            className="-mr-1 cursor-pointer rounded p-1 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : undefined
      }
    />
  );
}
