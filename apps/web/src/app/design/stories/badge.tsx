import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { Story } from "./types";

export const badgeStory: Story = {
  slug: "badge",
  name: "Badge",
  componentName: "Badge",
  childrenKey: "children",
  controls: {
    tone: {
      type: "select",
      options: ["gold", "success", "info", "warning", "error", "neutral"],
      default: "gold",
    },
    size: { type: "select", options: ["sm", "md"], default: "md" },
    dot: { type: "boolean", default: false },
    children: { type: "text", default: "베타 출시" },
  },
  render: (a, className) => (
    <Badge
      tone={a.tone as BadgeProps["tone"]}
      size={a.size as BadgeProps["size"]}
      dot={a.dot as boolean}
      className={className}
    >
      {a.children as string}
    </Badge>
  ),
};
