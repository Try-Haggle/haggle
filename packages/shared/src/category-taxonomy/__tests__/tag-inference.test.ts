import { describe, expect, it } from "vitest";
import {
  enrichTagsWithTaxonomy,
  inferTaxonomyTags,
  keepTaxonomyLevelTags,
  looksLikeAccessory,
} from "../tag-inference.js";
import { resolveChecks } from "../taxonomy.js";

const hardGates = (tags: string[]) =>
  resolveChecks(tags)
    .filter((c) => c.enforcement === "hard")
    .map((c) => c.id);

describe("inferTaxonomyTags — real listing titles resolve their node", () => {
  const cases: Array<[string, string]> = [
    ["iPhone 15 Pro 256GB Space Black", "iphone"],
    ["Queen mattress, memory foam, like new", "mattress"],
    ["Graco convertible car seat", "car-seat"],
    ["MacBook Pro 14 M3 16GB", "macbook"],
    ["DeWalt cordless drill 20V", "drill"],
    ["Herman Miller Aeron office chair size B", "office-chair"],
    ["Tesla Model 3 Long Range", "tesla"],
    ["LG OLED television 65 inch", "television"],
    ["Rolex Submariner watches lot", "watches"],
    ["Baby stroller, folds flat", "stroller"],
  ];
  for (const [title, expected] of cases) {
    it(`"${title}" → ${expected}`, () => {
      expect(inferTaxonomyTags(title)).toContain(expected);
    });
  }

  it("matches a Korean title by substring (no latin word boundaries)", () => {
    expect(inferTaxonomyTags("아이폰 15 프로 팝니다")).toContain("아이폰");
    expect(inferTaxonomyTags("유아 카시트 판매")).toContain("카시트");
  });

  it("returns [] for text with no taxonomy term", () => {
    expect(inferTaxonomyTags("Vintage brass telescope, works great")).toEqual([]);
    expect(inferTaxonomyTags("")).toEqual([]);
    expect(inferTaxonomyTags("   ")).toEqual([]);
  });

  it("needs no inference where the spine already lives on the category root", () => {
    // "2019 Honda Civic sedan" has no taxonomy term ("sedan" is deliberately NOT an
    // alias — too collision-prone), but the vehicles CATEGORY alone carries the full
    // title/lien/VIN spine, so nothing is lost.
    expect(inferTaxonomyTags("2019 Honda Civic sedan")).toEqual([]);
    expect(hardGates(["vehicles"])).toEqual(
      expect.arrayContaining(["title_status", "lien_status", "vin_theft_check"]),
    );
  });

  it("caps the number of inferred tags", () => {
    const many = "iphone ipad macbook camera lens tv console drone watches jewelry mattress";
    expect(inferTaxonomyTags(many).length).toBeLessThanOrEqual(6);
  });
});

describe("accessory guard — an accessory must NOT inherit the item's safety gates", () => {
  const accessories = [
    "iPhone 15 case, leather",
    "TV stand, walnut",
    "Car seat cover set",
    "MacBook charger 96W",
    "Apple Watch band, sport loop",
    "Camera tripod",
    "Phone screen protector film",
    "아이폰 케이스 판매",
  ];
  for (const title of accessories) {
    it(`"${title}" infers nothing`, () => {
      expect(looksLikeAccessory(title)).toBe(true);
      expect(inferTaxonomyTags(title)).toEqual([]);
    });
  }

  it("a BUNDLED extra is not an accessory listing (inclusion marker)", () => {
    // The subject is still the phone — "with charger" is a bundled extra.
    expect(looksLikeAccessory("iPhone 15 Pro with charger")).toBe(false);
    expect(inferTaxonomyTags("iPhone 15 Pro with charger")).toContain("iphone");
    expect(inferTaxonomyTags("Queen mattress and cover included")).toContain("mattress");
    expect(inferTaxonomyTags("MacBook Pro 14 includes case")).toContain("macbook");
  });

  it("the guard is why a phone case never gets IMEI/activation gates", () => {
    const caseTags = enrichTagsWithTaxonomy(["electronics"], "iPhone 15 case, leather").tags;
    expect(hardGates(caseTags)).toEqual([]);
    // …while the actual phone does get them.
    const phoneTags = enrichTagsWithTaxonomy(["electronics"], "iPhone 15 Pro 256GB").tags;
    expect(hardGates(phoneTags)).toContain("imei_verification");
  });
});

