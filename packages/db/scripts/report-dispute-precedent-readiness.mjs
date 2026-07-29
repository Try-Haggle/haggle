import postgres from "postgres";
import {
  DEFAULT_PRIORITY_REASON_CODES,
  evaluateDisputePrecedentReadiness,
} from "./lib/dispute-precedent-readiness.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required for dispute precedent readiness reporting.");
  process.exit(2);
}

const priorityReasonCodes = (process.env.PRECEDENT_PRIORITY_REASONS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const sql = postgres(connectionString, { max: 1, prepare: false });

try {
  const [tableCheck] = await sql`
    SELECT to_regclass(${"public.dispute_precedents"}) IS NOT NULL AS present
  `;
  const [totals] = await sql`
    WITH latest_resolution AS (
      SELECT DISTINCT ON (dispute_id) dispute_id
        FROM dispute_resolutions
       ORDER BY dispute_id, resolved_at DESC NULLS LAST, created_at DESC, id DESC
    )
    SELECT
      count(*)::int AS total_disputes,
      count(*) FILTER (
        WHERE dc.status IN (
          'RESOLVED_BUYER_FAVOR', 'RESOLVED_SELLER_FAVOR', 'PARTIAL_REFUND', 'CLOSED'
        )
      )::int AS terminal_disputes,
      count(lr.dispute_id)::int AS disputes_with_resolution,
      count(*) FILTER (
        WHERE dc.status IN (
          'RESOLVED_BUYER_FAVOR', 'RESOLVED_SELLER_FAVOR', 'PARTIAL_REFUND', 'CLOSED'
        ) AND lr.dispute_id IS NOT NULL
      )::int AS collection_eligible
    FROM dispute_cases dc
    LEFT JOIN latest_resolution lr ON lr.dispute_id = dc.id
  `;
  const eligibleByReason = await sql`
    WITH latest_resolution AS (
      SELECT DISTINCT ON (dispute_id) dispute_id, outcome
        FROM dispute_resolutions
       ORDER BY dispute_id, resolved_at DESC NULLS LAST, created_at DESC, id DESC
    )
    SELECT
      dc.reason_code,
      count(*)::int AS eligible,
      count(*) FILTER (WHERE lr.outcome = 'buyer_favor')::int AS buyer_favor,
      count(*) FILTER (WHERE lr.outcome = 'seller_favor')::int AS seller_favor,
      count(*) FILTER (WHERE lr.outcome = 'partial_refund')::int AS partial_refund,
      count(*) FILTER (WHERE lr.outcome = 'no_action')::int AS no_action
    FROM dispute_cases dc
    INNER JOIN latest_resolution lr ON lr.dispute_id = dc.id
    WHERE dc.status IN (
      'RESOLVED_BUYER_FAVOR', 'RESOLVED_SELLER_FAVOR', 'PARTIAL_REFUND', 'CLOSED'
    )
    GROUP BY dc.reason_code
    ORDER BY eligible DESC, dc.reason_code ASC
  `;

  const precedent = {
    tablePresent: tableCheck?.present === true,
    byStatus: [],
    activeApproved: [],
    currentSourceCount: 0,
  };
  if (precedent.tablePresent) {
    precedent.byStatus = await sql`
      SELECT status, count(*)::int AS count
        FROM dispute_precedents
       GROUP BY status
       ORDER BY status
    `;
    precedent.activeApproved = await sql`
      SELECT reason_code, outcome, count(*)::int AS count
        FROM dispute_precedents
       WHERE status = 'APPROVED'
         AND effective_from <= now()
         AND (effective_until IS NULL OR effective_until > now())
       GROUP BY reason_code, outcome
       ORDER BY reason_code, outcome
    `;
    const [currentSources] = await sql`
      SELECT count(DISTINCT source_dispute_id)::int AS count
        FROM dispute_precedents
       WHERE status IN ('CANDIDATE', 'DRAFT', 'APPROVED', 'EXCLUDED')
    `;
    precedent.currentSourceCount = Number(currentSources?.count ?? 0);
  }

  const readiness = evaluateDisputePrecedentReadiness(
    { totals, eligibleByReason, precedent },
    {
      priorityReasonCodes:
        priorityReasonCodes.length > 0 ? priorityReasonCodes : DEFAULT_PRIORITY_REASON_CODES,
    },
  );

  console.log(
    JSON.stringify(
      {
        observed: {
          totals,
          eligible_by_reason: eligibleByReason,
          precedent_table_present: precedent.tablePresent,
        },
        readiness,
      },
      null,
      2,
    ),
  );

  if (process.argv.includes("--require-ready") && !readiness.precedent_assisted_test_ready) {
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
