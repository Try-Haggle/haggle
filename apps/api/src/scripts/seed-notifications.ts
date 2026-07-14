/**
 * 테스트용 알림 seed 스크립트
 *
 * 실행:
 *   npx tsx src/scripts/seed-notifications.ts <userId>
 *
 * 예시:
 *   npx tsx src/scripts/seed-notifications.ts abc123-...
 */
import "../config/load-env.js";
import { createDb } from "@haggle/db";
import { Resend } from "resend";
import { createNotificationBus } from "../notification/index.js";

async function main() {
  const userId = process.argv[2] ?? process.env.TEST_USER_ID;
  if (!userId) {
    console.error("Usage: npx tsx src/scripts/seed-notifications.ts <userId>");
    process.exit(1);
  }

  const db = createDb(process.env.DATABASE_URL!);
  const resend = new Resend(process.env.RESEND_API_KEY ?? "re_test_placeholder");
  const bus = createNotificationBus(db, resend);

  const sessionId = "00000000-0000-0000-0000-000000000001";
  const listingId = "00000000-0000-0000-0000-000000000003";

  const events = [
    {
      type: "negotiation.session.concluded" as const,
      payload: {
        sessionId,
        agreedPriceMinor: 120000,
        currency: "USD",
        listingTitle: "MacBook Pro 14-inch M3",
        listingId,
      },
    },
    {
      type: "negotiation.offer.accepted" as const,
      payload: {
        sessionId: "00000000-0000-0000-0000-000000000002",
        agreedPriceMinor: 28000,
        currency: "USD",
        buyerName: "Alex Kim",
        listingTitle: "Sony WH-1000XM5",
        listingId: "00000000-0000-0000-0000-000000000004",
      },
    },
  ] as const;

  for (const event of events) {
    console.log(`Publishing ${event.type} ...`);
    await bus.publish({
      type: event.type,
      recipientUserId: userId,
      payload: event.payload,
    });
    // 짧은 딜레이로 이메일 비동기 처리 완료 대기
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`✅ Created ${events.length} notifications for user ${userId}`);
  console.log("Check Supabase Studio → notifications table");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