describe("enrichTagsWithTaxonomy — closes the vision-tagger gap", () => {
  it("adds the item-type tag when vision emitted only ATTRIBUTES", () => {
    // Realistic gpt-4o-mini output: storage/color/condition, no item type.
    const visionTags = ["256gb", "space-black", "minor-scratches", "with-charger"];
    const before = hardGates(["electronics", ...visionTags]);
    expect(before).toEqual([]); // the bug this module fixes

    const { tags, inferred } = enrichTagsWithTaxonomy(
      ["electronics", ...visionTags],
      "iPhone 15 Pro 256GB Space Black",
    );
    expect(inferred).toContain("iphone");
    expect(hardGates(tags)).toEqual(
      expect.arrayContaining(["imei_verification", "find_my_status"]),
    );
  });

  it("works with ZERO tags — the vision-failed path", () => {
    const { tags, inferred } = enrichTagsWithTaxonomy([], "Queen mattress, memory foam");
    expect(inferred).toContain("mattress");
    expect(hardGates(tags)).toEqual(expect.arrayContaining(["bed_bugs", "fluid_stains"]));
  });

  it("restores the child-safety gates on a car seat (category alone gives none)", () => {
    expect(hardGates(["other", "graco", "black", "with-base"])).toEqual([]);
    const { tags } = enrichTagsWithTaxonomy(
      ["other", "graco", "black", "with-base"],
      "Graco car seat, barely used",
    );
    expect(hardGates(tags)).toEqual(
      expect.arrayContaining([
        "carseat_expiration",
        "carseat_crash_history",
        "carseat_recall_parts",
      ]),
    );
  });

  it("never drops existing tags and does not duplicate", () => {
    const existing = ["electronics", "iphone", "256gb"];
    const { tags, inferred } = enrichTagsWithTaxonomy(existing, "iPhone 15 Pro");
    expect(tags.slice(0, existing.length)).toEqual(existing);
    expect(inferred).not.toContain("iphone"); // already present
    expect(tags.filter((t) => t === "iphone")).toHaveLength(1);
  });

  it("is case/format tolerant against already-present tags", () => {
    const { inferred } = enrichTagsWithTaxonomy(["Electronics", "IPHONE"], "iPhone 15 Pro");
    expect(inferred).not.toContain("iphone");
  });

  it("leaves a long-tail listing untouched (no false enrichment)", () => {
    const { tags, inferred } = enrichTagsWithTaxonomy(
      ["other", "brass", "antique-style"],
      "Vintage brass telescope",
    );
    expect(inferred).toEqual([]);
    expect(tags).toEqual(["other", "brass", "antique-style"]);
  });
});

describe("generic-word stopwords — listing prose must not attach unrelated safety gates", () => {
  // Each of these words is a real taxonomy leaf/alias that also appears in everyday
  // listing prose. Inferring them attached e.g. IMEI gates to a monitor.
  const prose: Array<[string, string]> = [
    ["LG 27 inch 4K monitor, I saw no dead pixel", "saw"],
    ["LG 27 inch 4K monitor, I saw no dead pixel", "pixel"],
    ["Vintage oak coffee table, solid wood, pet-free home", "table"],
    ["Vintage oak coffee table, solid wood, pet-free home", "wood"],
    ["Vintage oak coffee table, solid wood, pet-free home", "pet"],
    ["Moleskine notebook set, unused", "notebook"],
    ["Zara midi dress, size M", "midi"],
    ["Ryobi kit, all tools included", "tools"],
    ["Kept on my desk, barely used", "desk"],
  ];
  for (const [text, forbidden] of prose) {
    it(`"${text}" does not infer "${forbidden}"`, () => {
      expect(inferTaxonomyTags(text)).not.toContain(forbidden);
    });
  }

  it("a monitor listing gets NO phone/tool/furniture hard gates", () => {
    const { tags } = enrichTagsWithTaxonomy(
      ["electronics"],
      "LG 27 inch 4K Monitor — I saw no dead pixel, kept on my desk",
    );
    const gates = hardGates(tags);
    for (const wrong of [
      "imei_verification",
      "google_frp_lock",
      "tool_motor_works",
      "wood_water_damage",
    ]) {
      expect(gates).not.toContain(wrong);
    }
  });

  it("sneakers do not inherit power-tool gates from the word 'saw'", () => {
    const { tags } = enrichTagsWithTaxonomy(
      ["clothing"],
      "Nike Air Force 1 — bought at the store, saw them online cheaper",
    );
    expect(hardGates(tags)).not.toContain("tool_motor_works");
  });
});

