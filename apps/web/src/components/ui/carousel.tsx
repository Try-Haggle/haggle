"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

export interface CarouselProps {
  children: ReactNode;
  /** Optional heading shown on the left of the control row. */
  title?: ReactNode;
  ariaLabel?: string;
  /**
   * Scroll distance per control press.
   * `page` (default) scrolls ~80% of the viewport; `card` scrolls whole items.
   */
  scrollBy?: "page" | "card";
  /** Items advanced per press when `scrollBy="card"`. Default 2. */
  cardsPerScroll?: number;
  /** Snap strictness for the track. `proximity` (default) or `mandatory`. */
  snap?: "proximity" | "mandatory";
  className?: string;
}

/**
 * Horizontal scroll track with prev/next controls in a header row (not overlaying content).
 * Give each child a width + `snap-start`. Edge items intentionally peek to signal more.
 */
export function Carousel({
  children,
  title,
  ariaLabel,
  scrollBy = "page",
  cardsPerScroll = 2,
  snap = "proximity",
  className,
}: CarouselProps) {
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

  const scroll = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    let amount = el.clientWidth * 0.8;
    if (scrollBy === "card") {
      // Stride = distance between two adjacent items (card width + gap), so we
      // land exactly on a card boundary. Advances `cardsPerScroll` items.
      const first = el.children[0] as HTMLElement | undefined;
      const second = el.children[1] as HTMLElement | undefined;
      const stride =
        first && second ? second.offsetLeft - first.offsetLeft : (first?.offsetWidth ?? 250);
      amount = stride * Math.max(1, cardsPerScroll);
    }
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const scrollable = canLeft || canRight;

  return (
    <section aria-label={ariaLabel} className={className}>
      {(title || scrollable) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h3 className="font-bold text-ink text-lg">{title}</h3> : <span />}
          {scrollable && (
            <div className="flex gap-1.5">
              <IconButton
                aria-label="Previous"
                variant="outline"
                shape="circle"
                size="sm"
                disabled={!canLeft}
                onClick={() => scroll(-1)}
              >
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton
                aria-label="Next"
                variant="outline"
                shape="circle"
                size="sm"
                disabled={!canRight}
                onClick={() => scroll(1)}
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
          "flex gap-4 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:hidden [scrollbar-width:none]",
          snap === "mandatory" ? "snap-x snap-mandatory" : "snap-x",
        )}
      >
        {children}
      </div>
    </section>
  );
}
