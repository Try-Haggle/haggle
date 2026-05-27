import type { AgentKey } from "./agents";
import type { IconKey } from "./icons";

export type Condition = "New" | "Like New" | "Excellent" | "Good" | "Acceptable";
export type CardShape = "tall" | "mid" | "wide";
export type CardBg =
  | "bg-1"
  | "bg-2"
  | "bg-3"
  | "bg-4"
  | "bg-5"
  | "bg-6"
  | "bg-7";

export interface Listing {
  id: string;
  title: string;
  price: number;
  cond: Condition;
  tag: string;
  bg: CardBg;
  shape: CardShape;
  offers: number;
  icon: IconKey;
  agent: AgentKey;
}

export const LISTINGS: Listing[] = [
  { id: "mbp16",  title: 'MacBook Pro 16"',       price: 1980, cond: "Like New",   tag: "M3 Pro",     bg: "bg-1", shape: "mid",  offers: 14, icon: "laptop",     agent: "hugo"   },
  { id: "ip15p",  title: "iPhone 15 Pro 256GB",   price: 820,  cond: "Excellent",  tag: "Titanium",   bg: "bg-3", shape: "tall", offers: 23, icon: "iphone",     agent: "sage"   },
  { id: "apppro", title: "AirPods Pro 2 · USB-C", price: 175,  cond: "New",        tag: "Sealed",     bg: "bg-2", shape: "wide", offers: 8,  icon: "airpods",    agent: "mochi"  },
  { id: "ipdpro", title: 'iPad Pro 11" M4',       price: 940,  cond: "Like New",   tag: "Wi-Fi",      bg: "bg-4", shape: "tall", offers: 11, icon: "ipad",       agent: "pepper" },
  { id: "awult",  title: "Apple Watch Ultra 2",   price: 560,  cond: "Excellent",  tag: "Titanium",   bg: "bg-1", shape: "mid",  offers: 9,  icon: "watch",      agent: "olive"  },
  { id: "gopro",  title: "GoPro Hero 12 Black",   price: 295,  cond: "Good",       tag: "Creator",    bg: "bg-7", shape: "wide", offers: 5,  icon: "gopro",      agent: "hugo"   },
  { id: "wh1k",   title: "Sony WH-1000XM5",       price: 215,  cond: "Excellent",  tag: "Midnight",   bg: "bg-6", shape: "tall", offers: 17, icon: "headphones", agent: "sage"   },
  { id: "mac2",   title: "Mac mini M2",           price: 485,  cond: "Like New",   tag: "16GB",       bg: "bg-4", shape: "wide", offers: 6,  icon: "macmini",    agent: "pepper" },
  { id: "switch", title: "Nintendo Switch OLED",  price: 225,  cond: "Good",       tag: "White",      bg: "bg-2", shape: "mid",  offers: 21, icon: "switch",     agent: "mochi"  },
  { id: "pix8",   title: "Pixel 8 Pro 256GB",     price: 540,  cond: "Excellent",  tag: "Obsidian",   bg: "bg-3", shape: "tall", offers: 12, icon: "pixel",      agent: "olive"  },
  { id: "dji3",   title: "DJI Mini 3",            price: 380,  cond: "Like New",   tag: "Fly Combo",  bg: "bg-1", shape: "mid",  offers: 7,  icon: "drone",      agent: "sage"   },
  { id: "koas",   title: "Kindle Oasis",          price: 140,  cond: "Acceptable", tag: "Graphite",   bg: "bg-7", shape: "wide", offers: 4,  icon: "kindle",     agent: "pepper" },
  { id: "sdk",    title: "Steam Deck OLED 1TB",   price: 520,  cond: "Like New",   tag: "Limited",    bg: "bg-5", shape: "tall", offers: 19, icon: "steamdeck",  agent: "hugo"   },
  { id: "a7iv",   title: "Sony α7 IV",            price: 1740, cond: "Excellent",  tag: "6.2k shots", bg: "bg-6", shape: "mid",  offers: 9,  icon: "camera",     agent: "mochi"  },
  { id: "ipair",  title: 'iPad Air 11" M2',       price: 540,  cond: "Good",       tag: "Starlight",  bg: "bg-4", shape: "wide", offers: 13, icon: "ipad",       agent: "olive"  },
];

/**
 * Distribute listings across 3 masonry columns. Each column gets its own
 * ordering so columns look visually distinct (some items repeat across cols).
 */
export const COLUMN_LISTINGS: [Listing[], Listing[], Listing[]] = [
  [LISTINGS[0], LISTINGS[2], LISTINGS[7], LISTINGS[10], LISTINGS[12], LISTINGS[14]],
  [LISTINGS[1], LISTINGS[5], LISTINGS[8], LISTINGS[11], LISTINGS[13], LISTINGS[3]],
  [LISTINGS[4], LISTINGS[6], LISTINGS[9], LISTINGS[0],  LISTINGS[2],  LISTINGS[8]],
];

export const formatPrice = (n: number) => "$" + n.toLocaleString("en-US");
