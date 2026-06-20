import { Textarea, type TextareaProps } from "@/components/ui/input";
import type { Story } from "./types";

export const textareaStory: Story = {
  slug: "textarea",
  name: "Textarea",
  componentName: "Textarea",
  controls: {
    placeholder: { type: "text", default: "협상 배경을 적어주세요…" },
    invalid: { type: "boolean", default: false },
    disabled: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-80">
      <Textarea
        placeholder={a.placeholder as string}
        invalid={a.invalid as TextareaProps["invalid"]}
        disabled={a.disabled as boolean}
        className={className}
      />
    </div>
  ),
};
