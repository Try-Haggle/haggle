import { ActivityFeed } from "@/components/ui/activity-feed";
import type { Story } from "./types";

const EVENTS = [
  { id: "1", label: "주문 생성됨", time: "10:02", tone: "info" as const },
  { id: "2", label: "결제 승인", time: "10:03", tone: "success" as const, detail: "USDC 1,840" },
  { id: "3", label: "배송 시작", time: "12:20", tone: "default" as const },
  {
    id: "4",
    label: "분쟁 접수",
    time: "어제",
    tone: "warning" as const,
    detail: "배터리 상태 불일치",
  },
];

export const activityFeedStory: Story = {
  slug: "activity-feed",
  name: "ActivityFeed",
  componentName: "ActivityFeed",
  controls: {},
  render: (_a, className) => (
    <div className="w-80 max-w-full">
      <ActivityFeed events={EVENTS} className={className} />
    </div>
  ),
};
