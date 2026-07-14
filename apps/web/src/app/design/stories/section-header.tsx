import { SectionHeader, type SectionHeaderProps } from "@/components/ui/section-header";
import type { Story } from "./types";

export const sectionHeaderStory: Story = {
  slug: "section-header",
  name: "SectionHeader",
  componentName: "SectionHeader",
  controls: {
    title: { type: "text", default: "진행 중인 협상" },
    variant: { type: "select", options: ["section", "eyebrow"], default: "section" },
    withCount: { type: "boolean", default: true },
    withAction: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-[34rem] max-w-full">
      <SectionHeader
        title={a.title as string}
        variant={a.variant as SectionHeaderProps["variant"]}
        count={a.withCount ? 3 : undefined}
        action={
          a.withAction ? (
            <button type="button" className="text-action-primary text-sm hover:underline">
              전체 보기 →
            </button>
          ) : undefined
        }
        className={className}
      />
    </div>
  ),
};
