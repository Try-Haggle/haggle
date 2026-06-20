import { TagInputDemo } from "./tag-input-demo";
import type { Story } from "./types";

export const tagInputStory: Story = {
  slug: "tag-input",
  name: "TagInput",
  componentName: "TagInput",
  controls: {},
  render: () => (
    <div className="w-96 max-w-full">
      <TagInputDemo />
    </div>
  ),
};
