"use client";

import { useEffect, useState } from "react";

/**
 * Watches the given section IDs and returns the one currently most visible
 * in the viewport. Used to highlight the active nav link in Topbar.
 */
export function useScrollSpy(
  sectionIds: string[],
  options?: {
    /** Account for sticky topbar + bias toward upper viewport portion. */
    rootMargin?: string;
    /** Minimum visibility ratio to qualify as "active". */
    minRatio?: number;
  },
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (sectionIds.length === 0) return;

    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const ratios = new Map<string, number>();
    sections.forEach((s) => ratios.set(s.id, 0));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          ratios.set(entry.target.id, entry.intersectionRatio);
        });

        let bestId: string | null = null;
        let bestRatio = 0;
        ratios.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        });

        const minRatio = options?.minRatio ?? 0.05;
        setActiveId(bestRatio > minRatio ? bestId : null);
      },
      {
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        rootMargin: options?.rootMargin ?? "-80px 0px -40% 0px",
      },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [sectionIds, options?.rootMargin, options?.minRatio]);

  return activeId;
}
