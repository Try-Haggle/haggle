import { Switch, type SwitchProps } from "@/components/ui/switch";
import type { Story } from "./types";

export const switchStory: Story = {
  slug: "switch",
  name: "Switch",
  componentName: "Switch",
  controls: {
    checked: { type: "boolean", default: true },
    size: { type: "select", options: ["sm", "md"], default: "md" },
    disabled: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <Switch
      checked={a.checked as boolean}
      size={a.size as SwitchProps["size"]}
      disabled={a.disabled as boolean}
      aria-label="토글"
      className={className}
    />
  ),
};
