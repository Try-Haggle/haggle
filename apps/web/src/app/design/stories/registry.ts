import { alertStory } from "./alert";
import { avatarStory } from "./avatar";
import { backLinkStory } from "./back-link";
import { badgeStory } from "./badge";
import { buttonStory } from "./button";
import { cardStory } from "./card";
import { checkboxStory } from "./checkbox";
import { chipStory } from "./chip";
import { drawerStory } from "./drawer";
import { dropdownMenuStory } from "./dropdown-menu";
import { emptyStateStory } from "./empty-state";
import { iconButtonStory } from "./icon-button";
import { inputStory } from "./input";
import { listRowStory } from "./list-row";
import { modalStory } from "./modal";
import { pageHeaderStory } from "./page-header";
import { popoverStory } from "./popover";
import { progressBarStory } from "./progress-bar";
import { sectionHeaderStory } from "./section-header";
import { selectStory } from "./select";
import { spinnerStory } from "./spinner";
import { statTileStory } from "./stat-tile";
import { stepperStory } from "./stepper";
import { switchStory } from "./switch";
import { tabsStory } from "./tabs";
import { textareaStory } from "./textarea";
import type { Story, StoryArgs } from "./types";
import { wizardShellStory } from "./wizard-shell";

/** Add a component to the catalog by appending its story here. */
export const stories: Story[] = [
  buttonStory,
  iconButtonStory,
  badgeStory,
  chipStory,
  inputStory,
  textareaStory,
  selectStory,
  checkboxStory,
  switchStory,
  alertStory,
  cardStory,
  emptyStateStory,
  statTileStory,
  listRowStory,
  avatarStory,
  spinnerStory,
  pageHeaderStory,
  sectionHeaderStory,
  backLinkStory,
  tabsStory,
  progressBarStory,
  stepperStory,
  modalStory,
  drawerStory,
  popoverStory,
  dropdownMenuStory,
  wizardShellStory,
];

export interface StoryGroup {
  label: string;
  slugs: string[];
}

/** Sidebar grouping for the catalog. Stories not listed here fall into "Other". */
export const storyGroups: StoryGroup[] = [
  { label: "Actions", slugs: ["button", "icon-button"] },
  { label: "Forms", slugs: ["input", "textarea", "select", "checkbox", "switch"] },
  { label: "Navigation", slugs: ["tabs", "stepper", "back-link"] },
  { label: "Data display", slugs: ["avatar", "badge", "chip", "stat-tile", "list-row"] },
  { label: "Feedback", slugs: ["alert", "spinner", "progress-bar", "empty-state"] },
  { label: "Layout & surfaces", slugs: ["card", "page-header", "section-header"] },
  { label: "Overlays", slugs: ["modal", "drawer", "popover", "dropdown-menu", "wizard-shell"] },
];

export function getStory(slug: string): Story | undefined {
  return stories.find((s) => s.slug === slug);
}

export function defaultArgs(story: Story): StoryArgs {
  const out: StoryArgs = {};
  for (const [key, control] of Object.entries(story.controls)) {
    out[key] = control.default;
  }
  return out;
}
