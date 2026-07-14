import { Button } from "@/components/ui/button";
import { PromoBanner, type PromoBannerProps } from "@/components/ui/promo-banner";
import type { Story } from "./types";

export const promoBannerStory: Story = {
  slug: "promo-banner",
  name: "PromoBanner",
  componentName: "PromoBanner",
  controls: {
    title: { type: "text", default: "거래가 성사됐어요" },
    description: { type: "text", default: "계정을 만들면 협상 내역을 저장할 수 있어요." },
    tone: { type: "select", options: ["default", "success"], default: "success" },
    withAction: { type: "boolean", default: true },
    withClose: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-[34rem] max-w-full">
      <PromoBanner
        title={a.title as string}
        description={a.description as string}
        tone={a.tone as PromoBannerProps["tone"]}
        action={a.withAction ? <Button size="sm">계정 만들기</Button> : undefined}
        onClose={a.withClose ? () => {} : undefined}
        className={className}
      />
    </div>
  ),
};
