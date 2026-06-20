import { TrendingUp } from "lucide-react";
import { StatTile, type StatTileProps } from "@/components/ui/stat-tile";
import type { Story } from "./types";

export const statTileStory: Story = {
  slug: "stat-tile",
  name: "StatTile",
  componentName: "StatTile",
  controls: {
    label: { type: "text", default: "총 절약액" },
    value: { type: "text", default: "$1,840" },
    sub: { type: "text", default: "지난 30일" },
    tone: {
      type: "select",
      options: ["default", "accent", "success", "warning", "error", "info"],
      default: "success",
    },
    size: { type: "select", options: ["sm", "md"], default: "md" },
    align: { type: "select", options: ["left", "center"], default: "left" },
    withIcon: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-48">
      <StatTile
        label={a.label as string}
        value={a.value as string}
        sub={a.sub as string}
        tone={a.tone as StatTileProps["tone"]}
        size={a.size as StatTileProps["size"]}
        align={a.align as StatTileProps["align"]}
        icon={a.withIcon ? <TrendingUp className="size-4" /> : undefined}
        className={className}
      />
    </div>
  ),
};
