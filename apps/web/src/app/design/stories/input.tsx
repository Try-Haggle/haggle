import { Input } from "@/components/ui/input";
import type { Story } from "./types";

export const inputStory: Story = {
  slug: "input",
  name: "Input",
  componentName: "Input",
  controls: {
    placeholder: { type: "text", default: "예) 6,000만원" },
    invalid: { type: "boolean", default: false },
    disabled: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-72">
      <Input
        placeholder={a.placeholder as string}
        invalid={a.invalid as boolean}
        disabled={a.disabled as boolean}
        className={className}
      />
    </div>
  ),
};
