import { CreditCard } from "lucide-react";
import { SelectableOptionCard } from "@/components/ui/selectable-option-card";
import type { Story } from "./types";

export const selectableOptionCardStory: Story = {
  slug: "selectable-option-card",
  name: "SelectableOptionCard",
  componentName: "SelectableOptionCard",
  controls: {
    title: { type: "text", default: "카드 결제" },
    description: { type: "text", default: "Stripe Onramp · 수수료 3%" },
    selected: { type: "boolean", default: true },
    withIcon: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-80 max-w-full">
      <SelectableOptionCard
        title={a.title as string}
        description={a.description as string}
        selected={a.selected as boolean}
        icon={a.withIcon ? <CreditCard className="size-5" /> : undefined}
        className={className}
      />
    </div>
  ),
};
