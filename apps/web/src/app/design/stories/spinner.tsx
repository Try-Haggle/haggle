import { Spinner, type SpinnerProps } from "@/components/ui/spinner";
import type { Story } from "./types";

export const spinnerStory: Story = {
  slug: "spinner",
  name: "Spinner",
  componentName: "Spinner",
  controls: {
    size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
  },
  render: (a, className) => (
    <Spinner size={a.size as SpinnerProps["size"]} className={className ?? "text-action-primary"} />
  ),
};
