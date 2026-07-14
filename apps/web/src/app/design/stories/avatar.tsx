import { Avatar, type AvatarProps } from "@/components/ui/avatar";
import type { Story } from "./types";

export const avatarStory: Story = {
  slug: "avatar",
  name: "Avatar",
  componentName: "Avatar",
  controls: {
    name: { type: "text", default: "Jongwoo" },
    size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    withImage: { type: "boolean", default: false },
  },
  render: (a, className) => (
    <Avatar
      name={a.name as string}
      src={a.withImage ? "https://i.pravatar.cc/128" : undefined}
      size={a.size as AvatarProps["size"]}
      className={className}
    />
  ),
};
