import { BackLink } from "@/components/ui/back-link";
import type { Story } from "./types";

export const backLinkStory: Story = {
  slug: "back-link",
  name: "BackLink",
  componentName: "BackLink",
  childrenKey: "children",
  controls: {
    children: { type: "text", default: "대시보드로" },
  },
  render: (a, className) => (
    <BackLink href="#" className={className}>
      {a.children as string}
    </BackLink>
  ),
};
