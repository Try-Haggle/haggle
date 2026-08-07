/**
 * dump-harness-trace.ts — 실제 협상이 남긴 하네스 트레이스를 DB에서 뽑아 출력.
 *
 * 실 협상(웹/API의 staged 파이프라인)이 한 번 돌면 라운드마다
 * negotiation_rounds.metadata.explainability.harness 에 box·baseline·aim·
 * opponent_estimate·clamp 가 저장된다. 이 스크립트로 그걸 눈으로 확인한다.
 * (demo-llm-negotiation.ts 는 독립형이라 여기에 안 남는다 — 반드시 실제 경로로 협상할 것.)
 *
 * 사용:
 *   pnpm exec tsx apps/api/src/scripts/dump-harness-trace.ts            # 최근 세션
 *   pnpm exec tsx apps/api/src/scripts/dump-harness-trace.ts <세션ID>   # 특정 세션
 *   (apps/api 디렉터리에서 pnpm exec tsx ... 로 실행)
 */

import "../config/load-env.js";
import { asc, createDb, desc, eq, negotiationRounds, negotiationSessions } from "@haggle/db";

const money = (v: unknown): string => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : "—";
};
const pct = (v: unknown): string => (typeof v === "number" ? `${(v * 100).toFixed(0)}%` : "—");

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  let sessionId = process.argv[2];

  if (!sessionId) {
    const latest = await db
      .select({
        id: negotiationSessions.id,
        status: negotiationSessions.status,
        createdAt: negotiationSessions.createdAt,
      })
      .from(negotiationSessions)
      .orderBy(desc(negotiationSessions.createdAt))
      .limit(1);
    if (latest.length === 0) {
      console.log("세션이 없습니다. 먼저 웹(:3000)에서 협상을 한 번 돌리세요.");
      process.exit(0);
    }
    sessionId = latest[0]!.id;
    console.log(`최근 세션 사용: ${sessionId} (status: ${latest[0]!.status})\n`);
  }

  const rounds = await db
    .select()
    .from(negotiationRounds)
    .where(eq(negotiationRounds.sessionId, sessionId))
    .orderBy(asc(negotiationRounds.roundNo));

  if (rounds.length === 0) {
    console.log(`세션 ${sessionId} 에 라운드가 없습니다.`);
    process.exit(0);
  }

  let withHarness = 0;
  for (const r of rounds) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const expl = (meta.explainability ?? {}) as Record<string, unknown>;
    const h = expl.harness as
      | {
          box?: { min: number; max: number; width: number };
          baseline?: number;
          aim?: number;
          opponent_estimate?: Record<string, unknown>;
          ai_choice?: { price?: number; source?: string; tactic?: string };
          delta_vs_baseline?: number;
          box_clamp?: { clamped?: boolean; original?: number; reason?: string };
          autonomy?: number;
          model_id?: string;
        }
      | undefined;

    console.log(
      `── R${r.roundNo} · ${r.senderRole} · ${r.decision ?? "?"} · tokens ${r.llmTokensUsed ?? 0}${r.reasoningUsed ? " · reasoning" : ""} ──`,
    );
    if (r.message) console.log(`   💬 "${String(r.message).slice(0, 100)}"`);

    if (!h) {
      console.log("   (하네스 트레이스 없음 — COUNTER가 아니거나 box가 무효였던 라운드)\n");
      continue;
    }
    withHarness++;
    const e = h.opponent_estimate;
    console.log(
      `   box       : ${money(h.box?.min)} – ${money(h.box?.max)}  (autonomy ${h.autonomy})`,
    );
    console.log(`   baseline  : ${money(h.baseline)}   aim: ${money(h.aim)}`);
    if (e) {
      console.log(
        `   상대추정  : time_pressure ${pct(e.time_pressure)} · toughness ${pct(e.toughness)} · confidence ${pct(e.confidence)}${e.est_reservation_price != null ? ` · est_reservation ${money(e.est_reservation_price)}` : ""}`,
      );
    } else {
      console.log("   상대추정  : (없음 — LLM이 opponent_estimate 안 냄)");
    }
    console.log(
      `   AI 최종   : ${money(h.ai_choice?.price)} (${h.ai_choice?.source})   Δ vs baseline ${typeof h.delta_vs_baseline === "number" ? h.delta_vs_baseline.toFixed(2) : "—"}`,
    );
    console.log(
      `   clamp     : ${h.box_clamp?.clamped ? `⚠ ${money(h.box_clamp.original)} → box ${h.box_clamp.reason}` : "없음"}`,
    );
    console.log(`   model     : ${h.model_id ?? "—"}\n`);
  }

  console.log("━".repeat(60));
  if (withHarness > 0) {
    console.log(
      `✅ 배선 성공 — ${rounds.length}개 라운드 중 ${withHarness}개에 하네스 트레이스 존재.`,
    );
  } else {
    console.log(`⚠️ 하네스 트레이스 0개 — 배선 확인 필요.`);
    console.log(`   체크: (1) 실제 경로(웹/API)로 협상했나 (demo 스크립트 아님)`);
    console.log(`         (2) COUNTER 라운드가 있었나  (3) coach.acceptable_range 가 채워졌나`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
