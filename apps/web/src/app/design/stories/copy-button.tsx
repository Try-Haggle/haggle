import { CopyButton } from "@/components/ui/copy-button";
import type { Story } from "./types";

export const copyButtonStory: Story = {
  slug: "copy-button",
  name: "CopyButton",
  componentName: "CopyButton",
  controls: {
    value: { type: "text", default: "https://tryhaggle.ai/l/iHLzB-DB" },
    label: { type: "text", default: "링크 복사" },
    size: { type: "select", options: ["sm", "md"], default: "md" },
  },
  render: (a, className) => (
    <CopyButton
      value={a.value as string}
      label={a.label as string}
      size={a.size as "sm" | "md"}
      className={className}
    />
  ),
};
