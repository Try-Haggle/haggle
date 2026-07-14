import { Radar } from "@/components/ui/radar";
import type { Story } from "./types";

// A pool of axes — the story slices the first N so the dynamic axis count
// (any polygon, e.g. 4-axis weights vs 8-axis strategy) is demonstrable.
const AXIS_POOL = [
  { key: "price", label: "가격", value: 0.8 },
  { key: "speed", label: "속도", value: 0.55 },
  { key: "trust", label: "신뢰", value: 0.7 },
  { key: "risk", label: "리스크", value: 0.4 },
  { key: "info", label: "정보", value: 0.65 },
  { key: "relation", label: "관계", value: 0.5 },
  { key: "alpha", label: "α", value: 0.6 },
  { key: "beta", label: "β", value: 0.35 },
  { key: "target", label: "uA", value: 0.75 },
];

export const radarStory: Story = {
  slug: "radar",
  name: "Radar",
  componentName: "Radar",
  controls: {
    axisCount: { type: "select", options: ["4", "5", "6", "7", "8", "9"], default: "6" },
    showLabels: { type: "boolean", default: true },
    levels: { type: "select", options: ["3", "4", "5"], default: "4" },
  },
  render: (a, className) => (
    <Radar
      axes={AXIS_POOL.slice(0, Number(a.axisCount))}
      showLabels={a.showLabels as boolean}
      levels={Number(a.levels)}
      size={200}
      className={className}
    />
  ),
};
