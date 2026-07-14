import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ListRow } from "@/components/ui/list-row";
import type { Story } from "./types";

export const listRowStory: Story = {
  slug: "list-row",
  name: "ListRow",
  componentName: "ListRow",
  controls: {
    title: { type: "text", default: "iPhone 14 Pro 128GB" },
    meta: { type: "text", default: "Like New · electronics · 10h ago" },
    withLeading: { type: "boolean", default: true },
    withBadge: { type: "boolean", default: true },
    withTrailing: { type: "boolean", default: true },
    showChevron: { type: "boolean", default: true },
    active: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-[28rem] max-w-full">
      <ListRow
        leading={
          a.withLeading ? (
            <div className="flex size-12 items-center justify-center rounded-lg bg-surface-sunken text-ink-muted">
              <Package className="size-5" />
            </div>
          ) : undefined
        }
        title={a.title as string}
        meta={a.meta as string}
        badges={
          a.withBadge ? (
            <Badge tone="info" size="sm">
              진행 중
            </Badge>
          ) : undefined
        }
        trailing={a.withTrailing ? <span className="font-semibold text-ink">$900</span> : undefined}
        showChevron={a.showChevron as boolean}
        active={a.active as boolean}
        className={className}
      />
    </div>
  ),
};
