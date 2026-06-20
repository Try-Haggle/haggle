import { LogOut, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { PopoverProps } from "@/components/ui/popover";
import type { Story } from "./types";

export const dropdownMenuStory: Story = {
  slug: "dropdown-menu",
  name: "DropdownMenu",
  componentName: "DropdownMenu",
  controls: {
    align: { type: "select", options: ["left", "right"], default: "left" },
  },
  render: (a) => (
    <DropdownMenu
      align={a.align as PopoverProps["align"]}
      trigger={<Button variant="secondary">계정</Button>}
    >
      <DropdownMenuItem icon={<User className="size-4" />}>프로필</DropdownMenuItem>
      <DropdownMenuItem icon={<Settings className="size-4" />}>설정</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon={<LogOut className="size-4" />} destructive>
        로그아웃
      </DropdownMenuItem>
    </DropdownMenu>
  ),
};
