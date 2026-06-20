import { Tabs, type TabsProps } from "@/components/ui/tabs";
import type { Story } from "./types";

const ITEMS = [
  { key: "active", label: "진행 중", count: 3 },
  { key: "voted", label: "투표함", count: 8 },
  { key: "decided", label: "완료" },
];

export const tabsStory: Story = {
  slug: "tabs",
  name: "Tabs",
  componentName: "Tabs",
  controls: {
    value: { type: "select", options: ["active", "voted", "decided"], default: "active" },
    variant: { type: "select", options: ["segmented", "underline"], default: "segmented" },
    fullWidth: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-[28rem] max-w-full">
      <Tabs
        items={ITEMS}
        value={a.value as string}
        variant={a.variant as TabsProps["variant"]}
        fullWidth={a.fullWidth as boolean}
        className={className}
      />
    </div>
  ),
};
