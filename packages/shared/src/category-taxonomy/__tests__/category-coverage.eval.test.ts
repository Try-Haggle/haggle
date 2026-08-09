/**
 * G-EVAL — deterministic coverage matrix across representative product types.
 *
 * For real-shaped tag sets this asserts the taxonomy (a) surfaces the safety gates a
 * product must have, (b) never leaks a signature gate across categories, and (c) keeps
 * every hard gate satisfiable (answerHints present → no wedge). The generative layer's
 * quality (LLM long-tail) is a separate manual harness and is not run here.
 *
 * After the 6-cluster research expansion (69 nodes) exact-set assertions are brittle,
 * so we assert "contains expected" + "no FOREIGN signature gate" instead.
 */

import { describe, expect, it } from "vitest";
import { buildCategoryCriteriaScaffold } from "../criteria.js";
import { CATEGORY_TAXONOMY, resolveChecks } from "../taxonomy.js";

/**
 * One signature HARD gate per top area — used for cross-category leakage checks.
 * A product must NOT surface a signature gate from an area it doesn't belong to.
 */
const SIGNATURE_GATES: Record<string, string> = {
  phones: "imei_verification",
  vehicles: "title_status",
  clothing: "authenticity",
  collectibles: "coa_authenticity",
  bicycles: "bike_serial",
  furniture_softgoods: "bed_bugs",
  appliances: "appliance_working_condition",
  baby: "carseat_expiration",
  boardgames: "game_completeness",
  instruments: "instrument_stolen_check",
};

type ProductCase = {
  name: string;
  tags: string[];
  /** Hard gates this product MUST surface (subset — "contains"). */
  expectHardGates: string[];
  /** Soft/other checks that must appear. */
  expectChecks: string[];
  /** Signature-gate keys (from SIGNATURE_GATES) this product legitimately owns. */
  ownsSignatures: string[];
};

