import { activityFeedStory } from "./activity-feed";
import { alertStory } from "./alert";
import { avatarStory } from "./avatar";
import { backLinkStory } from "./back-link";
import { badgeStory } from "./badge";
import { buttonStory } from "./button";
import { cardStory } from "./card";
import { carouselStory } from "./carousel";
import { chatBubbleStory } from "./chat-bubble";
import { checkboxStory } from "./checkbox";
import { chipStory } from "./chip";
import { copyButtonStory } from "./copy-button";
import { disclosureStory } from "./disclosure";
import { drawerStory } from "./drawer";
import { dropdownMenuStory } from "./dropdown-menu";
import { dropzoneStory } from "./dropzone";
import { emptyStateStory } from "./empty-state";
import { evidenceCardStory } from "./evidence-card";
import { iconButtonStory } from "./icon-button";
import { inputStory } from "./input";
import { listRowStory } from "./list-row";
import { messageListStory } from "./message-list";
import { modalStory } from "./modal";
import { notificationItemStory } from "./notification-item";
import { pageHeaderStory } from "./page-header";
import { popoverStory } from "./popover";
import { positionPanelStory } from "./position-panel";
import { priceStory } from "./price";
import { progressBarStory } from "./progress-bar";
import { promoBannerStory } from "./promo-banner";
import { radarStory } from "./radar";
import { resultStateStory } from "./result-state";
import { sectionHeaderStory } from "./section-header";
import { selectStory } from "./select";
import { selectableOptionCardStory } from "./selectable-option-card";
import { skeletonStory } from "./skeleton";
import { sliderStory } from "./slider";
import { spinnerStory } from "./spinner";
import { statTileStory } from "./stat-tile";
import { stepperStory } from "./stepper";
import { switchStory } from "./switch";
import { tabsStory } from "./tabs";
import { tagInputStory } from "./tag-input";
import { textareaStory } from "./textarea";
import { tierBadgeStory } from "./tier-badge";
import type { Story, StoryArgs } from "./types";
import { voteSliderStory } from "./vote-slider";
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
  radarStory,
  carouselStory,
  chatBubbleStory,
  messageListStory,
  tierBadgeStory,
  activityFeedStory,
  notificationItemStory,
  promoBannerStory,
  resultStateStory,
  selectableOptionCardStory,
  evidenceCardStory,
  positionPanelStory,
  voteSliderStory,
  sliderStory,
  skeletonStory,
  copyButtonStory,
  disclosureStory,
  priceStory,
  tagInputStory,
  dropzoneStory,
];

export interface StoryGroup {
  label: string;
  slugs: string[];
}

/** Sidebar grouping for the catalog. Stories not listed here fall into "Other". */
export const storyGroups: StoryGroup[] = [
  { label: "Actions", slugs: ["button", "icon-button", "copy-button"] },
  {
    label: "Forms",
    slugs: [
      "input",
      "textarea",
      "select",
      "checkbox",
      "switch",
      "slider",
      "tag-input",
      "dropzone",
      "selectable-option-card",
    ],
  },
  { label: "Navigation", slugs: ["tabs", "stepper", "back-link"] },
  {
    label: "Data display",
    slugs: [
      "avatar",
      "badge",
      "chip",
      "tier-badge",
      "stat-tile",
      "list-row",
      "carousel",
      "activity-feed",
      "notification-item",
      "price",
    ],
  },
  {
    label: "Feedback",
    slugs: [
      "alert",
      "spinner",
      "skeleton",
      "progress-bar",
      "empty-state",
      "promo-banner",
      "result-state",
    ],
  },
  { label: "Layout & surfaces", slugs: ["card", "page-header", "section-header", "disclosure"] },
  { label: "Overlays", slugs: ["modal", "drawer", "popover", "dropdown-menu", "wizard-shell"] },
  { label: "Charts", slugs: ["radar"] },
  {
    label: "Domain",
    slugs: ["chat-bubble", "message-list", "position-panel", "evidence-card", "vote-slider"],
  },
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
