# Fluent Emoji (vendored)

Source: https://github.com/microsoft/fluentui-emoji — © Microsoft Corporation, **MIT License**
(`LICENSE` in this directory, retained as the licence requires).

Refreshed with `node scripts/vendor-fluent-emoji.mjs`. `manifest.json` lists what is here; the
script's `ANIMALS` map is the single place to add or drop one. `--list` prints all ~1,600 emoji
upstream, of which roughly 100 are animals.

**Only head-on faces are vendored.** Much of upstream's animal art is a side-on full body, which is
excellent artwork and wrong for an avatar roster: a row mixing head-on faces with side profiles
reads as two different products. `REJECTED_SIDE_ON` in the script records the ones already checked
and rejected, so nobody re-adds them expecting a face. Only the `Color` SVGs — the `3D` variants are
256px PNGs and cannot scale from 24px to 128px.

**Preview-only.** Nothing in production reads this directory. Before shipping, settle the open
question in the project notes: MIT permits commercial use, but these are Microsoft's emoji — freely
licensed to everyone, so they can never be *owned* as Haggle's brand.
