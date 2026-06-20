import { Price, type PriceProps } from "@/components/ui/price";
import type { Story } from "./types";

export const priceStory: Story = {
  slug: "price",
  name: "Price",
  componentName: "Price",
  controls: {
    amount: { type: "text", default: "850" },
    minor: { type: "boolean", default: false },
    size: { type: "select", options: ["sm", "md", "lg", "xl"], default: "lg" },
    tone: {
      type: "select",
      options: ["default", "accent", "success", "muted"],
      default: "default",
    },
  },
  render: (a, className) => (
    <Price
      amount={Number(a.amount) || 0}
      minor={a.minor as boolean}
      size={a.size as PriceProps["size"]}
      tone={a.tone as PriceProps["tone"]}
      className={className}
    />
  ),
};