const PRODUCTS: ProductCase[] = [
  // ── electronics ──
  {
    name: "iPhone 15 Pro",
    tags: ["electronics", "iphone-15-pro", "256gb"],
    expectHardGates: ["imei_verification", "find_my_status", "financing_paid_off", "water_damage"],
    expectChecks: ["battery_health", "working_status"],
    ownsSignatures: ["phones"],
  },
  {
    name: "Samsung Galaxy",
    tags: ["electronics", "samsung-galaxy-s24"],
    expectHardGates: ["imei_verification", "google_frp_lock", "samsung_reactivation_lock"],
    expectChecks: ["battery_health"],
    ownsSignatures: ["phones"],
  },
  {
    name: "MacBook Pro 14",
    tags: ["electronics", "macbook-pro-14"],
    expectHardGates: ["boots_ok", "activation_lock", "liquid_damage"],
    expectChecks: ["battery_cycles", "spec_summary", "working_status"],
    ownsSignatures: [],
  },
  {
    name: "iPad tablet",
    tags: ["electronics", "ipad-air"],
    expectHardGates: ["activation_lock"],
    expectChecks: ["working_status"],
    ownsSignatures: [],
  },
  {
    name: "Mirrorless camera",
    tags: ["electronics", "sony-mirrorless-camera"],
    expectHardGates: ["stolen_provenance", "powers_on_shoots"],
    expectChecks: ["shutter_count"],
    ownsSignatures: [],
  },
  {
    name: "Graphics card (GPU)",
    tags: ["electronics", "rtx-4070-gpu"],
    expectHardGates: ["gpu_mining_history", "gpu_works", "power_connector_burnt"],
    expectChecks: ["working_status"],
    ownsSignatures: [],
  },
  {
    name: "OLED TV",
    tags: ["electronics", "lg-oled-tv"],
    expectHardGates: ["panel_cracked", "powers_on_image", "oled_burn_in"],
    expectChecks: ["working_status"],
    ownsSignatures: [],
  },
  {
    name: "Gaming console (PS5)",
    tags: ["electronics", "ps5-console"],
    expectHardGates: ["console_ban_status", "modchip_piracy_flag", "powers_reads_disc"],
    expectChecks: ["working_status"],
    ownsSignatures: [],
  },
  {
    name: "DJI drone",
    tags: ["electronics", "dji-mavic-3"],
    expectHardGates: ["account_binding_unbound", "crash_flyaway_history", "powers_flies"],
    expectChecks: ["working_status"],
    ownsSignatures: [],
  },
  // ── clothing / luxury ──
  {
    name: "Designer dress",
    tags: ["clothing", "designer-dress"],
    expectHardGates: ["authenticity"],
    expectChecks: ["size"],
    ownsSignatures: ["clothing"],
  },
  {
    name: "Sneakers (fashion alias)",
    tags: ["fashion", "sneakers"],
    expectHardGates: ["authenticity", "sneaker_authenticity"],
    expectChecks: ["size", "cosmetic_grade"],
    ownsSignatures: ["clothing"],
  },
  {
    name: "Luxury handbag",
    tags: ["clothing", "louis-vuitton-handbag"],
    expectHardGates: ["authenticity", "bag_authenticity", "date_code_chip"],
    expectChecks: ["size"],
    ownsSignatures: ["clothing"],
  },
  {
    name: "Luxury watch",
    tags: ["clothing", "rolex-watch"],
    expectHardGates: ["authenticity", "watch_authenticity", "box_and_papers"],
    expectChecks: [],
    ownsSignatures: ["clothing"],
  },
  {
    name: "Fine jewelry",
    tags: ["clothing", "diamond-ring"],
    expectHardGates: ["authenticity", "metal_hallmark", "diamond_cert", "stone_natural_lab"],
    expectChecks: [],
    ownsSignatures: ["clothing"],
  },
  // ── vehicles ──
  {
    name: "Honda Civic",
    tags: ["vehicles", "honda-civic"],
    expectHardGates: [
      "title_status",
      "lien_status",
      "vin_theft_check",
      "odometer_integrity",
      "flood_damage",
      "frame_damage",
    ],
    expectChecks: ["mileage", "service_history"],
    ownsSignatures: ["vehicles"],
  },
  {
    name: "Used motorcycle",
    tags: ["vehicles", "harley-motorcycle"],
    expectHardGates: ["title_status", "lien_status", "vin_theft_check"],
    expectChecks: ["mileage"],
    ownsSignatures: ["vehicles"],
  },
  {
    name: "Diesel truck (delete gate)",
    tags: ["vehicles", "diesel-truck", "cummins"],
    expectHardGates: ["title_status", "emissions_delete_status"],
    expectChecks: ["mileage"],
    ownsSignatures: ["vehicles"],
  },
  {
    name: "Used tires (standalone, non-titled)",
    tags: ["other", "used-tires"],
    expectHardGates: ["tire_age_dot_code", "sidewall_damage"],
    expectChecks: [],
    // Standalone "tires" node — must NOT inherit the vehicle title/lien/VIN spine.
    ownsSignatures: [],
  },
  {
    name: "Electric scooter (standalone)",
    tags: ["other", "electric-scooter"],
    expectHardGates: ["serial_intact", "stolen_registry_check", "battery_fire_recall"],
    expectChecks: [],
    ownsSignatures: [],
  },
  // ── sports ──
  {
    name: "Road bike",
    tags: ["sports", "road-bike"],
    expectHardGates: ["bike_serial"],
    expectChecks: ["frame_size", "sports_condition"],
    ownsSignatures: ["bicycles"],
  },
  {
    name: "E-bike (battery-fire gate)",
    tags: ["sports", "ebike"],
    expectHardGates: ["bike_serial", "ebike_battery_fire_recall"],
    expectChecks: ["sports_condition"],
    ownsSignatures: ["bicycles"],
  },
  {
    name: "Peloton (rental lock)",
    // NB: use bare "peloton" (not "peloton-bike") — the "bike" token would collide
    // with the bicycles alias. Real "exercise-bike" listings hitting bike_serial is a
    // known alias-collision limitation, acceptable (a spurious soft-ish theft gate).
    tags: ["sports", "peloton"],
    expectHardGates: ["fitness_powers_on_tested", "peloton_activation_lock"],
    expectChecks: ["sports_condition"],
    ownsSignatures: [],
  },
  {
    name: "Tennis racket (sports, not a bike)",
    tags: ["sports", "tennis-racket"],
    expectHardGates: [],
    expectChecks: ["sports_condition", "sizing"],
    ownsSignatures: [],
  },
  // ── collectibles ──
  {
    name: "Graded Pokémon card",
    tags: ["collectibles", "pokemon-card"],
    expectHardGates: [
      "coa_authenticity",
      "graded_status",
      "cert_slab_authenticity",
      "counterfeit_card",
    ],
    expectChecks: ["grade_condition"],
    ownsSignatures: ["collectibles"],
  },
  {
    name: "Graded coin",
    tags: ["collectibles", "silver-coin"],
    expectHardGates: ["coa_authenticity", "coin_graded_status", "counterfeit_coin"],
    expectChecks: [],
    ownsSignatures: ["collectibles"],
  },
  {
    name: "Vinyl record",
    tags: ["collectibles", "vinyl-record"],
    expectHardGates: ["coa_authenticity", "counterfeit_bootleg"],
    expectChecks: [],
    ownsSignatures: ["collectibles"],
  },
  // ── instruments (standalone) ──
  {
    name: "Acoustic guitar (instruments node)",
    tags: ["other", "acoustic-guitar"],
    expectHardGates: ["instrument_stolen_check", "instrument_authenticity"],
    expectChecks: [],
    ownsSignatures: ["instruments"],
  },
  // ── furniture ──
  {
    name: "Mattress (bed-bug gate)",
    tags: ["furniture", "queen-mattress"],
    expectHardGates: ["bed_bugs", "fluid_stains", "mold_mildew"],
    expectChecks: ["dimensions"],
    ownsSignatures: ["furniture_softgoods"],
  },
  {
    name: "Wood dresser (water-damage gate)",
    tags: ["furniture", "wood-dresser"],
    expectHardGates: ["wood_water_damage", "structural_stability"],
    expectChecks: ["dimensions"],
    ownsSignatures: [],
  },
  {
    name: "Plain sideboard (root stays soft)",
    tags: ["furniture", "walnut-sideboard"],
    expectHardGates: [],
    expectChecks: ["dimensions", "material"],
    ownsSignatures: [],
  },
  // ── appliances (standalone) ──
  {
    name: "Refrigerator",
    tags: ["other", "refrigerator"],
    expectHardGates: ["appliance_working_condition", "cooling_works", "fridge_mold_odor"],
    expectChecks: [],
    ownsSignatures: ["appliances"],
  },
  {
    name: "Space heater (fire-safety gates)",
    tags: ["other", "space-heater"],
    expectHardGates: [
      "appliance_working_condition",
      "heater_electrical_safe",
      "heater_safety_features",
    ],
    expectChecks: [],
    ownsSignatures: ["appliances"],
  },
  // ── tools (standalone) ──
  {
    name: "Cordless drill (battery gate)",
    tags: ["other", "dewalt-drill"],
    expectHardGates: ["tool_motor_works", "battery_included", "battery_charger_health"],
    expectChecks: [],
    ownsSignatures: [],
  },
  // ── baby (standalone, safety-critical) ──
  {
    name: "Car seat (expiration/crash/recall)",
    tags: ["other", "car-seat"],
    expectHardGates: ["carseat_expiration", "carseat_crash_history", "carseat_recall_parts"],
    expectChecks: [],
    ownsSignatures: ["baby"],
  },
  {
    name: "Crib (drop-side ban)",
    tags: ["other", "crib"],
    expectHardGates: ["crib_dropside_standard", "crib_hardware_recall"],
    expectChecks: [],
    ownsSignatures: [],
  },
  // ── misc ──
  {
    name: "Board game (completeness gate)",
    tags: ["other", "board-game"],
    expectHardGates: ["game_completeness"],
    expectChecks: [],
    ownsSignatures: ["boardgames"],
  },
  {
    name: "Textbook (edition gate)",
    tags: ["books", "calculus-textbook"],
    expectHardGates: ["isbn_edition_match"],
    expectChecks: ["book_condition"],
    ownsSignatures: [],
  },
  {
    name: "First-edition novel (books root soft)",
    tags: ["books", "first-edition-novel"],
    expectHardGates: [],
    expectChecks: ["edition", "book_condition"],
    ownsSignatures: [],
  },
  // ── uncovered → generative long tail (no deterministic checks) ──
  {
    name: "Vintage telescope (other)",
    tags: ["other", "brass-telescope"],
    expectHardGates: [],
    expectChecks: [],
    ownsSignatures: [],
  },
  {
    name: "Miscellaneous gadget",
    tags: ["other", "usb-gizmo"],
    expectHardGates: [],
    expectChecks: [],
    ownsSignatures: [],
  },
];

