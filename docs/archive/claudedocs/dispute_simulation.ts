/**
 * Haggle Dispute System Revenue Simulation
 *
 * Models: Deferred settlement (보류 후 최종 정산)
 * Both parties deposit at each tier, loser forfeits all, winner gets all back.
 * Revenue = 30% of forfeited deposits (70% → Reviewers)
 */

// ─── Tier 1 Fee: Progressive rate, min $1 ───
function tier1Fee(txAmount: number): number {
  let fee = 0;
  if (txAmount <= 1000) {
    fee = txAmount * 0.012;
  } else if (txAmount <= 10000) {
    fee = 1000 * 0.012 + (txAmount - 1000) * 0.007;
  } else if (txAmount <= 100000) {
    fee = 1000 * 0.012 + 9000 * 0.007 + (txAmount - 10000) * 0.003;
  } else {
    fee = 1000 * 0.012 + 9000 * 0.007 + 90000 * 0.003 + (txAmount - 100000) * 0.0015;
  }
  return Math.max(1, Math.round(fee * 100) / 100);
}

function tier2Fee(txAmount: number): number {
  return Math.max(20, Math.round(txAmount * 0.03 * 100) / 100);
}

function tier3Fee(txAmount: number): number {
  return Math.max(40, Math.round(txAmount * 0.06 * 100) / 100);
}

// ─── Simulation Parameters ───
interface SimParams {
  monthlyTransactions: number;
  disputeRate: number;           // % of transactions that become disputes
  tier1ResolutionRate: number;   // % resolved at Tier 1
  tier2ResolutionRate: number;   // % of remaining resolved at Tier 2
  // rest goes to Tier 3

  platformShareOfForfeit: number; // platform gets this % of forfeited deposits
  reviewerShare: number;          // reviewers get this %

  // Transaction amount distribution
  txDistribution: { range: [number, number]; weight: number }[];
}

const defaultParams: SimParams = {
  monthlyTransactions: 1000,
  disputeRate: 0.01,            // 1% dispute rate (v8.3 projection)
  tier1ResolutionRate: 0.80,    // 80% resolved at Tier 1
  tier2ResolutionRate: 0.75,    // 75% of remaining (= 15% of total disputes)
  platformShareOfForfeit: 0.30,
  reviewerShare: 0.70,

  txDistribution: [
    { range: [10, 50], weight: 0.15 },      // 15% micro transactions
    { range: [50, 100], weight: 0.20 },      // 20% small
    { range: [100, 250], weight: 0.25 },     // 25% medium-low
    { range: [250, 500], weight: 0.20 },     // 20% medium
    { range: [500, 1000], weight: 0.10 },    // 10% medium-high
    { range: [1000, 2000], weight: 0.05 },   // 5% high
    { range: [2000, 5000], weight: 0.03 },   // 3% premium
    { range: [5000, 10000], weight: 0.015 }, // 1.5% luxury
    { range: [10000, 50000], weight: 0.005 },// 0.5% ultra
  ],
};

