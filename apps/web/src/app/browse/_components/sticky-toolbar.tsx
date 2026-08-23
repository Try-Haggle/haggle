"use client";

import { useEffect, useRef, useState } from "react";

const STICKY_BAND_ID = "browse-toolbar-band";

/**
 * After a filter/search/sort change, scroll the page so the sticky toolbar
 * sits at its pinned position (below the global nav on desktop, at viewport
 * top on mobile). This keeps the toolbar visually anchored across rapid
 * filter adjustments instead of resetting to the page top each time.
 *
 * No-op when the user is already above the stuck point — we only ever scroll
 * upward, never push them down.
 */
export function scrollToStickyToolbar() {
  const band = document.getElementById(STICKY_BAND_ID);
  if (!band) return;
  const isDesktop = window.matchMedia("(min-width: 768px)").matches;
  const offset = isDesktop ? 64 : 0;
  const docTop = band.getBoundingClientRect().top + window.scrollY;
  const target = docTop - offset;
  if (window.scrollY > target) {
    window.scrollTo(0, target);
  }
}

/**
 * Wraps the browse toolbar in a sticky band that gains a bottom border only
 * when actually pinned to the top edge (below the global nav on desktop, at
 * viewport top on mobile). In its natural position it's borderless so it
 * blends with the header above.
 */
export function StickyToolbar({ children }: { children: React.ReactNode }) {
  const [stuck, setStuck] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      const offset = isDesktop ? 64 : 0;
      const top = el.getBoundingClientRect().top;
      // Subpixel safety: treat "within 1px of the offset" as stuck.
      setStuck(top <= offset + 1);
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      ref={ref}
      id={STICKY_BAND_ID}
      className={`sticky top-0 z-40 bg-surface/80 backdrop-blur-md transition-[border-color] md:top-16 ${
        stuck ? "border-line border-b" : "border-transparent border-b"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">{children}</div>
    </div>
  );
}
