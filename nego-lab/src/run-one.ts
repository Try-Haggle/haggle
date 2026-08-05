// Step 1 smoke: run ONE sample case from the new nego-lab folder to prove the
// engine + context wiring works end-to-end against the local DB.
//
// Run (from repo root):
//   export DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab"
//   npx tsx nego-lab/src/run-one.ts
import { closeLabContext, createLabContext } from "./harness.js";
import { runNegotiation } from "./run-negotiation.js";
import type { ScenarioCase } from "./types.js";

const sample: ScenarioCase = {
  id: "sample-baseline",
  group: "A",
  label: "balancer(seller)×hunter(buyer)",
  item: {
    title: "iPhone 15 Pro 256GB",
    category: "phone",
    condition: "good",
    askPrice: 900,
    floorPrice: 780,
    deadlineHours: 7 * 24,
    attributes: {
      storage: "256GB",
      batteryHealth: "85%",
      scratches: "minor hairline on screen",
      carrierLock: "unlocked",
    },
  },
  seller: { agent: "balancer" },
  buyer: { agent: "hunter", budgetMax: 850, targetPrice: 800 },
};

async function main() {
  const ctx = await createLabContext();
  try {
    const result = await runNegotiation(ctx, sample);
    console.log("\n=== RESULT ===");
    console.log(
      JSON.stringify(
        {
          caseId: result.caseId,
          outcome: result.outcome,
          finalPrice: result.finalPrice,
          rounds: result.rounds,
          startStatus: result.startStatus,
          durationMs: result.durationMs,
          error: result.error,
        },
        null,
        2,
      ),
    );
    console.log("\n=== TRANSCRIPT ===");
    for (const r of result.transcript) {
      const price = r.priceMinor != null ? `$${(r.priceMinor / 100).toFixed(2)}` : "-";
      console.log(
        `  r${r.roundNo} ${r.senderRole} ${r.messageType} ${price} → ${r.decision}  "${(r.message ?? "").slice(0, 70)}"`,
      );
    }
  } finally {
    await closeLabContext(ctx);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("run-one FAILED:", err);
  process.exit(1);
});
