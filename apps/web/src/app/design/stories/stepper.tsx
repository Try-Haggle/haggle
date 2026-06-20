import { Stepper } from "@/components/ui/stepper";
import type { Story } from "./types";

const STEPS = ["기본 정보", "사진", "가격", "검토"];

export const stepperStory: Story = {
  slug: "stepper",
  name: "Stepper",
  componentName: "Stepper",
  controls: {
    current: { type: "select", options: ["0", "1", "2", "3"], default: "1" },
  },
  render: (a, className) => (
    <div className="w-[34rem] max-w-full">
      <Stepper steps={STEPS} current={Number(a.current)} className={className} />
    </div>
  ),
};
