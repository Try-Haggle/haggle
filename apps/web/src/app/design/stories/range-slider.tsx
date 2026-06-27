import { RangeSliderDemo } from "./range-slider-demo";
import type { Story } from "./types";

export const rangeSliderStory: Story = {
  slug: "range-slider",
  name: "Range Slider",
  componentName: "RangeSlider",
  controls: {
    step: { type: "select", options: ["1", "5", "10", "25"], default: "5" },
    disabled: { type: "boolean", default: false },
  },
  render: (a) => (
    <div className="w-80">
      <RangeSliderDemo step={Number(a.step)} disabled={a.disabled as boolean} />
    </div>
  ),
};
