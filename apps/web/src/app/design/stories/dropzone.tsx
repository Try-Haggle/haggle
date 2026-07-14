import { DropzoneDemo } from "./dropzone-demo";
import type { Story } from "./types";

export const dropzoneStory: Story = {
  slug: "dropzone",
  name: "Dropzone",
  componentName: "Dropzone",
  controls: {},
  render: () => (
    <div className="w-96 max-w-full">
      <DropzoneDemo />
    </div>
  ),
};
