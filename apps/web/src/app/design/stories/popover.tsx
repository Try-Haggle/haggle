import { Button } from "@/components/ui/button";
import { Popover, type PopoverProps } from "@/components/ui/popover";
import type { Story } from "./types";

export const popoverStory: Story = {
  slug: "popover",
  name: "Popover",
  componentName: "Popover",
  controls: {
    align: { type: "select", options: ["left", "right"], default: "left" },
  },
  render: (a) => (
    <Popover
      align={a.align as PopoverProps["align"]}
      trigger={<Button variant="secondary">옵션 열기</Button>}
      panelClassName="w-64"
    >
      <p className="px-1 py-1 text-ink-secondary text-sm">
        아무 내용이나 담을 수 있는 앵커드 패널입니다. 바깥 클릭·Escape로 닫힙니다.
      </p>
    </Popover>
  ),
};
