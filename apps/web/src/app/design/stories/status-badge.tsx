import { StatusBadge, type StatusBadgeProps } from "@/components/ui/status-badge";
import type { Story } from "./types";

export const statusBadgeStory: Story = {
  slug: "status-badge",
  name: "StatusBadge",
  componentName: "StatusBadge",
  controls: {
    domain: { type: "select", options: ["order", "dispute"], default: "order" },
    status: {
      type: "select",
      options: [
        "PAID",
        "PAYMENT_PENDING",
        "IN_DISPUTE",
        "DELIVERED",
        "CLOSED",
        "OPEN",
        "UNDER_REVIEW",
        "WAITING_FOR_BUYER",
        "RESOLVED_BUYER_FAVOR",
      ],
      default: "PAID",
    },
    size: { type: "select", options: ["sm", "md"], default: "md" },
  },
  render: (a, className) => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge
        domain={a.domain as StatusBadgeProps["domain"]}
        status={a.status as string}
        size={a.size as StatusBadgeProps["size"]}
        className={className}
      />
    </div>
  ),
};
