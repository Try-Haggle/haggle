import { alertStory } from "./alert";
import { badgeStory } from "./badge";
import { buttonStory } from "./button";
import { cardStory } from "./card";
import { emptyStateStory } from "./empty-state";
import { inputStory } from "./input";
import { listRowStory } from "./list-row";
import { selectStory } from "./select";
import { statTileStory } from "./stat-tile";
import { textareaStory } from "./textarea";
import type { Story, StoryArgs } from "./types";

/** Add a component to the catalog by appending its story here. */
export const stories: Story[] = [
  buttonStory,
  badgeStory,
  inputStory,
  textareaStory,
  selectStory,
  alertStory,
  cardStory,
  emptyStateStory,
  statTileStory,
  listRowStory,
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
