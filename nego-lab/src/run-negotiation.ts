// The reusable engine: run ONE ScenarioCase through the real guest flow
// (seed listing → POST /negotiations/start → auto-play loop) and capture the
// result. Extracted from apps/api/scripts/smoke-negolab.ts.
import { randomUUID } from "node:crypto";
import { eq, listingDrafts, negotiationRounds } from "@haggle/db";
import { publishDraft } from "../../apps/api/src/services/draft.service.js";
import type { LabContext } from "./harness.js";
import type { NegotiationResult, RoundRecord, ScenarioCase } from "./types.js";

const AUTO_PLAY_SAFETY_CAP = 12; // matches the server's 8-round cap with headroom

/** Seed a published seller listing for the case; returns the public id. */
async function seedListing(ctx: LabContext, c: ScenarioCase): Promise<string> {
  const { db } = ctx;
  const [draft] = await db.insert(listingDrafts).values({ status: "draft" }).returning();
  const sellerId = randomUUID();
  await db
    .update(listingDrafts)
    .set({
      userId: sellerId, // no FK — any uuid marks the listing as claimed
      title: c.item.title,
      category: c.item.category,
      condition: c.item.condition,
      targetPrice: c.item.askPrice.toFixed(2),
      floorPrice: c.item.floorPrice.toFixed(2),
      sellingDeadline: new Date(Date.now() + c.item.deadlineHours * 60 * 60 * 1000),
      negotiationAgentSnapshot: {
        preset: c.seller.agent,
        // MVP: phone attributes reach the LLM via phoneAnswers (extractListingContext).
        phoneAnswers: c.item.attributes,
      },
      updatedAt: new Date(),
    })
    .where(eq(listingDrafts.id, draft.id));

  const published = await publishDraft(db, draft.id);
  if (!published?.publicId) throw new Error("publishDraft returned no publicId");
  return published.publicId;
}

export async function runNegotiation(
  ctx: LabContext,
  c: ScenarioCase,
  repeatIndex = 0,
): Promise<NegotiationResult> {
  const started = Date.now();
  const base: NegotiationResult = {
    caseId: c.id,
    group: c.group,
    label: c.label,
    repeatIndex,
    sellerAgent: c.seller.agent,
    buyerAgent: c.buyer.agent,
    askPrice: c.item.askPrice,
    floorPrice: c.item.floorPrice,
    budgetMax: c.buyer.budgetMax,
    targetPrice: c.buyer.targetPrice,
    attributes: c.item.attributes,
    outcome: "ERROR",
    finalPriceMinor: null,
    finalPrice: null,
    rounds: 0,
    transcript: [],
    startStatus: 0,
    durationMs: 0,
  };

  try {
    const publicId = await seedListing(ctx, c);
    base.publicId = publicId;

    const startRes = await ctx.app.inject({
      method: "POST",
      url: "/negotiations/start",
      payload: {
        listing_public_id: publicId,
        negotiation_agent_preset_id: c.buyer.agent,
        negotiation_agent_builder_memory: {
          budgetMax: c.buyer.budgetMax,
          targetPrice: c.buyer.targetPrice,
        },
        deadline_hours: c.buyer.deadlineHours ?? 48,
      },
    });
    base.startStatus = startRes.statusCode;
    if (startRes.statusCode !== 202) {
      base.error = `start failed: ${startRes.body}`;
      base.durationMs = Date.now() - started;
      return base;
    }
    const { session_id, run_token } = startRes.json() as {
      session_id: string;
      run_token: string;
    };
    base.sessionId = session_id;

    let complete = false;
    let guard = 0;
    let lastStatus = "ACTIVE";
    while (!complete && guard < AUTO_PLAY_SAFETY_CAP) {
      guard++;
      const res = await ctx.app.inject({
        method: "POST",
        url: `/negotiations/sessions/${session_id}/auto-play/next`,
        payload: { run_token },
      });
      const body = res.json() as { complete?: boolean; session_status?: string };
      lastStatus = body.session_status ?? lastStatus;
      complete = body.complete === true;
      if (res.statusCode >= 400) {
        base.error = `auto-play http ${res.statusCode}: ${res.body}`;
        break;
      }
    }
    base.outcome = lastStatus;

    // Read back committed rounds for the transcript + final price.
    const rows = await ctx.db
      .select()
      .from(negotiationRounds)
      .where(eq(negotiationRounds.sessionId, session_id));
    const transcript: RoundRecord[] = rows
      .map((r) => ({
        roundNo: r.roundNo,
        senderRole: r.senderRole,
        messageType: r.messageType,
        priceMinor: r.priceminor != null ? Number(r.priceminor) : null,
        counterPriceMinor: r.counterPriceMinor != null ? Number(r.counterPriceMinor) : null,
        decision: r.decision ?? null,
        llmTokensUsed: r.llmTokensUsed ?? null,
        message: r.message ?? null,
      }))
      .sort((a, b) => a.roundNo - b.roundNo);
    base.transcript = transcript;
    base.rounds = transcript.length;

    if (base.outcome === "ACCEPTED") {
      // Final agreed price = the price on the last round carrying a price.
      const priced = [...transcript].reverse().find((r) => r.priceMinor != null);
      if (priced?.priceMinor != null) {
        base.finalPriceMinor = priced.priceMinor;
        base.finalPrice = priced.priceMinor / 100;
      }
    }
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  }
  base.durationMs = Date.now() - started;
  return base;
}
