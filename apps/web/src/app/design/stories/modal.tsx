import type { ModalProps } from "@/components/ui/modal";
import { ModalDemo } from "./modal-demo";
import type { Story } from "./types";

export const modalStory: Story = {
  slug: "modal",
  name: "Modal",
  componentName: "Modal",
  controls: {
    title: { type: "text", default: "협상 시작" },
    size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    withFooter: { type: "boolean", default: true },
  },
  render: (a) => (
    <ModalDemo
      title={a.title as string}
      size={a.size as ModalProps["size"]}
      withFooter={a.withFooter as boolean}
    />
  ),
};
