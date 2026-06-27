import { Checkbox } from "@/components/ui/checkbox";
import type { Story } from "./types";

export const checkboxStory: Story = {
  slug: "checkbox",
  name: "Checkbox",
  componentName: "Checkbox",
  controls: {
    label: { type: "text", default: "이용약관에 동의합니다" },
    defaultChecked: { type: "boolean", default: true },
    disabled: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <Checkbox
      label={a.label as string}
      defaultChecked={a.defaultChecked as boolean}
      disabled={a.disabled as boolean}
      className={className}
    />
  ),
};
