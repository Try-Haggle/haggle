import { EvidenceCard, type EvidenceCardProps } from "@/components/ui/evidence-card";
import type { Story } from "./types";

export const evidenceCardStory: Story = {
  slug: "evidence-card",
  name: "EvidenceCard",
  componentName: "EvidenceCard",
  controls: {
    type: { type: "text", default: "사진 증거" },
    submittedBy: { type: "text", default: "구매자 · tryhaggle" },
    time: { type: "text", default: "2일 전" },
    side: { type: "select", options: ["buyer", "seller"], default: "buyer" },
    withHash: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <EvidenceCard
        type={a.type as string}
        submittedBy={a.submittedBy as string}
        time={a.time as string}
        side={a.side as EvidenceCardProps["side"]}
        hash={a.withHash ? "0x9f…3a21" : undefined}
        className={className}
      >
        배터리 성능이 표기(89%)와 다르게 76%로 측정됨. EXIF 메타데이터 첨부.
      </EvidenceCard>
    </div>
  ),
};
