import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import type { Story } from "./types";

export const emptyStateStory: Story = {
  slug: "empty-state",
  name: "EmptyState",
  componentName: "EmptyState",
  controls: {
    title: { type: "text", default: "아직 협상이 없어요" },
    description: { type: "text", default: "리스팅을 둘러보고 첫 협상을 시작해보세요." },
    size: { type: "select", options: ["sm", "md"], default: "md" },
    padding: { type: "select", options: ["none", "sm", "md", "lg"], default: "md" },
    bordered: { type: "boolean", default: true },
    dashed: { type: "boolean", default: false },
    withIcon: { type: "boolean", default: true },
    withAction: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <EmptyState
        icon={a.withIcon ? <Search className="size-5" /> : undefined}
        title={a.title as string}
        description={a.description as string}
        size={a.size as EmptyStateProps["size"]}
        padding={a.padding as EmptyStateProps["padding"]}
        bordered={a.bordered as boolean}
        dashed={a.dashed as boolean}
        action={a.withAction ? <Button size="sm">둘러보기</Button> : undefined}
        className={className}
      />
    </div>
  ),
};
