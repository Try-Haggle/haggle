import { NotificationItem } from "@/components/ui/notification-item";
import type { Story } from "./types";

export const notificationItemStory: Story = {
  slug: "notification-item",
  name: "NotificationItem",
  componentName: "NotificationItem",
  controls: {
    title: { type: "text", default: "Agent Sage가 협상을 마쳤어요" },
    time: { type: "text", default: "5분 전" },
    read: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <NotificationItem
        title={a.title as string}
        time={a.time as string}
        read={a.read as boolean}
        className={className}
      />
    </div>
  ),
};
