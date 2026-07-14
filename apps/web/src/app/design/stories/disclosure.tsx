import { Disclosure } from "@/components/ui/disclosure";
import type { Story } from "./types";

export const disclosureStory: Story = {
  slug: "disclosure",
  name: "Disclosure",
  componentName: "Disclosure",
  controls: {
    title: { type: "text", default: "선례 케이스 보기" },
    defaultOpen: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <Disclosure
        title={a.title as string}
        defaultOpen={a.defaultOpen as boolean}
        className={className}
      >
        비슷한 분쟁 3건에서 모두 부분 환불(평균 32%)로 합의됐습니다.
      </Disclosure>
    </div>
  ),
};
