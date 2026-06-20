"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

export interface CarouselProps {
  children: ReactNode;
  /** Optional title shown on the left of the control row. */
  title?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/**
 * Horizontal scroll track with prev/next controls in a header row (not overlaying content).
 * Give each child a width + `snap-start`. Edge items intentionally peek to signal more.
 */
export function Carousel({ children, title, ariaLabel, className }: CarouselProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollByPage = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const scrollable = canLeft || canRight;

  return (
    <section aria-label={ariaLabel} className={className}>
      {(title || scrollable) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h3 className="font-semibold text-ink">{title}</h3> : <span />}
          {scrollable && (
            <div className="flex gap-1.5">
              <IconButton
                aria-label="Previous"
                variant="outline"
                shape="circle"
                size="sm"
                disabled={!canLeft}
                onClick={() => scrollByPage(-1)}
              >
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton
                aria-label="Next"
                variant="outline"
                shape="circle"
                size="sm"
                disabled={!canRight}
                onClick={() => scrollByPage(1)}
              >
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
          )}
        </div>
      )}
      <div
        ref={ref}
        className={cn(
          "flex snap-x gap-4 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:hidden [scrollbar-width:none]",
        )}
      >
        {children}
      </div>
    </section>
  );
}
