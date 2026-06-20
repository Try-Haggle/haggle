import { Chip, type ChipProps } from "@/components/ui/chip";
import type { Story } from "./types";

export const chipStory: Story = {
  slug: "chip",
  name: "Chip",
  componentName: "Chip",
  childrenKey: "children",
  controls: {
    selected: { type: "boolean", default: false },
    size: { type: "select", options: ["sm", "md"], default: "md" },
    children: { type: "text", default: "전자기기" },
  },
  render: (a, className) => (
    <Chip selected={a.selected as boolean} size={a.size as ChipProps["size"]} className={className}>
      {a.children as string}
    </Chip>
  ),
};
