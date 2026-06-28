import { NavTab, type NavTabProps } from "@/components/ui/nav-tab";
import type { Story } from "./types";

const ICON = (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const navTabStory: Story = {
  slug: "nav-tab",
  name: "NavTab",
  componentName: "NavTab",
  controls: {
    variant: { type: "select", options: ["underline", "stacked"], default: "underline" },
    active: { type: "boolean", default: true },
    badge: { type: "boolean", default: false },
  },
  render: (a, className) => {
    const variant = a.variant as NavTabProps["variant"];
    return (
      <div className="flex items-center gap-4">
        <NavTab
          href="#"
          label="Profile"
          variant={variant}
          active={a.active as boolean}
          badge={a.badge as boolean}
          icon={variant === "stacked" ? ICON : undefined}
          className={className}
        />
        <NavTab
          href="#"
          label="Agents"
          variant={variant}
          icon={variant === "stacked" ? ICON : undefined}
        />
      </div>
    );
  },
};
