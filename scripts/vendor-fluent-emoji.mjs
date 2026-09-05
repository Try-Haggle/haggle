#!/usr/bin/env node
/**
 * Vendor animal artwork from Microsoft's Fluent Emoji into the web app.
 *
 * The agent avatars are not drawn by us. Fluent Emoji is MIT licensed and its
 * ~100 animals were made by one design team, so any subset of them is style-
 * consistent for free — which hand-drawing could not achieve. This script is
 * how that subset is chosen and refreshed; adding an animal is a one-line edit
 * to ANIMALS below, never an illustration task.
 *
 * Only the `Color` SVGs are vendored. The `3D` variants are 256px PNGs and
 * cannot scale, and the avatar has to stay crisp from 24px to 128px.
 *
 *   node scripts/vendor-fluent-emoji.mjs            # fetch the list below
 *   node scripts/vendor-fluent-emoji.mjs --list     # print every animal upstream
 *   node scripts/vendor-fluent-emoji.mjs Otter Deer # fetch extras, additively
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = "microsoft/fluentui-emoji";
const CDN = `https://cdn.jsdelivr.net/gh/${REPO}@main/assets`;
const OUT = path.resolve("apps/web/public/vendor/fluent-emoji");

/**
 * Upstream folder name → the slug the app imports it by.
 *
 * Curated for *agent avatars*: every entry has to read as a distinct animal at
 * 40px in a roster, which rules out most insects, fish and reptiles however
 * nice they look at full size.
 */
const ANIMALS = {
  // Standalone animals that Fluent happens to draw head-on.
  Fox: "fox",
  Wolf: "wolf",
  Owl: "owl",
  Bear: "bear",
  "Polar bear": "polar-bear",
  Panda: "panda",
  Koala: "koala",
  Penguin: "penguin",
  Raccoon: "raccoon",
  Lion: "lion",
  Hamster: "hamster",
  Frog: "frog",
  // Upstream's dedicated `* face` assets, for animals whose standalone art is
  // a side-on full body.
  "Cat face": "cat",
  "Dog face": "dog",
  "Tiger face": "tiger",
  "Rabbit face": "rabbit",
  "Mouse face": "mouse",
  "Cow face": "cow",
  "Pig face": "pig",
  "Monkey face": "monkey",
};

/**
 * Animals upstream draws in **side-on full body**. They are excellent artwork
 * and useless here: an avatar roster reads by silhouette, and a row that mixes
 * head-on faces with side-on bodies looks like two different products. Listed
 * so nobody re-adds them expecting a face.
 */
const REJECTED_SIDE_ON = [
  "Badger",
  "Deer",
  "Dolphin",
  "Duck",
  "Eagle",
  "Elephant",
  "Flamingo",
  "Giraffe",
  "Hedgehog",
  "Leopard",
  "Llama",
  "Octopus",
  "Otter",
  "Parrot",
  "Peacock",
  "Poodle",
  "Shark",
  "Sloth",
  "Swan",
  "Turtle",
  "Unicorn",
  "Whale",
  "Zebra",
  "Black cat",
  // These two are side-on even in their `* face` variant.
  "Horse face",
  "Dragon face",
];

/** Upstream file naming: "Polar bear" → "polar_bear_color.svg". */
const fileFor = (name) => `${name.toLowerCase().replace(/[\s-]+/g, "_")}_color.svg`;

async function listUpstream() {
  const root = await fetch(`https://api.github.com/repos/${REPO}/contents/?ref=main`).then((r) =>
    r.json(),
  );
  const sha = root.find((x) => x.name === "assets").sha;
  const tree = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${sha}`).then((r) =>
    r.json(),
  );
  return tree.tree.filter((x) => x.type === "tree").map((x) => x.path);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    const all = await listUpstream();
    console.log(all.join("\n"));
    console.log(`\n${all.length} emoji upstream.`);
    return;
  }

  const extras = Object.fromEntries(
    args.map((n) => [
      n,
      n
        .toLowerCase()
        .replace(/\s*face$/, "")
        .replace(/[\s_]+/g, "-"),
    ]),
  );
  for (const n of args) {
    if (REJECTED_SIDE_ON.includes(n)) {
      console.warn(`  NOTE ${n} is drawn side-on upstream — it will not match the roster.`);
    }
  }
  const wanted = { ...ANIMALS, ...extras };

  await mkdir(OUT, { recursive: true });

  const manifest = [];
  let failed = 0;
  for (const [name, slug] of Object.entries(wanted)) {
    const url = `${CDN}/${encodeURIComponent(name)}/Color/${fileFor(name)}`;
    const res = await fetch(url);
    if (!res.ok) {
      // A miss is almost always an upstream rename; --list shows the truth.
      console.error(`  MISS ${name} -> ${res.status}`);
      failed++;
      continue;
    }
    const svg = await res.text();
    await writeFile(path.join(OUT, `${slug}.svg`), svg);
    manifest.push({ slug, name, bytes: svg.length });
    console.log(`  ok   ${slug.padEnd(12)} ${String(svg.length).padStart(6)} bytes`);
  }

  // The licence requires the notice to travel with the copies.
  const licence = await fetch(`https://raw.githubusercontent.com/${REPO}/main/LICENSE`).then((r) =>
    r.text(),
  );
  await writeFile(path.join(OUT, "LICENSE"), licence);

  manifest.sort((a, b) => a.slug.localeCompare(b.slug));
  await writeFile(
    path.join(OUT, "manifest.json"),
    `${JSON.stringify(
      { source: `https://github.com/${REPO}`, licence: "MIT", variant: "Color", animals: manifest },
      null,
      2,
    )}\n`,
  );

  console.log(
    `\n${manifest.length} vendored to ${path.relative(process.cwd(), OUT)}, ${failed} missed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
