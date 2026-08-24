import type { CategoryCriterion } from "@haggle/shared";
import type { ItemSpec } from "../../src/types.js";

function criterion(checkId: string, questionKo: string, stance: string): CategoryCriterion {
  return {
    checkId,
    questionKo,
    enforcement: "soft",
    requirement: "optional",
    stance,
  };
}

function storageStance(value: unknown): string {
  const raw = String(value ?? "").toUpperCase();
  if (raw.includes("1TB")) return "1TB or larger storage";
  if (raw.includes("512")) return "512GB storage";
  if (raw.includes("128")) return "128GB storage";
  return "256GB storage";
}

function batteryStance(value: unknown): string {
  const n = Number(String(value ?? "").replace("%", ""));
  if (Number.isFinite(n) && n >= 90) return "battery health 90% or higher";
  if (Number.isFinite(n) && n >= 80) return "battery health between 80% and 89%";
  if (Number.isFinite(n)) return "battery health below 80%";
  return "battery health not checked";
}

function scratchStance(value: unknown): string {
  const raw = String(value ?? "").toLowerCase();
  if (!raw || raw === "none") return "mint screen, no marks";
  if (raw.includes("crack")) return "screen cracked or has dead pixels";
  return "screen has minor scratches";
}

function lockStance(value: unknown): string {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("lock") && !raw.includes("unlock")) return "locked to a carrier";
  return "carrier-unlocked";
}

/** Turn nego-lab item attributes into live-path categoryCriteria so seller_facts reach DeepSeek. */
export function attributesToCriteria(attributes: ItemSpec["attributes"]): CategoryCriterion[] {
  const out: CategoryCriterion[] = [];
  if (attributes.storage != null) {
    out.push(
      criterion("storage_capacity", "저장 용량은 얼마인가요?", storageStance(attributes.storage)),
    );
  }
  if (attributes.batteryHealth != null) {
    out.push(
      criterion(
        "battery_health",
        "배터리 성능(%)은 얼마인가요?",
        batteryStance(attributes.batteryHealth),
      ),
    );
  }
  if (attributes.scratches != null) {
    out.push(
      criterion(
        "screen_condition",
        "화면 상태(균열/데드픽셀/터치)는 어떤가요?",
        scratchStance(attributes.scratches),
      ),
    );
  }
  if (attributes.carrierLock != null) {
    out.push(
      criterion("carrier_lock", "통신사 언락 상태인가요?", lockStance(attributes.carrierLock)),
    );
  }
  return out;
}

export const LAB_PARCEL = { weight_oz: 16, length_in: 8, width_in: 5, height_in: 2 };

export const LAB_SELLER_OFFER = {
  options: [{ method: "carrier" as const }],
  preferred: "carrier" as const,
};

export const LAB_FULFILLMENT = {
  methods: ["carrier" as const],
  preferred: "carrier" as const,
  carrier_priority: "balanced" as const,
  buyer_address: {
    name: "Lab Buyer",
    street1: "100 Main St",
    city: "Denver",
    state: "CO",
    zip: "80202",
    country: "US",
  },
};
