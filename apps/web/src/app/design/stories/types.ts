import type { ReactNode } from "react";

export type Control =
  | { type: "select"; options: readonly string[]; default: string }
  | { type: "boolean"; default: boolean }
  | { type: "text"; default: string };

export type StoryArgs = Record<string, string | boolean>;

export interface Story {
  slug: string;
  name: string;
  /** Component name used when generating the JSX snippet. */
  componentName: string;
  /** Which control feeds the element's children (rendered as inner text in the snippet). */
  childrenKey?: string;
  controls: Record<string, Control>;
  render: (args: StoryArgs, className?: string) => ReactNode;
}
