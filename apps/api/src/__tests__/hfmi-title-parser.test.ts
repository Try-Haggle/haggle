import { describe, it, expect } from "vitest";
import {
  parseEbayTitle,
  parseStorageGb,
  parseBatteryHealthPct,
  parseCarrierLocked,
  parseCosmeticGradeHint,
} from "../lib/hfmi-title-parser.js";

describe("parseStorageGb", () => {
  it("extracts 128GB", () => {
    expect(parseStorageGb("Apple iPhone 14 Pro 128GB Unlocked")).toBe(128);
  });
  it("extracts 256 GB with space", () => {
    expect(parseStorageGb("iPhone 15 Pro Max 256 GB Natural Ti")).toBe(256);
  });
  it("extracts 512GB", () => {
    expect(parseStorageGb("iPhone 14 Pro 512GB Deep Purple")).toBe(512);
  });
  it("extracts 1TB as 1024", () => {
    expect(parseStorageGb("iPhone 15 Pro 1TB Blue Titanium Unlocked")).toBe(1024);
  });
  it("returns null when no storage", () => {
    expect(parseStorageGb("iPhone 14 Pro clean")).toBeNull();
  });
});

describe("parseBatteryHealthPct", () => {
  it("extracts 'Battery 92%'", () => {
    expect(parseBatteryHealthPct("iPhone 14 Pro 256GB Battery 92%")).toBe(92);
  });
  it("extracts 'Battery Health: 95%'", () => {
    expect(parseBatteryHealthPct("iPhone 13 Pro - Battery Health: 95%")).toBe(95);
  });
  it("extracts 'BH 88%'", () => {
    expect(parseBatteryHealthPct("iPhone 14 Pro 128GB BH 88%")).toBe(88);
  });
  it("extracts '100% battery'", () => {
    expect(parseBatteryHealthPct("iPhone 15 Pro 256GB 100% battery")).toBe(100);
  });
  it("rejects out-of-range values (under 50)", () => {
    expect(parseBatteryHealthPct("Battery 30%")).toBeNull();
  });
  it("returns null when absent", () => {
    expect(parseBatteryHealthPct("iPhone 14 Pro 256GB Unlocked")).toBeNull();
  });
});

describe("parseCarrierLocked", () => {
  it("recognizes Unlocked", () => {
    expect(parseCarrierLocked("iPhone 14 Pro 256GB Unlocked")).toBe(false);
  });
  it("recognizes AT&T Locked", () => {
    expect(parseCarrierLocked("iPhone 14 Pro 128GB AT&T Locked")).toBe(true);
  });
  it("recognizes Verizon Locked", () => {
    expect(parseCarrierLocked("iPhone 13 Pro Verizon Locked")).toBe(true);
  });
  it("returns null when ambiguous", () => {
    expect(parseCarrierLocked("iPhone 15 Pro 256GB Natural")).toBeNull();
  });
});

describe("parseCosmeticGradeHint", () => {
  it("mint → A", () => {
    expect(parseCosmeticGradeHint("iPhone 14 Pro Mint Condition")).toBe("A");
  });
  it("excellent → A", () => {
    expect(parseCosmeticGradeHint("iPhone 13 Pro Excellent 256GB")).toBe("A");
  });
  it("very good → B", () => {
    expect(parseCosmeticGradeHint("iPhone 14 Pro Very Good 128GB")).toBe("B");
  });
  it("scratched → C", () => {
    expect(parseCosmeticGradeHint("iPhone 14 Pro scratched frame")).toBe("C");
  });
  it("returns null when no hint", () => {
    expect(parseCosmeticGradeHint("iPhone 15 Pro 256GB")).toBeNull();
  });
});

describe("parseEbayTitle (end-to-end fixtures)", () => {
  const fixtures: Array<{
    title: string;
    storage: number | null;
    battery: number | null;
    carrier: boolean | null;
    grade: "A" | "B" | "C" | null;
    excluded: boolean;
  }> = [
    {
      title: "Apple iPhone 14 Pro 256GB Deep Purple Unlocked Battery 92%",
      storage: 256, battery: 92, carrier: false, grade: null, excluded: false,
    },
    {
      title: "iPhone 13 Pro Max 128GB Sierra Blue AT&T Locked BH 89%",
      storage: 128, battery: 89, carrier: true, grade: null, excluded: false,
    },
    {
      title: "iPhone 15 Pro Max 1TB Natural Titanium Unlocked Mint",
      storage: 1024, battery: null, carrier: false, grade: "A", excluded: false,
    },
    {
      title: "iPhone 14 Pro 512GB Space Black Excellent Condition 95% battery",
      storage: 512, battery: 95, carrier: null, grade: "A", excluded: false,
    },
    {
      title: "iPhone 13 Pro CRACKED SCREEN for parts",
      storage: null, battery: null, carrier: null, grade: null, excluded: true,
    },
    {
      title: "iPhone 14 Pro iCloud Locked 256GB",
      storage: null, battery: null, carrier: null, grade: null, excluded: true,
    },
    {
      title: "Lot of 5 iPhone 14 Pro",
      storage: null, battery: null, carrier: null, grade: null, excluded: true,
    },
    {
      title: "iPhone 15 Pro 256GB Blue Titanium very good 100% battery",
      storage: 256, battery: 100, carrier: null, grade: "B", excluded: false,
    },
    {
      title: "iPhone 14 Pro case charger cable bundle",
      storage: null, battery: null, carrier: null, grade: null, excluded: false,
      // Not excluded because "iPhone" is mentioned; but nothing parseable — accessory guard only fires without iPhone
    },
    {
      title: "Lightning Cable Charger Adapter",
      storage: null, battery: null, carrier: null, grade: null, excluded: true,
    },
    {
      title: "iPhone 15 Pro 256GB scratched unlocked",
      storage: 256, battery: null, carrier: false, grade: "C", excluded: false,
    },
    {
      title: "iPhone 14 Pro Max 128GB T-Mobile Locked fair condition",
      storage: 128, battery: null, carrier: true, grade: "C", excluded: false,
    },
    {
      title: "iPhone 13 Pro 512GB like new unlocked battery health: 98%",
      storage: 512, battery: 98, carrier: false, grade: "A", excluded: false,
    },
    {
      title: "Apple iPhone 14 Pro Bad ESN 256GB",
      storage: null, battery: null, carrier: null, grade: null, excluded: true,
    },
    {
      title: "iPhone 15 Pro 128GB",
      storage: 128, battery: null, carrier: null, grade: null, excluded: false,
    },
  ];

  for (const f of fixtures) {
    it(`parses: ${f.title}`, () => {
      const parsed = parseEbayTitle(f.title);
      expect(parsed.excluded).toBe(f.excluded);
      if (!f.excluded) {
        expect(parsed.storageGb).toBe(f.storage);
        expect(parsed.batteryHealthPct).toBe(f.battery);
        expect(parsed.carrierLocked).toBe(f.carrier);
        expect(parsed.cosmeticGradeHint).toBe(f.grade);
      }
    });
  }
});
