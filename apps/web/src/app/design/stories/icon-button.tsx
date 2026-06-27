import { Settings } from "lucide-react";
import { IconButton, type IconButtonProps } from "@/components/ui/icon-button";
import type { Story } from "./types";

export const iconButtonStory: Story = {
  slug: "icon-button",
  name: "IconButton",
  componentName: "IconButton",
  controls: {
    variant: { type: "select", options: ["ghost", "outline", "solid"], default: "ghost" },
    size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    shape: { type: "select", options: ["square", "circle"], default: "square" },
    disabled: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <IconButton
      aria-label="설정"
      variant={a.variant as IconButtonProps["variant"]}
      size={a.size as IconButtonProps["size"]}
      shape={a.shape as IconButtonProps["shape"]}
      disabled={a.disabled as boolean}
      className={className}
    >
      <Settings className="size-[1.1em]" />
    </IconButton>
  ),
};
