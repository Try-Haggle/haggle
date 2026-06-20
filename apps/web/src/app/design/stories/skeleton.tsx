import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import type { Story } from "./types";

export const skeletonStory: Story = {
  slug: "skeleton",
  name: "Skeleton",
  componentName: "Skeleton",
  controls: {
    shape: { type: "select", options: ["text", "circle", "card"], default: "text" },
  },
  render: (a, className) => {
    const shape = a.shape as string;
    let content = (
      <div className="space-y-2">
        <Skeleton className={cn("h-4 w-full", className)} />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
    if (shape === "circle") {
      content = (
        <div className="flex items-center gap-3">
          <Skeleton className={cn("size-12 shrink-0 rounded-full", className)} />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      );
    } else if (shape === "card") {
      content = (
        <div className="space-y-3">
          <Skeleton className={cn("aspect-video w-full", className)} />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }
    // Skeletons live on raised surfaces; the catalog preview bg is sunken, so wrap in a Card.
    return <Card className="w-64">{content}</Card>;
  },
};
