import { Alert, type AlertProps } from "@/components/ui/alert";
import type { Story } from "./types";

export const alertStory: Story = {
  slug: "alert",
  name: "Alert",
  componentName: "Alert",
  childrenKey: "children",
  controls: {
    tone: {
      type: "select",
      options: ["success", "info", "warning", "error"],
      default: "info",
    },
    title: { type: "text", default: "유사 사례 12건" },
    children: { type: "text", default: "이번 협상과 비슷한 상황을 분석해드렸어요." },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <Alert tone={a.tone as AlertProps["tone"]} title={a.title as string} className={className}>
        {a.children as string}
      </Alert>
    </div>
  ),
};
