import { Carousel } from "@/components/ui/carousel";
import { cn } from "@/lib/cn";
import type { Story } from "./types";

export const carouselStory: Story = {
  slug: "carousel",
  name: "Carousel",
  componentName: "Carousel",
  controls: {},
  render: (_a, className) => (
    <div className={cn("w-[32rem] min-w-0 max-w-full", className)}>
      <Carousel title="비슷한 매물" ariaLabel="데모 항목">
        {Array.from({ length: 8 }, (_, i) => `card-${i + 1}`).map((key, i) => (
          <div
            key={key}
            className="flex h-28 w-40 shrink-0 snap-start items-center justify-center rounded-xl border border-line bg-surface-sunken font-semibold text-ink-secondary"
          >
            {i + 1}
          </div>
        ))}
      </Carousel>
    </div>
  ),
};
