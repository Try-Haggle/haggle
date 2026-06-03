/**
 * Slice 2 검증 스크립트 — 직접 실행해서 확인
 *
 * 실행:
 *   npx tsx src/scripts/test-notification.ts
 *
 * 확인 사항:
 *   1. notifications 테이블에 행 생성
 *   2. email_deliveries 테이블에 행 생성
 *   3. [DEV] 콘솔에 "[EMAIL DEV]" 로그 출력
 */
import "../config/load-env.js";
import { createDb } from "@haggle/db";
import { Resend } from "resend";
import { createNotificationBus } from "../notification/index.js";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const bus = createNotificationBus(db, resend);

  // ⚠️ 실제 DB에 있는 user UUID로 교체 필요
  const testUserId = process.env.TEST_USER_ID ?? "";
  if (!testUserId) {
    console.error("TEST_USER_ID 환경변수를 설정해주세요 (.env에 추가)");
    process.exit(1);
  }

  console.log("Publishing negotiation.session.concluded ...");
  await bus.publish({
    type: "negotiation.session.concluded",
    recipientUserId: testUserId,
    payload: {
      sessionId: "00000000-0000-0000-0000-000000000001",
      agreedPriceMinor: 120000,
      currency: "USD",
      listingTitle: "MacBook Pro",
      listingId: "00000000-0000-0000-0000-000000000003",
    },
  });
  // Email channel is fire-and-forget — wait for async ops to complete before exit
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log("✅ Done. Check Supabase Studio: notifications + email_deliveries tables");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
