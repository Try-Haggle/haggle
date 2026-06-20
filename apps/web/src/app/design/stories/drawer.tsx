import type { DrawerProps } from "@/components/ui/drawer";
import { DrawerDemo } from "./drawer-demo";
import type { Story } from "./types";

export const drawerStory: Story = {
  slug: "drawer",
  name: "Drawer",
  componentName: "Drawer",
  controls: {
    title: { type: "text", default: "필터" },
    side: { type: "select", options: ["right", "left", "bottom"], default: "right" },
  },
  render: (a) => <DrawerDemo side={a.side as DrawerProps["side"]} title={a.title as string} />,
};
