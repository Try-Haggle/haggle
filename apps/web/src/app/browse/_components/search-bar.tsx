"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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

  function clear() {
    setValue("");
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        type="search"
        inputMode="search"
        placeholder="Search by name or tag..."
        maxLength={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900/60 py-2 pl-10 pr-10 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
