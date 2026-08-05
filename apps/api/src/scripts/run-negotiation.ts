/**
 * run-negotiation.ts — 실제 staged 파이프라인(하네스 포함)으로 AI-vs-AI 협상 1판 실행.
 *
 * 데모 스크립트들과 달리 진짜 프로덕션 경로를 탄다:
 *   POST /negotiations/start        (게스트, 인증 불필요) → session_id + run_token
 *   POST /auto-play/next  루프       → 매 라운드 executeStagedNegotiationRound (decide.ts 하네스)
 * 끝나면 트레이스가 negotiation_rounds.metadata.explainability.harness 에 저장된다.
 *
 * 전제: `make dev` 로 API(:3001) + DB 가 떠 있어야 함. 시드된 리스팅 필요(`make seed`).
 *
 * 사용:
 *   cd apps/api && pnpm exec tsx src/scripts/run-negotiation.ts [listing_public_id] [preset]
 *   preset = hunter | closer | verifier | balancer  (기본 hunter)
 * 끝나면 출력된 session_id 로:
 *   pnpm exec tsx src/scripts/dump-harness-trace.ts <session_id>
 */

import "../config/load-env.js";
import { createDb, desc, listingsPublished } from "@haggle/db";

const API = process.env.API_BASE ?? "http://localhost:3001";
const PRESET = process.argv[3] ?? "hunter";
const MAX_STEPS = 12;

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

async function main() {
  // 1) 실행할 리스팅 고르기 (argv 우선, 없으면 seller 있는 published 리스팅들)
  const db = createDb(process.env.DATABASE_URL!);
  const argId = process.argv[2];
  let candidates: string[];
  if (argId) {
    candidates = [argId];
  } else {
    const rows = await db
      .select({ publicId: listingsPublished.publicId })
      .from(listingsPublished)
      .orderBy(desc(listingsPublished.publishedAt))
      .limit(10);
    candidates = rows.map((r) => r.publicId);
    if (candidates.length === 0) {
      console.log("published 리스팅이 없습니다. `make seed` 먼저 실행하세요.");
      process.exit(1);
    }
  }

  // 2) /start — 전략이 완비된 리스팅을 만날 때까지 시도
  let sessionId: string | undefined;
  let runToken: string | undefined;
  for (const listingId of candidates) {
    const { status, json } = await post("/negotiations/start", {
      listing_public_id: listingId,
      negotiation_agent_preset_id: PRESET,
    });
    if (status === 202 && json.session_id) {
      sessionId = json.session_id as string;
      runToken = json.run_token as string | undefined;
      console.log(`✅ 세션 생성: listing ${listingId} · preset ${PRESET}`);
      console.log(`   session_id: ${sessionId}\n`);
      break;
    }
    console.log(`   ⏭ ${listingId} 건너뜀 (${status} ${JSON.stringify(json.error ?? json)})`);
  }
  if (!sessionId) {
    console.log(
      "\n전략이 완비된 리스팅을 못 찾았습니다. 특정 listing_public_id 를 인자로 주거나 시드를 확인하세요.",
    );
    process.exit(1);
  }

  // 3) auto-play — 종료까지 한 라운드씩
  for (let i = 0; i < MAX_STEPS; i++) {
    const { status, json } = await post(`/negotiations/sessions/${sessionId}/auto-play/next`, {
      ...(runToken ? { run_token: runToken } : {}),
    });
    if (status >= 400) {
      console.log(`❌ auto-play 실패 (${status}): ${JSON.stringify(json)}`);
      break;
    }
    console.log(
      `   R${json.round_no ?? "?"} · ${json.decision ?? ""} · status ${json.session_status ?? ""}`,
    );
    if (json.complete === true) {
      console.log(`\n🏁 협상 종료 — status ${json.session_status}`);
      break;
    }
  }

  console.log("\n" + "━".repeat(60));
  console.log("이제 하네스 트레이스를 확인하세요:");
  console.log(`   pnpm exec tsx src/scripts/dump-harness-trace.ts ${sessionId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
