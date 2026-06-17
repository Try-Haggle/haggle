import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, type CardProps } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { Story } from "./types";

export const cardStory: Story = {
  slug: "card",
  name: "Card",
  componentName: "Card",
  controls: {
    tone: { type: "select", options: ["default", "sunken", "premium"], default: "default" },
    padding: { type: "select", options: ["none", "sm", "md"], default: "md" },
  },
  render: (a, className) => {
    const premium = a.tone === "premium";
    return (
      <Card
        tone={a.tone as CardProps["tone"]}
        padding={a.padding as CardProps["padding"]}
        className={cn("w-80", className)}
      >
        <Badge tone={premium ? "gold" : "info"} dot={!premium}>
          {premium ? "✨ PREMIUM" : "진행 중인 협상"}
        </Badge>
        <h3 className={`mt-4 font-display text-2xl ${premium ? "" : "text-ink"}`}>
          연봉 인상 시나리오
        </h3>
        <p className={`mt-1 text-sm ${premium ? "text-on-accent/75" : "text-ink-secondary"}`}>
          2025년 평가 결과를 근거로 한 협상 카드.
        </p>
        {!premium && <Button className="mt-5 w-full">시나리오 열기</Button>}
      </Card>
    );
  },
};
