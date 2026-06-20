import { Radar } from "@/components/ui/radar";
import type { Story } from "./types";

const AXES = [
  { key: "price", label: "가격", value: 0.8 },
  { key: "speed", label: "속도", value: 0.55 },
  { key: "trust", label: "신뢰", value: 0.7 },
  { key: "risk", label: "리스크", value: 0.4 },
  { key: "info", label: "정보", value: 0.65 },
  { key: "relation", label: "관계", value: 0.5 },
];

export const radarStory: Story = {
  slug: "radar",
  name: "Radar",
  componentName: "Radar",
  controls: {
    showLabels: { type: "boolean", default: true },
    levels: { type: "select", options: ["3", "4", "5"], default: "4" },
  },
  render: (a, className) => (
    <Radar
      axes={AXES}
      showLabels={a.showLabels as boolean}
      levels={Number(a.levels)}
      size={200}
      className={className}
    />
  ),
};
