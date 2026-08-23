"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * Always returns `false` on the server and on the first client render, then
 * settles after mount. That is deliberate: a hook that guessed the real value
 * during SSR would render different markup on the two sides and trip a
 * hydration mismatch. Use it to pick behaviour (which way a drawer opens),
 * never to decide whether content exists — CSS breakpoints are still the right
 * tool for that.
 *
 * @example
 * const isCompact = useMediaQuery("(max-width: 1023px)");
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