describe("G-EVAL — deterministic coverage matrix", () => {
  it("covers at least 30 representative product types across all areas", () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(30);
  });

  for (const product of PRODUCTS) {
    it(`${product.name}: expected gates present, no cross-category leak, scaffold mirrors`, () => {
      const checks = resolveChecks(product.tags);
      const ids = checks.map((c) => c.id);

      // Expected hard gates are present.
      for (const gate of product.expectHardGates) {
        expect(ids, `${product.name} should surface ${gate}`).toContain(gate);
      }
      // Expected soft/other checks are present.
      for (const expected of product.expectChecks) {
        expect(ids, `${product.name} should surface ${expected}`).toContain(expected);
      }

      // No FOREIGN signature gate leaks in (a gate from an area this product doesn't own).
      for (const [area, gate] of Object.entries(SIGNATURE_GATES)) {
        if (product.ownsSignatures.includes(area)) continue;
        expect(ids, `${product.name} must NOT leak ${gate} (${area})`).not.toContain(gate);
      }

      // The scaffold mirrors the resolved checks (hard → required by default).
      const scaffold = buildCategoryCriteriaScaffold(product.tags);
      expect(scaffold.map((c) => c.checkId).sort()).toEqual([...ids].sort());
      for (const gate of product.expectHardGates) {
        expect(scaffold.find((c) => c.checkId === gate)?.requirement).toBe("required");
      }
    });
  }

  it("every hard gate in the taxonomy is satisfiable (has answerHints — no wedge)", () => {
    for (const node of CATEGORY_TAXONOMY) {
      for (const check of node.checks) {
        if (check.enforcement === "hard") {
          expect(check.answerHints?.length ?? 0, `${check.id} needs answerHints`).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });

  it("every hard gate also ships buyer + seller answer options (quick-setup pickers)", () => {
    for (const node of CATEGORY_TAXONOMY) {
      for (const check of node.checks) {
        if (check.enforcement === "hard") {
          expect(
            check.answerOptions?.length ?? 0,
            `${check.id} needs buyer options`,
          ).toBeGreaterThan(0);
          expect(
            check.sellerOptions?.length ?? 0,
            `${check.id} needs seller options`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
