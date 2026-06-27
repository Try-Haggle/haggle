import { Button, type ButtonProps } from "@/components/ui/button";
import type { Story } from "./types";

export const buttonStory: Story = {
  slug: "button",
  name: "Button",
  componentName: "Button",
  childrenKey: "children",
  controls: {
    variant: {
      type: "select",
      options: [
        "primary",
        "secondary",
        "ink",
        "ghost",
        "destructive",
        "success",
        "grad-gold",
        "grad-navy",
      ],
      default: "primary",
    },
    size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    loading: { type: "boolean", default: false },
    fullWidth: { type: "boolean", default: false },
    disabled: { type: "boolean", default: false },
    children: { type: "text", default: "협상 시작하기" },
  },
  render: (a, className) => (
    <Button
      variant={a.variant as ButtonProps["variant"]}
      size={a.size as ButtonProps["size"]}
      loading={a.loading as boolean}
      fullWidth={a.fullWidth as boolean}
      disabled={a.disabled as boolean}
      className={className}
    >
      {a.children as string}
    </Button>
  ),
};
