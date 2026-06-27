import { TierBadge, type TierBadgeProps } from "@/components/ui/tier-badge";
import type { Story } from "./types";

export const tierBadgeStory: Story = {
  slug: "tier-badge",
  name: "TierBadge",
  componentName: "TierBadge",
  childrenKey: "tier",
  controls: {
    tier: { type: "text", default: "GOLD" },
    palette: { type: "select", options: ["rank", "rarity"], default: "rank" },
    size: { type: "select", options: ["sm", "md"], default: "md" },
  },
  render: (a, className) => (
    <TierBadge
      tier={a.tier as string}
      palette={a.palette as TierBadgeProps["palette"]}
      size={a.size as TierBadgeProps["size"]}
      className={className}
    />
  ),
};