describe("coverage gaps found by the real-path probe (must stay closed)", () => {
  // Each of these resolved ZERO safety gates before the fix, because the item's own name
  // is (or contains) an inference stopword, or the node did not exist.
  const nowCovered: Array<[string, string, string]> = [
    ["Google Pixel 8 Pro", "electronics", "imei_verification"],
    // A10: bare "Pixel N" (no Google) must still classify via "pixel N" / "pixel-N" aliases.
    ["Pixel 8 Pro 128GB Unlocked", "electronics", "google_frp_lock"],
    ["Dell 27 inch gaming monitor 144Hz", "electronics", "panel_cracked"],
    ["Weber Genesis gas grill", "other", "grill_gas_rust_safe"],
    ["1921 Morgan silver dollar coins", "collectibles", "counterfeit_coin"],
    ["Sun Tracker pontoon boat", "vehicles", "hin_match"],
  ];
  for (const [title, category, gate] of nowCovered) {
    it(`"${title}" resolves ${gate}`, () => {
      const { tags } = enrichTagsWithTaxonomy([category], title);
      expect(hardGates(tags)).toContain(gate);
    });
  }

  it("…without reopening the collisions those stopwords existed for", () => {
    // "no dead pixel" must not pull phone gates onto a monitor.
    expect(
      hardGates(enrichTagsWithTaxonomy(["electronics"], "LG 27 monitor, no dead pixel").tags),
    ).not.toContain("imei_verification");
    // A car grill part must not become a BBQ.
    expect(inferTaxonomyTags("Honda Civic front grill cover")).toEqual([]);
    // "coin operated" is not a collectible coin.
    expect(inferTaxonomyTags("Coin operated laundry machine")).not.toContain("coins");
    // Boat shoes are not a boat; D3 — generic shoes must not open sneakers HARD either.
    const boatShoeGates = hardGates(
      enrichTagsWithTaxonomy(["clothing"], "Sperry boat shoes size 10").tags,
    );
    expect(boatShoeGates).not.toContain("hin_match");
    expect(boatShoeGates).not.toContain("sneaker_authenticity");
  });
});

describe("multi-family brands only decide when nothing more specific matched", () => {
  it("AirPods open authenticity + Find My unpaired, not IMEI", () => {
    const { tags } = enrichTagsWithTaxonomy(["electronics"], "AirPods Pro 2 used");
    const gates = hardGates(tags);
    expect(gates).not.toContain("imei_verification");
    expect(gates).toEqual(expect.arrayContaining(["counterfeit_authenticity", "find_my_unpaired"]));
  });

  it("a Samsung TV resolves the TV node, not the phone node's IMEI gates", () => {
    const inferred = inferTaxonomyTags("Samsung 65 inch 4K QLED TV");
    expect(inferred).not.toContain("samsung");
    const { tags } = enrichTagsWithTaxonomy(["electronics"], "Samsung 65 inch 4K QLED TV");
    const gates = hardGates(tags);
    expect(gates).not.toContain("imei_verification");
    expect(gates).toEqual(expect.arrayContaining(["panel_cracked"]));
  });

  it("a Samsung phone still resolves the phone node (nothing else matched)", () => {
    const { tags } = enrichTagsWithTaxonomy(["electronics"], "Samsung Galaxy S24 Ultra 512GB");
    expect(hardGates(tags)).toEqual(
      expect.arrayContaining(["imei_verification", "google_frp_lock"]),
    );
  });
});

