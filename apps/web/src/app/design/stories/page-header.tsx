import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { Story } from "./types";

export const pageHeaderStory: Story = {
  slug: "page-header",
  name: "PageHeader",
  componentName: "PageHeader",
  controls: {
    title: { type: "text", default: "구매자 대시보드" },
    subtitle: { type: "text", default: "리스팅을 둘러보고 협상을 추적하세요" },
    withIcon: { type: "boolean", default: true },
    withBack: { type: "boolean", default: false },
    withAction: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-[40rem] max-w-full">
      <PageHeader
        icon={a.withIcon ? <ShoppingCart className="size-6" /> : undefined}
        title={a.title as string}
        subtitle={a.subtitle as string}
        backHref={a.withBack ? "#" : undefined}
        actions={a.withAction ? <Button size="sm">새 리스팅</Button> : undefined}
        className={className}
      />
    </div>
  ),
};
