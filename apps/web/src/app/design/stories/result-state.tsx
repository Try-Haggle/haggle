import { Button } from "@/components/ui/button";
import { ResultState, type ResultStateProps } from "@/components/ui/result-state";
import type { Story } from "./types";

export const resultStateStory: Story = {
  slug: "result-state",
  name: "ResultState",
  componentName: "ResultState",
  controls: {
    tone: { type: "select", options: ["success", "error", "info", "neutral"], default: "success" },
    title: { type: "text", default: "결제 완료" },
    description: { type: "text", default: "판매자에게 USDC가 전송됐어요." },
    withAction: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <ResultState
        tone={a.tone as ResultStateProps["tone"]}
        title={a.title as string}
        description={a.description as string}
        action={a.withAction ? <Button size="sm">주문 보기</Button> : undefined}
        className={className}
      />
    </div>
  ),
};