describe("accessory guard — adversarial phrasings", () => {
  it("an adjective list cannot smuggle an inclusion marker in", () => {
    // "and" two words before "case" previously read as a bundled extra.
    expect(looksLikeAccessory("Clear and slim case for iPhone 15")).toBe(true);
    expect(inferTaxonomyTags("Clear and slim case for iPhone 15")).toEqual([]);
    expect(inferTaxonomyTags("Genuine leather and silicone case for iPhone 15 Pro")).toEqual([]);
  });

  it("catches Korean accessory compounds with no spaces", () => {
    expect(looksLikeAccessory("아이폰15케이스 팝니다")).toBe(true);
    expect(inferTaxonomyTags("아이폰15케이스 팝니다")).toEqual([]);
    expect(inferTaxonomyTags("맥북 케이스입니다")).toEqual([]);
  });

  it("does NOT suppress items whose own name ends in a weak head word", () => {
    // These were being wrongly suppressed, losing exactly the gates they need.
    for (const title of [
      "Louis Vuitton Neverfull bag",
      "14k gold wedding band",
      "Canon AE-1 film camera",
      "KitchenAid stand mixer",
    ]) {
      expect(looksLikeAccessory(title), title).toBe(false);
    }
    // …and the ones that carry a taxonomy term still resolve it.
    expect(inferTaxonomyTags("Louis Vuitton Neverfull bag")).toContain("louis-vuitton");
    expect(inferTaxonomyTags("Canon AE-1 film camera")).toContain("camera");
  });

  it("still suppresses a weak head in an '<item> <head>' construction", () => {
    expect(looksLikeAccessory("TV stand, walnut")).toBe(true);
    expect(looksLikeAccessory("Apple Watch band, sport loop")).toBe(true);
    expect(looksLikeAccessory("Camera strap, leather")).toBe(true);
  });

  it("a handbag listing keeps its authenticity gates", () => {
    const { tags } = enrichTagsWithTaxonomy(["clothing"], "Louis Vuitton Neverfull bag");
    expect(hardGates(tags)).toEqual(expect.arrayContaining(["bag_authenticity"]));
  });
});

describe("collision safety — inference must not resurrect the fixed false positives", () => {
  const mustNotInfer: Array<[string, string]> = [
    ["EV charger 240V", "electric-vehicle"],
    ["Ski jacket, mens large", "skis"],
    ["Diesel jeans, 32x30", "diesel-truck"],
    ["Boat shoes, size 10", "jetski"],
    ["Pressure washer 2000psi", "washing-machine"],
    ["Hair dryer, ionic", "clothes-dryer"],
    ["Vinyl flooring, 200sqft", "vinyl-record"],
    ["Milk crate, plastic", "dog-crate"],
    ["Camping cot, folding", "crib"],
    ["Quad core CPU i7", "atv"],
  ];
  for (const [title, forbidden] of mustNotInfer) {
    it(`"${title}" does not infer ${forbidden}`, () => {
      expect(inferTaxonomyTags(title)).not.toContain(forbidden);
    });
  }

  it("an EV charger gets no vehicle title spine", () => {
    const { tags } = enrichTagsWithTaxonomy(["electronics"], "EV charger 240V level 2");
    expect(hardGates(tags)).not.toContain("title_status");
  });

  it("a real Tesla still resolves the vehicle spine", () => {
    const { tags } = enrichTagsWithTaxonomy(["vehicles"], "2021 Tesla Model 3 Long Range");
    expect(hardGates(tags)).toEqual(expect.arrayContaining(["title_status", "vin_theft_check"]));
  });
});

describe("keepTaxonomyLevelTags", () => {
  it("keeps category → type → model and drops color/condition specs", () => {
    expect(
      keepTaxonomyLevelTags([
        "iphone 14 plus",
        "iphone",
        "mint color",
        "like new",
        "excellent-condition",
        "256gb",
        "space-black",
        "with-charger",
      ]),
    ).toEqual(["iphone-14-plus", "iphone"]);
  });

  it("keeps airpods-pro as a model child and drops mint-color", () => {
    expect(keepTaxonomyLevelTags(["airpods-pro", "mint-color", "headphones"])).toEqual([
      "airpods-pro",
      "headphones",
    ]);
  });
});
