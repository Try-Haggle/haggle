import { SliderDemo } from "./slider-demo";
import type { Story } from "./types";

export const sliderStory: Story = {
  slug: "slider",
  name: "Slider",
  componentName: "Slider",
  controls: {
    step: { type: "select", options: ["1", "5", "10", "25"], default: "5" },
    disabled: { type: "boolean", default: false },
  },
  render: (a) => (
    <div className="w-80">
      <SliderDemo step={Number(a.step)} disabled={a.disabled as boolean} />
    </div>
  ),
};