// ─── Run Simulation ───
function simulate(params: SimParams, months: number = 12) {
  const results = {
    totalDisputes: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,

    totalForfeited: 0,
    platformRevenue: 0,
    reviewerPayout: 0,

    // Per tier breakdown
    tier1Forfeited: 0,
    tier2Forfeited: 0,
    tier3Forfeited: 0,

    // Average per dispute
    avgDisputeRevenue: 0,

    // By transaction range
    byRange: [] as { range: string; disputes: number; revenue: number }[],

    // Monthly averages
    monthlyRevenue: 0,
    monthlyReviewerPayout: 0,
    monthlyDisputes: 0,
  };

  const rangeResults: Map<string, { disputes: number; revenue: number }> = new Map();

  for (let month = 0; month < months; month++) {
    for (const dist of params.txDistribution) {
      const txCount = Math.round(params.monthlyTransactions * dist.weight);
      const disputeCount = Math.round(txCount * params.disputeRate);

      for (let d = 0; d < disputeCount; d++) {
        // Random transaction amount in range
        const txAmount = dist.range[0] + Math.random() * (dist.range[1] - dist.range[0]);
        const rangeKey = `$${dist.range[0]}-$${dist.range[1]}`;

        if (!rangeResults.has(rangeKey)) {
          rangeResults.set(rangeKey, { disputes: 0, revenue: 0 });
        }
        const rangeData = rangeResults.get(rangeKey)!;
        rangeData.disputes++;
        results.totalDisputes++;

        // Both parties deposit Tier 1 fee
        const t1 = tier1Fee(txAmount);
        let totalForfeited = 0;

        // Tier 1 resolution
        if (Math.random() < params.tier1ResolutionRate) {
          // Resolved at Tier 1
          // Loser forfeits their deposit, winner gets theirs back
          // Forfeited = 1x Tier 1 fee (loser's deposit only)
          totalForfeited = t1;
          results.tier1Count++;
          results.tier1Forfeited += t1;
        } else {
          // Escalate to Tier 2 — both parties deposit Tier 2 fee
          const t2 = tier2Fee(txAmount);

          if (Math.random() < params.tier2ResolutionRate) {
            // Resolved at Tier 2
            // 보류 후 최종 정산: loser forfeits ALL deposits (Tier 1 + Tier 2)
            totalForfeited = t1 + t2;
            results.tier2Count++;
            results.tier2Forfeited += (t1 + t2);
          } else {
            // Escalate to Tier 3
            const t3 = tier3Fee(txAmount);

            // Tier 3 discount based on Tier 2 margin (simulate)
            const marginRoll = Math.random();
            let t3Actual = t3;
            if (marginRoll < 0.15) t3Actual = t3 * 0.75;       // 15%: 1-vote margin
            else if (marginRoll < 0.35) t3Actual = t3 * 0.90;   // 20%: 2-vote margin
            // else: full price

            // 보류 후 최종 정산: loser forfeits ALL (T1 + T2 + T3)
            totalForfeited = t1 + t2 + t3Actual;
            results.tier3Count++;
            results.tier3Forfeited += (t1 + t2 + t3Actual);
          }
        }

        const platformRev = totalForfeited * params.platformShareOfForfeit;
        const reviewerPay = totalForfeited * params.reviewerShare;

        results.totalForfeited += totalForfeited;
        results.platformRevenue += platformRev;
        results.reviewerPayout += reviewerPay;
        rangeData.revenue += platformRev;
      }
    }
  }

  results.avgDisputeRevenue = results.totalDisputes > 0
    ? results.platformRevenue / results.totalDisputes : 0;
  results.monthlyRevenue = results.platformRevenue / months;
  results.monthlyReviewerPayout = results.reviewerPayout / months;
  results.monthlyDisputes = results.totalDisputes / months;

  for (const [range, data] of rangeResults) {
    results.byRange.push({ range, disputes: data.disputes, revenue: data.revenue });
  }
  results.byRange.sort((a, b) => {
    const aNum = parseInt(a.range.replace('$', ''));
    const bNum = parseInt(b.range.replace('$', ''));
    return aNum - bNum;
  });

  return results;
}

// ─── Print Results ───
function printResults(label: string, params: SimParams) {
  const r = simulate(params, 12);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`\n📊 Parameters:`);
  console.log(`  Monthly transactions: ${params.monthlyTransactions}`);
  console.log(`  Dispute rate: ${(params.disputeRate * 100).toFixed(1)}%`);
  console.log(`  Platform share: ${(params.platformShareOfForfeit * 100)}%`);

  console.log(`\n📈 12-Month Summary:`);
  console.log(`  Total disputes: ${r.totalDisputes}`);
  console.log(`    Tier 1: ${r.tier1Count} (${(r.tier1Count/r.totalDisputes*100).toFixed(1)}%)`);
  console.log(`    Tier 2: ${r.tier2Count} (${(r.tier2Count/r.totalDisputes*100).toFixed(1)}%)`);
  console.log(`    Tier 3: ${r.tier3Count} (${(r.tier3Count/r.totalDisputes*100).toFixed(1)}%)`);

  console.log(`\n💰 Revenue (12 months):`);
  console.log(`  Total forfeited deposits: $${r.totalForfeited.toFixed(2)}`);
  console.log(`  Platform revenue (30%):   $${r.platformRevenue.toFixed(2)}`);
  console.log(`  Reviewer payouts (70%):   $${r.reviewerPayout.toFixed(2)}`);

  console.log(`\n📅 Monthly Averages:`);
  console.log(`  Disputes/month:    ${r.monthlyDisputes.toFixed(1)}`);
  console.log(`  Revenue/month:     $${r.monthlyRevenue.toFixed(2)}`);
  console.log(`  Reviewer pay/month: $${r.monthlyReviewerPayout.toFixed(2)}`);
  console.log(`  Avg revenue/dispute: $${r.avgDisputeRevenue.toFixed(2)}`);

  console.log(`\n📊 Forfeited by Tier:`);
  console.log(`  Tier 1: $${r.tier1Forfeited.toFixed(2)} (${(r.tier1Forfeited/r.totalForfeited*100).toFixed(1)}%)`);
  console.log(`  Tier 2: $${r.tier2Forfeited.toFixed(2)} (${(r.tier2Forfeited/r.totalForfeited*100).toFixed(1)}%)`);
  console.log(`  Tier 3: $${r.tier3Forfeited.toFixed(2)} (${(r.tier3Forfeited/r.totalForfeited*100).toFixed(1)}%)`);

  console.log(`\n📊 Revenue by Transaction Range:`);
  console.log(`  ${"Range".padEnd(15)} ${"Disputes".padEnd(10)} ${"Revenue".padEnd(12)} $/dispute`);
  console.log(`  ${"-".repeat(50)}`);
  for (const b of r.byRange) {
    const perDispute = b.disputes > 0 ? b.revenue / b.disputes : 0;
    console.log(`  ${b.range.padEnd(15)} ${String(b.disputes).padEnd(10)} $${b.revenue.toFixed(2).padEnd(11)} $${perDispute.toFixed(2)}`);
  }

  // Tier 1 fee examples
  console.log(`\n📊 Tier 1 Fee Examples:`);
  for (const amt of [10, 50, 100, 500, 1000, 5000, 10000, 30000, 100000, 500000]) {
    console.log(`  $${amt.toLocaleString().padEnd(10)} → Tier 1: $${tier1Fee(amt).toFixed(2)}`);
  }
}

