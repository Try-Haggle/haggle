import { Select } from "@/components/ui/input";
import type { Story } from "./types";

export const selectStory: Story = {
  slug: "select",
  name: "Select",
  componentName: "Select",
  controls: {
    invalid: { type: "boolean", default: false },
    disabled: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-72">
      <Select
        invalid={a.invalid as boolean}
        disabled={a.disabled as boolean}
        className={className}
        defaultValue="buyer"
      >
        <option value="buyer">구매자 에이전트</option>
        <option value="seller">판매자 에이전트</option>
        <option value="reviewer">리뷰어</option>
      </Select>
    </div>
  ),
};
