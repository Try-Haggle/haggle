import { ProgressBar, type ProgressBarProps } from "@/components/ui/progress-bar";
import type { Story } from "./types";

export const progressBarStory: Story = {
  slug: "progress-bar",
  name: "ProgressBar",
  componentName: "ProgressBar",
  controls: {
    value: { type: "text", default: "65" },
    tone: {
      type: "select",
      options: ["accent", "success", "warning", "error", "info", "threshold"],
      default: "accent",
    },
    size: { type: "select", options: ["sm", "md"], default: "md" },
    label: { type: "text", default: "XP 진행도" },
    showValue: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-80">
      <ProgressBar
        value={Number(a.value) || 0}
        tone={a.tone as ProgressBarProps["tone"]}
        size={a.size as ProgressBarProps["size"]}
        label={a.label as string}
        showValue={a.showValue as boolean}
        className={className}
      />
    </div>
  ),
};