// ─── Scenarios ───

// Scenario 1: Early Stage (1K tx/month)
printResults("SCENARIO 1: Early Stage (1K tx/month, 1% dispute)", defaultParams);

// Scenario 2: Growth (5K tx/month)
printResults("SCENARIO 2: Growth (5K tx/month, 1% dispute)", {
  ...defaultParams,
  monthlyTransactions: 5000,
});

// Scenario 3: Scale (20K tx/month)
printResults("SCENARIO 3: Scale (20K tx/month, 0.8% dispute)", {
  ...defaultParams,
  monthlyTransactions: 20000,
  disputeRate: 0.008, // dispute rate drops with platform maturity
});

// Scenario 4: Mature (50K tx/month, higher value mix)
printResults("SCENARIO 4: Mature (50K tx/month, richer mix)", {
  ...defaultParams,
  monthlyTransactions: 50000,
  disputeRate: 0.007,
  txDistribution: [
    { range: [10, 50], weight: 0.10 },
    { range: [50, 100], weight: 0.15 },
    { range: [100, 250], weight: 0.20 },
    { range: [250, 500], weight: 0.20 },
    { range: [500, 1000], weight: 0.15 },
    { range: [1000, 2000], weight: 0.08 },
    { range: [2000, 5000], weight: 0.05 },
    { range: [5000, 10000], weight: 0.04 },
    { range: [10000, 50000], weight: 0.02 },
    { range: [50000, 200000], weight: 0.01 },
  ],
});

// Comparison with transaction fee revenue
console.log(`\n${"=".repeat(70)}`);
console.log(`  REVENUE COMPARISON: Dispute vs Transaction Fee (1.5%)`);
console.log(`${"=".repeat(70)}`);

for (const [label, txCount, disputeRate, avgTx] of [
  ["Early (1K)", 1000, 0.01, 350],
  ["Growth (5K)", 5000, 0.01, 350],
  ["Scale (20K)", 20000, 0.008, 450],
  ["Mature (50K)", 50000, 0.007, 600],
] as const) {
  const monthlyTxFee = txCount * avgTx * 0.015;
  const disputes = txCount * disputeRate;
  // Rough avg dispute revenue: ~$2-5 for small scale, higher at scale
  const avgDisputeRev = avgTx * 0.012 * 0.3; // rough: Tier1 * platform share
  const monthlyDisputeRev = disputes * avgDisputeRev * 1.4; // factor for Tier 2/3

  console.log(`\n  ${label}:`);
  console.log(`    Transaction fee (1.5%): $${monthlyTxFee.toFixed(0)}/month`);
  console.log(`    Dispute revenue (est):  $${monthlyDisputeRev.toFixed(0)}/month`);
  console.log(`    Dispute as % of tx fee: ${(monthlyDisputeRev/monthlyTxFee*100).toFixed(1)}%`);
}
