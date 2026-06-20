import { PositionPanel, type PositionPanelProps } from "@/components/ui/position-panel";
import type { Story } from "./types";

export const positionPanelStory: Story = {
  slug: "position-panel",
  name: "PositionPanel",
  componentName: "PositionPanel",
  controls: {
    side: { type: "select", options: ["buyer", "seller"], default: "buyer" },
    label: { type: "text", default: "" },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <PositionPanel
        side={a.side as PositionPanelProps["side"]}
        label={(a.label as string) || undefined}
        className={className}
      >
        제품 설명과 실제 상태가 다릅니다. 환불 또는 부분 보상을 요청합니다.
      </PositionPanel>
    </div>
  ),
};
