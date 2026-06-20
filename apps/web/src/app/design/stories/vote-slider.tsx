import type { Story } from "./types";
import { VoteSliderDemo } from "./vote-slider-demo";

export const voteSliderStory: Story = {
  slug: "vote-slider",
  name: "VoteSlider",
  componentName: "VoteSlider",
  controls: {
    withAmount: { type: "boolean", default: true },
  },
  render: (a) => (
    <div className="w-96 max-w-full">
      <VoteSliderDemo withAmount={a.withAmount as boolean} />
    </div>
  ),
};
