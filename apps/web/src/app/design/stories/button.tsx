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
      options: ["primary", "secondary", "ink", "ghost", "grad-gold", "grad-navy"],
      default: "primary",
    },
    size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    disabled: { type: "boolean", default: false },
    children: { type: "text", default: "협상 시작하기" },
  },
  render: (a, className) => (
    <Button
      variant={a.variant as ButtonProps["variant"]}
      size={a.size as ButtonProps["size"]}
      disabled={a.disabled as boolean}
      className={className}
    >
      {a.children as string}
    </Button>
  ),
};
