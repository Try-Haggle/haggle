"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { defaultArgs, getStory } from "./stories/registry";
import type { Story, StoryArgs } from "./stories/types";

/**
 * Sanctioned `className` overrides (the escape hatch). Layout / spacing /
 * shape / effect only — NO color utilities, so the design tokens stay the
 * single source of color. See components/ui/README.md.
 */
const CLASSNAME_GROUPS: { label: string; options: string[] }[] = [
  { label: "Width", options: ["w-full", "w-64", "w-40"] },
  { label: "Spacing", options: ["mt-4", "mb-4", "mx-auto"] },
  { label: "Layout", options: ["flex-1", "block"] },
  { label: "Shape · Effect", options: ["rounded-full", "shadow-card", "opacity-70"] },
];

function buildSnippet(story: Story, args: StoryArgs, overrideClass: string): string {
  const attrs = Object.entries(story.controls)
    .filter(([key]) => key !== story.childrenKey)
    .map(([key, control]) => {
      const value = args[key];
      if (control.type === "boolean") return value ? key : null;
      return `${key}="${value}"`;
    })
    .filter((x): x is string => Boolean(x));

  if (overrideClass) attrs.push(`className="${overrideClass}"`);

  const open = `<${story.componentName}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  const children = story.childrenKey ? String(args[story.childrenKey] ?? "") : "";
  return children ? `${open}>${children}</${story.componentName}>` : `${open} />`;
}

export function Playground({ slug }: { slug: string }) {
  const story = getStory(slug);
  const [args, setArgs] = useState<StoryArgs>(() => (story ? defaultArgs(story) : {}));
  const [overrides, setOverrides] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const overrideClass = overrides.join(" ");
  const code = useMemo(
    () => (story ? buildSnippet(story, args, overrideClass) : ""),
    [story, args, overrideClass],
  );

  if (!story) return null;

  const set = (key: string, value: string | boolean) =>
    setArgs((prev) => ({ ...prev, [key]: value }));

  const toggleOverride = (cls: string) =>
    setOverrides((prev) => (prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]));

  const copy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const chip = (active: boolean) =>
    cn(
      "rounded-lg border px-2.5 py-1 text-xs transition",
      active
        ? "border-action-primary bg-action-primary text-on-accent"
        : "border-line text-ink-secondary hover:border-line-strong",
    );

  return (
    <div>
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-action-primary">
          Component
        </p>
        <h1 className="font-display text-4xl text-ink">{story.name}</h1>
      </header>

      <div className="flex min-h-44 items-center justify-center rounded-2xl border border-line-subtle bg-surface-sunken p-10">
        {story.render(args, overrideClass)}
      </div>

      <div className="mt-6 space-y-6">
        <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
          <div className="flex items-center justify-between border-line-subtle border-b px-4 py-2.5">
            <span className="font-mono text-[11px] text-ink-muted">JSX</span>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-line px-2.5 py-1 font-mono text-[11px] text-ink-secondary transition hover:border-line-strong"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs text-ink">{code}</pre>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Variants — the sanctioned, fixed API */}
          <div className="rounded-xl border border-line bg-surface-raised p-5">
            <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
              Props · variants
            </h2>
            <div className="space-y-4">
              {Object.entries(story.controls).map(([key, control]) => (
                <div key={key}>
                  <span className="mb-1.5 block text-xs font-medium text-ink-secondary">{key}</span>

                  {control.type === "select" && (
                    <div className="flex flex-wrap gap-1.5">
                      {control.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => set(key, opt)}
                          className={chip(args[key] === opt)}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {control.type === "boolean" && (
                    <button
                      type="button"
                      aria-pressed={Boolean(args[key])}
                      onClick={() => set(key, !args[key])}
                      className={cn(
                        "inline-flex h-6 w-11 items-center rounded-full border transition",
                        args[key]
                          ? "border-action-primary bg-action-primary"
                          : "border-line bg-surface-sunken",
                      )}
                    >
                      <span
                        className={cn(
                          "size-4 rounded-full bg-white transition",
                          args[key] ? "translate-x-5" : "translate-x-1",
                        )}
                      />
                    </button>
                  )}

                  {control.type === "text" && (
                    <Input value={String(args[key])} onChange={(e) => set(key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* className overrides — the escape hatch (layout/spacing/shape only) */}
          <div className="rounded-xl border border-line bg-surface-raised p-5">
            <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
              className 오버라이드
            </h2>
            <p className="mb-4 text-xs text-ink-muted">
              레이아웃·여백·shape 전용 · 색·크기는 위 variant로 (escape hatch)
            </p>
            <div className="space-y-3">
              {CLASSNAME_GROUPS.map((group) => (
                <div key={group.label}>
                  <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
                    {group.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleOverride(opt)}
                        className={chip(overrides.includes(opt))}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
