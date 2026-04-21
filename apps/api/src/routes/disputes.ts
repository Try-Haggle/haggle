import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { disputeEvidence as disputeEvidenceTable, refunds as refundsTable, eq, and } from "@haggle/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { DisputeService, validateEvidenceForReasonCode, REASON_CODE_REGISTRY, computeDisputeCost, createDepositRequirement } from "@haggle/dispute-core";
import type { DisputeCase, DisputeEvidence, DisputeReasonCode, DisputeTier } from "@haggle/dispute-core";
import {
  createDisputeRecord,
  getDisputeById,
  getDisputeByOrderId,
  updateDisputeRecord,
  addDisputeEvidenceRecord,
  createDisputeResolutionRecord,
} from "../services/dispute-record.service.js";
import {
  createDisputeUploadUrl,
  disputeEvidenceExists,
  createDisputeViewUrl,
} from "../services/dispute-storage.service.js";
import {
  anchorDisputeOnChain,
  computeEvidenceMerkleRoot,
  computeResolutionHash,
} from "../chain/dispute-anchoring.js";
import {
  ALLOWED_EVIDENCE_TYPES,
  EVIDENCE_LIMITS,
  DISPUTE_VIEW_URL_TTL_SECONDS,
  isImageType,
  isVideoType,
  buildDisputeEvidencePath,
  validateDisputeStoragePath,
} from "../lib/dispute-storage-paths.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import {
  getDepositByDisputeId,
  createDeposit,
  getPendingExpiredDeposits,
  updateDepositStatus,
  updateDepositMetadata,
} from "../services/dispute-deposit.service.js";
import {
  getCommerceOrderByOrderId,
  getPaymentIntentByOrderId,
  getPaymentIntentRowById,
  updateCommerceOrderStatus,
  createRefundRecord,
} from "../services/payment-record.service.js";
import { createPaymentServiceFromEnv } from "../payments/providers.js";
import type { Refund } from "@haggle/payment-core";
import {
  initiateDepositCollection,
  confirmUsdcDeposit,
  type DepositPaymentRail,
} from "../payments/deposit-collector.js";
import { refundDeposit } from "../payments/deposit-refunder.js";
import { executeRefund } from "../payments/refund-executor.js";
import { isAddress } from "viem";

const openDisputeSchema = z.object({
  order_id: z.string(),
  reason_code: z.string(),
  opened_by: z.enum(["buyer", "seller", "system"]),
  evidence: z
    .array(
      z.object({
        submitted_by: z.enum(["buyer", "seller", "system"]),
        type: z.enum(["text", "image", "video", "tracking_snapshot", "payment_proof", "other"]),
        uri: z.string().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const addEvidenceSchema = z.object({
  submitted_by: z.enum(["buyer", "seller", "system"]),
  type: z.enum(["text", "image", "video", "tracking_snapshot", "payment_proof", "other"]),
  uri: z.string().optional(),
  text: z.string().optional(),
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(128),
  content_type: z.string(),
  file_size_bytes: z.number().int().min(1),
});

const commitEvidenceSchema = z.object({
  storage_path: z.string().min(1),
  type: z.enum(["image", "video"]),
  description: z.string().max(500).optional(),
});

const depositSchema = z.object({
  rail: z.enum(["usdc", "stripe", "mock"]).optional(),
  wallet_address: z.string().optional(),
});

const confirmUsdcSchema = z.object({
  wallet_address: z.string().min(1),
});

const escalateSchema = z.object({
  escalated_by: z.enum(["buyer", "seller", "system"]),
  reason: z.string().optional(),
});

const resolveDisputeSchema = z.object({
  outcome: z.enum(["buyer_favor", "seller_favor", "partial_refund"]),
  summary: z.string(),
  refund_amount_minor: z.number().optional(),
});

export function registerDisputeRoutes(app: FastifyInstance, db: Database) {
  const disputeService = new DisputeService();
  const paymentService = createPaymentServiceFromEnv();
  const { requireDisputeParty } = createOwnershipMiddleware(db);

  // POST /disputes — open a new dispute
  app.post("/disputes", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = openDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_DISPUTE_REQUEST", issues: parsed.error.issues });
    }

    // Verify requester is buyer or seller of the order — derive opened_by from role
    const order = await getCommerceOrderByOrderId(db, parsed.data.order_id);
    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    const userId = request.user!.id;
    let derivedOpenedBy: "buyer" | "seller" | "system";
    if (request.user?.role === "admin") {
      derivedOpenedBy = parsed.data.opened_by; // admin can specify
    } else if (userId === order.buyerId) {
      derivedOpenedBy = "buyer";
    } else if (userId === order.sellerId) {
      derivedOpenedBy = "seller";
    } else {
      return reply.code(403).send({ error: "FORBIDDEN", message: "You are not a party to this order" });
    }

    const reasonCode = parsed.data.reason_code as DisputeReasonCode;
    if (!(reasonCode in REASON_CODE_REGISTRY)) {
      return reply.code(400).send({ error: "INVALID_REASON_CODE", reason_code: parsed.data.reason_code });
    }

    const evidence = (parsed.data.evidence ?? []).map((e) => ({
      submitted_by: e.submitted_by,
      type: e.type,
      uri: e.uri,
      text: e.text,
    }));

    const result = disputeService.openCase({
      order_id: parsed.data.order_id,
      reason_code: reasonCode,
      opened_by: derivedOpenedBy,
      initial_evidence: evidence,
    });

    await createDisputeRecord(db, result.dispute);

    // Transition order to IN_DISPUTE
    await updateCommerceOrderStatus(db, parsed.data.order_id, "IN_DISPUTE");

    return reply.code(201).send(result);
  });

  // POST /disputes/deposits/expire — admin/cron: forfeit expired deposits
  // Registered BEFORE /:id routes to avoid route collision
  app.post("/disputes/deposits/expire", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const expired = await getPendingExpiredDeposits(db);
    let forfeited = 0;
    for (const deposit of expired) {
      await updateDepositStatus(db, deposit.id, "FORFEITED", { resolvedAt: new Date() });
      forfeited++;
    }
    return reply.send({ forfeited_count: forfeited });
  });

  // POST /disputes/:id/escalate — escalate T1→T2→T3 with auto deposit
  app.post<{ Params: { id: string } }>("/disputes/:id/escalate", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = escalateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_ESCALATE_REQUEST", issues: parsed.error.issues });
    }

    const dispute = await getDisputeById(db, id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    // Order already loaded by ownership middleware
    const order = (request as unknown as Record<string, unknown>).orderResource as
      { id: string; buyerId: string; sellerId: string; amountMinor?: unknown } | undefined
      ?? await getCommerceOrderByOrderId(db, dispute.order_id);

    // Determine current tier from metadata or default to T1
    const currentTier = (dispute.metadata as Record<string, unknown>)?.tier as number ?? 1;
    if (currentTier >= 3) {
      return reply.code(400).send({ error: "MAX_TIER_REACHED", message: "Cannot escalate beyond T3" });
    }

    const nextTier = (currentTier + 1) as DisputeTier;

    // Compute cost for next tier using dispute-core — use order amount as GMV basis
    const amountCents = order?.amountMinor
      ? parseInt(String(order.amountMinor))
      : 0;

    if (amountCents <= 0) {
      return reply.code(400).send({ error: "INVALID_DISPUTE_AMOUNT", message: "Order must have a positive amount for escalation" });
    }

    const cost = computeDisputeCost(amountCents, nextTier);

    // Update dispute metadata with new tier
    await updateDisputeRecord(db, {
      ...dispute,
      metadata: {
        ...(dispute.metadata as Record<string, unknown>),
        tier: nextTier,
        escalated_by: parsed.data.escalated_by,
        escalated_reason: parsed.data.reason ?? null,
      },
    });

    // For T2/T3: create deposit requirement (seller-only deposit)
    let deposit = null;
    if (nextTier >= 2) {
      const depositReq = createDepositRequirement(id, nextTier as 2 | 3, amountCents);
      deposit = await createDeposit(db, {
        disputeId: id,
        tier: nextTier,
        amountCents: depositReq.amount_cents,
        deadlineHours: depositReq.deadline_hours,
        deadlineAt: new Date(Date.now() + depositReq.deadline_hours * 60 * 60 * 1000),
      });
    }

    return reply.send({
      dispute_id: id,
      previous_tier: currentTier,
      new_tier: nextTier,
      cost,
      deposit,
    });
  });

  // GET /disputes/:id
  app.get("/disputes/:id", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }
    return reply.send({ dispute });
  });

  // GET /disputes/by-order/:orderId
  app.get("/disputes/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const dispute = await getDisputeByOrderId(db, (request.params as { orderId: string }).orderId);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    // Ownership check: requireDisputeParty reads :id param which this route lacks.
    // Inline check instead — admin always passes.
    if (request.user?.role !== "admin") {
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }
      const userId = request.user!.id;
      if (userId !== order.buyerId && userId !== order.sellerId) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }

    return reply.send({ dispute });
  });

  // POST /disputes/:id/review — start review
  app.post("/disputes/:id/review", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.startReview(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REVIEW_START_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-buyer-evidence
  app.post("/disputes/:id/request-buyer-evidence", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.requestBuyerEvidence(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REQUEST_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-seller-evidence
  app.post("/disputes/:id/request-seller-evidence", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.requestSellerEvidence(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REQUEST_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/evidence — add evidence
  app.post("/disputes/:id/evidence", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = addEvidenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_EVIDENCE", issues: parsed.error.issues });
    }

    try {
      const result = disputeService.addEvidence(dispute, parsed.data);
      await updateDisputeRecord(db, result.dispute);
      if (result.value) {
        await addDisputeEvidenceRecord(db, result.value);
      }

      // Validate evidence completeness
      const validation = validateEvidenceForReasonCode(
        dispute.reason_code as DisputeReasonCode,
        result.dispute.evidence,
      );

      return reply.send({ ...result, evidence_validation: validation });
    } catch (error) {
      return reply.code(400).send({
        error: "ADD_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/resolve — resolve the dispute
  app.post("/disputes/:id/resolve", { preHandler: [requireAdmin] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = resolveDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RESOLUTION", issues: parsed.error.issues });
    }

    try {
      const result = disputeService.resolve(dispute, parsed.data);
      await updateDisputeRecord(db, result.dispute);
      if (result.value) {
        await createDisputeResolutionRecord(db, dispute.id, result.value);
      }
      // Resolve buyer/seller from the commerce order
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);

      if (result.trust_triggers.length > 0) {
        await applyTrustTriggers(db, {
          order_id: dispute.order_id,
          buyer_id: order?.buyerId ?? "",
          seller_id: order?.sellerId ?? "",
          triggers: result.trust_triggers,
        });
      }

      // Auto-refund on buyer_favor / partial_refund; close on seller_favor
      let autoRefundResult = null;
      if (parsed.data.outcome === "buyer_favor" || parsed.data.outcome === "partial_refund") {
        const intent = await getPaymentIntentByOrderId(db, dispute.order_id);
        if (intent) {
          const refundAmountMinor =
            parsed.data.refund_amount_minor ?? intent.amount.amount_minor;
          const refund: Refund = {
            id:
              typeof globalThis.crypto?.randomUUID === "function"
                ? globalThis.crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            payment_intent_id: intent.id,
            amount: {
              currency: intent.amount.currency,
              amount_minor: refundAmountMinor,
            },
            reason_code: `dispute_${parsed.data.outcome}`,
            status: "REQUESTED",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          try {
            autoRefundResult = await paymentService.refundIntent(intent, refund);
            await createRefundRecord(
              db,
              autoRefundResult.refund,
              typeof autoRefundResult.metadata?.provider_reference === "string"
                ? autoRefundResult.metadata.provider_reference
                : null,
            );
          } catch {
            // Refund attempt failed — log but don't fail the resolution
          }

          // Fire-and-forget: execute real refund via USDC/Stripe/mock rail
          // Double-refund prevention: only execute if no completed refund exists
          const existingCompleted = await db
            .select({ id: refundsTable.id })
            .from(refundsTable)
            .where(and(
              eq(refundsTable.paymentIntentId, intent.id),
              eq(refundsTable.status, "COMPLETED"),
            ));

          if (existingCompleted.length === 0) {
            // Look up buyer's wallet address
            let buyerWalletAddress: string | undefined;
            try {
              const walletRow = await db.query.userWallets.findFirst({
                where: (fields, ops) => ops.and(
                  ops.eq(fields.userId, order?.buyerId ?? ""),
                  ops.eq(fields.isPrimary, true),
                ),
              });
              buyerWalletAddress = walletRow?.walletAddress;
            } catch {
              // Wallet lookup failed — continue without
            }

            // Determine rail from the original payment intent
            const refundRail = intent.selected_rail === "stripe" ? "stripe" as const : "usdc" as const;

            // Get Stripe PI if applicable
            let stripePaymentIntentId: string | undefined;
            if (refundRail === "stripe") {
              try {
                const intentRow = await getPaymentIntentRowById(db, intent.id);
                const provCtx = intentRow?.providerContext as Record<string, unknown> | null;
                stripePaymentIntentId = provCtx?.stripe_payment_intent_id as string | undefined;
              } catch {
                // Provider context lookup failed
              }
            }

            executeRefund({
              order_id: dispute.order_id,
              buyer_wallet_address: buyerWalletAddress,
              amount_cents: refundAmountMinor,
              rail: refundRail,
              reason: `dispute_${parsed.data.outcome}`,
              stripe_payment_intent_id: stripePaymentIntentId,
            })
              .then(async (refundExecResult) => {
                try {
                  await db
                    .update(refundsTable)
                    .set({
                      status: "COMPLETED",
                      providerReference: refundExecResult.tx_hash ?? refundExecResult.refund_id ?? null,
                      updatedAt: new Date(),
                    })
                    .where(eq(refundsTable.id, refund.id));
                } catch (updateErr) {
                  console.error(
                    "[disputes] Refund record update failed:",
                    updateErr instanceof Error ? updateErr.message : String(updateErr),
                  );
                }
              })
              .catch((refundErr) => {
                console.error(
                  "[disputes] Real refund execution failed (fire-and-forget):",
                  refundErr instanceof Error ? refundErr.message : String(refundErr),
                );
              });
          }
        }
        await updateCommerceOrderStatus(db, dispute.order_id, "REFUNDED");
      } else if (parsed.data.outcome === "seller_favor") {
        await updateCommerceOrderStatus(db, dispute.order_id, "CLOSED");

        // Refund deposit to seller (fire-and-forget)
        const deposit = await getDepositByDisputeId(db, dispute.id);
        if (deposit && deposit.status === "DEPOSITED") {
          const depositMeta = deposit.metadata as Record<string, unknown> | null;
          const depositRail = (depositMeta?.rail as DepositPaymentRail) ?? "mock";

          refundDeposit({
            deposit_id: deposit.id,
            amount_cents: deposit.amountCents,
            seller_wallet_address: depositMeta?.wallet_address as string | undefined,
            stripe_payment_intent_id: depositMeta?.stripe_payment_intent_id as string | undefined,
            rail: depositRail,
          })
            .then(async (refundResult) => {
              await updateDepositStatus(db, deposit.id, "REFUNDED", {
                resolvedAt: new Date(),
                metadata: {
                  ...(depositMeta ?? {}),
                  refund_tx_hash: refundResult.tx_hash,
                  refund_id: refundResult.refund_id,
                  refunded_at: new Date().toISOString(),
                },
              });
            })
            .catch((refundErr) => {
              console.error(
                "[disputes] Deposit refund failed (fire-and-forget):",
                refundErr instanceof Error ? refundErr.message : String(refundErr),
              );
            });
        }
      }

      // Fire-and-forget: anchor dispute resolution on-chain.
      // Never awaited — anchoring failure must not block the HTTP response.
      if (result.value) {
        try {
          const evidenceRootHash = computeEvidenceMerkleRoot(dispute.evidence);
          const resolutionHash = computeResolutionHash(result.value);

          // Store pending anchor metadata before the async call
          await updateDisputeRecord(db, {
            ...result.dispute,
            metadata: {
              ...(result.dispute.metadata as Record<string, unknown> ?? {}),
              pending_anchor: true,
              anchor_evidence_root: evidenceRootHash,
              anchor_resolution_hash: resolutionHash,
            },
          });

          // Fire-and-forget — do NOT await
          anchorDisputeOnChain({
            orderId: dispute.order_id,
            disputeCaseId: dispute.id,
            evidence: dispute.evidence,
            resolution: result.value,
          }).catch((anchorErr) => {
            console.error(
              "[disputes] On-chain anchoring failed (fire-and-forget):",
              anchorErr instanceof Error ? anchorErr.message : String(anchorErr),
            );
          });
        } catch (anchorSetupErr) {
          // Setup failure (metadata update, hash computation) — log and continue
          console.error(
            "[disputes] Anchor setup failed:",
            anchorSetupErr instanceof Error ? anchorSetupErr.message : String(anchorSetupErr),
          );
        }
      }

      return reply.send({ ...result, auto_refund: autoRefundResult });
    } catch (error) {
      return reply.code(400).send({
        error: "RESOLUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/close — close the dispute
  app.post("/disputes/:id/close", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.closeCase(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "CLOSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/deposit — initiate deposit payment collection
  app.post<{ Params: { id: string } }>("/disputes/:id/deposit", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = depositSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_DEPOSIT_REQUEST", issues: parsed.error.issues });
    }

    // 1. Validate deposit exists and is PENDING
    const deposit = await getDepositByDisputeId(db, id);
    if (!deposit) {
      return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
    }

    if (deposit.status !== "PENDING") {
      return reply.code(400).send({ error: "DEPOSIT_ALREADY_PROCESSED", message: `Deposit status is ${deposit.status}` });
    }

    // 2. Validate caller is the seller (deposits are seller-only)
    const order = (request as unknown as Record<string, unknown>).orderResource as
      { id: string; buyerId: string; sellerId: string; amountMinor?: unknown } | undefined;
    const userId = request.user!.id;
    if (order && userId !== order.sellerId) {
      return reply.code(403).send({ error: "SELLER_ONLY", message: "Only the seller can post a deposit" });
    }

    // 3. Validate wallet address if provided (for USDC rail)
    if (parsed.data.wallet_address && !isAddress(parsed.data.wallet_address)) {
      return reply.code(400).send({ error: "INVALID_WALLET_ADDRESS", message: "wallet_address must be a valid Ethereum address" });
    }

    // 4. Amount is ALWAYS server-computed — never trust client
    const amountCents = deposit.amountCents;

    // 5. Initiate deposit collection
    try {
      const result = await initiateDepositCollection({
        deposit_id: deposit.id,
        dispute_id: id,
        amount_cents: amountCents,
        seller_wallet_address: parsed.data.wallet_address,
        seller_user_id: userId,
      });

      const rail = result.rail;

      if (rail === "mock") {
        // Mock: immediately mark as DEPOSITED
        const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
          depositedAt: new Date(),
          metadata: {
            ...(deposit.metadata ?? {}),
            rail,
            mock_tx_id: result.mock_tx_id,
          },
        });
        return reply.send({ deposit: updated, collection: result });
      }

      if (rail === "usdc") {
        // USDC: update metadata with approval instructions, status stays PENDING
        await updateDepositMetadata(db, deposit.id, {
          ...(deposit.metadata ?? {}),
          rail,
          wallet_address: parsed.data.wallet_address,
          usdc_approval: result.usdc_approval,
        });
        return reply.send({ deposit: { ...deposit, metadata: { ...(deposit.metadata ?? {}), rail } }, collection: result });
      }

      if (rail === "stripe") {
        // Stripe: update metadata with session info, status stays PENDING
        await updateDepositMetadata(db, deposit.id, {
          ...(deposit.metadata ?? {}),
          rail,
          stripe_payment_intent_id: result.stripe_payment_intent_id,
        });
        return reply.send({ deposit: { ...deposit, metadata: { ...(deposit.metadata ?? {}), rail } }, collection: result });
      }

      // Should not reach here
      return reply.send({ deposit, collection: result });
    } catch (error) {
      return reply.code(500).send({
        error: "DEPOSIT_COLLECTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/deposit/confirm-usdc — confirm USDC deposit after seller approved spend
  app.post<{ Params: { id: string } }>("/disputes/:id/deposit/confirm-usdc", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = confirmUsdcSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONFIRM_REQUEST", issues: parsed.error.issues });
    }

    // 1. Validate wallet address
    if (!isAddress(parsed.data.wallet_address)) {
      return reply.code(400).send({ error: "INVALID_WALLET_ADDRESS", message: "wallet_address must be a valid Ethereum address" });
    }

    // 2. Validate deposit exists and is PENDING
    const deposit = await getDepositByDisputeId(db, id);
    if (!deposit) {
      return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
    }

    if (deposit.status !== "PENDING") {
      return reply.code(400).send({ error: "DEPOSIT_ALREADY_PROCESSED", message: `Deposit status is ${deposit.status}` });
    }

    // 3. Validate the deposit was initiated with USDC rail
    const depositMeta = deposit.metadata as Record<string, unknown> | null;
    if (depositMeta?.rail !== "usdc") {
      return reply.code(400).send({ error: "WRONG_RAIL", message: "This deposit was not initiated with USDC rail" });
    }

    // 4. Validate caller is the seller
    const order = (request as unknown as Record<string, unknown>).orderResource as
      { id: string; buyerId: string; sellerId: string; amountMinor?: unknown } | undefined;
    const userId = request.user!.id;
    if (order && userId !== order.sellerId) {
      return reply.code(403).send({ error: "SELLER_ONLY", message: "Only the seller can confirm a deposit" });
    }

    // 5. Amount is server-computed — use the stored deposit amount
    const amountCents = deposit.amountCents;

    try {
      // 6. Execute transferFrom via gas relayer (verifies allowance on-chain)
      const { tx_hash } = await confirmUsdcDeposit({
        deposit_id: deposit.id,
        seller_wallet_address: parsed.data.wallet_address,
        amount_cents: amountCents,
      });

      // 7. Mark deposit as DEPOSITED
      const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
        depositedAt: new Date(),
        metadata: {
          ...(depositMeta ?? {}),
          tx_hash,
          confirmed_at: new Date().toISOString(),
        },
      });

      return reply.send({ deposit: updated, tx_hash });
    } catch (error) {
      return reply.code(500).send({
        error: "USDC_DEPOSIT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /disputes/:id/deposit — get deposit for a dispute
  app.get<{ Params: { id: string } }>("/disputes/:id/deposit", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const deposit = await getDepositByDisputeId(db, id);
    if (!deposit) {
      return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
    }
    return reply.send({ deposit });
  });

  // ---------------------------------------------------------------------------
  // Evidence file upload endpoints
  // ---------------------------------------------------------------------------

  /** States in which evidence submission is still accepted. */
  const EVIDENCE_ACCEPTING_STATES = new Set([
    "OPEN",
    "UNDER_REVIEW",
    "WAITING_FOR_BUYER",
    "WAITING_FOR_SELLER",
  ]);

  /**
   * Count existing evidence records for a dispute, grouped by media category.
   */
  async function countEvidenceByType(
    disputeId: string,
  ): Promise<{ imageCount: number; videoCount: number }> {
    const rows = await db
      .select({
        type: disputeEvidenceTable.type,
      })
      .from(disputeEvidenceTable)
      .where(eq(disputeEvidenceTable.disputeId, disputeId));

    let imageCount = 0;
    let videoCount = 0;
    for (const row of rows) {
      if (row.type === "image") imageCount++;
      if (row.type === "video") videoCount++;
    }
    return { imageCount, videoCount };
  }

  /**
   * Compute remaining upload limits for a dispute given its current evidence
   * and the associated order amount.
   */
  function computeRemainingLimits(
    imageCount: number,
    videoCount: number,
    orderAmountCents: number,
  ) {
    const isHighValue =
      orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
    const videoLimits = isHighValue
      ? EVIDENCE_LIMITS.video_high_value
      : EVIDENCE_LIMITS.video_standard;

    return {
      remaining_images: Math.max(0, EVIDENCE_LIMITS.image.maxCount - imageCount),
      remaining_videos: Math.max(0, videoLimits.maxCount - videoCount),
      max_video_size_bytes: videoLimits.maxSizeBytes,
      max_video_duration_sec: videoLimits.maxDurationSec,
    };
  }

  // POST /disputes/:id/evidence/upload-url — Get a presigned upload URL
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/upload-url",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = uploadUrlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_UPLOAD_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const { filename, content_type, file_size_bytes } = parsed.data;

      // 1. Validate dispute exists and is in an evidence-accepting state
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }

      // 2. Validate content_type
      if (
        !(ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(content_type)
      ) {
        return reply.code(400).send({
          error: "UNSUPPORTED_CONTENT_TYPE",
          message: `Allowed: ${ALLOWED_EVIDENCE_TYPES.join(", ")}`,
        });
      }

      // 3. Determine media category
      const isImage = isImageType(content_type);
      const isVideo = isVideoType(content_type);

      // 4. Get order amount for video tier determination
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as {
          id: string;
          buyerId: string;
          sellerId: string;
          amountMinor?: unknown;
        } | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

      const orderAmountCents = order?.amountMinor
        ? parseInt(String(order.amountMinor))
        : 0;

      // 5. Count existing evidence and check limits
      const { imageCount, videoCount } = await countEvidenceByType(id);
      const limits = computeRemainingLimits(
        imageCount,
        videoCount,
        orderAmountCents,
      );

      if (isImage) {
        if (limits.remaining_images <= 0) {
          return reply.code(400).send({
            error: "IMAGE_LIMIT_REACHED",
            message: `Maximum ${EVIDENCE_LIMITS.image.maxCount} images allowed`,
          });
        }
        if (file_size_bytes > EVIDENCE_LIMITS.image.maxSizeBytes) {
          return reply.code(400).send({
            error: "FILE_TOO_LARGE",
            message: `Image max size: ${EVIDENCE_LIMITS.image.maxSizeBytes} bytes`,
          });
        }
      }

      if (isVideo) {
        if (limits.remaining_videos <= 0) {
          const isHighValue =
            orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
          const maxCount = isHighValue
            ? EVIDENCE_LIMITS.video_high_value.maxCount
            : EVIDENCE_LIMITS.video_standard.maxCount;
          return reply.code(400).send({
            error: "VIDEO_LIMIT_REACHED",
            message: `Maximum ${maxCount} video(s) allowed for this transaction`,
          });
        }
        if (file_size_bytes > limits.max_video_size_bytes) {
          return reply.code(400).send({
            error: "FILE_TOO_LARGE",
            message: `Video max size: ${limits.max_video_size_bytes} bytes`,
          });
        }
      }

      // 6. Generate presigned upload URL
      const evidenceId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const objectPath = buildDisputeEvidencePath(
        id,
        `${evidenceId}_${filename}`,
      );
      const result = await createDisputeUploadUrl(objectPath);

      // Recompute limits after this upload (optimistic)
      const newLimits = computeRemainingLimits(
        imageCount + (isImage ? 1 : 0),
        videoCount + (isVideo ? 1 : 0),
        orderAmountCents,
      );

      return reply.send({
        upload_url: result.uploadUrl,
        storage_path: result.storagePath,
        token: result.token,
        expires_in: result.expiresIn,
        limits: newLimits,
      });
    },
  );

  // POST /disputes/:id/evidence/commit — Commit an uploaded file as evidence
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/commit",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = commitEvidenceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_COMMIT_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const { storage_path, type, description } = parsed.data;

      // 1. Validate dispute
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }

      // 2. Validate & normalize the storage path
      let normalizedPath: string;
      try {
        normalizedPath = validateDisputeStoragePath(id, storage_path);
      } catch (err) {
        return reply.code(400).send({
          error: "INVALID_STORAGE_PATH",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // 3. Verify file exists in storage
      const exists = await disputeEvidenceExists(normalizedPath);
      if (!exists) {
        return reply.code(400).send({
          error: "FILE_NOT_FOUND",
          message: "File does not exist in storage. Upload it first.",
        });
      }

      // 4. Determine submitted_by from user's role on the order
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as {
          id: string;
          buyerId: string;
          sellerId: string;
          amountMinor?: unknown;
        } | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

      const userId = request.user!.id;
      let submittedBy: "buyer" | "seller";
      if (userId === order?.buyerId) {
        submittedBy = "buyer";
      } else if (userId === order?.sellerId) {
        submittedBy = "seller";
      } else {
        // Admin submitting — default to system, but schema only allows buyer/seller
        // for file evidence. Admin case should not reach here due to middleware.
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Cannot determine party role",
        });
      }

      // 5. Create evidence record
      const evidenceId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const evidence: DisputeEvidence = {
        id: evidenceId,
        dispute_id: id,
        submitted_by: submittedBy,
        type,
        uri: storage_path,
        text: description,
        created_at: new Date().toISOString(),
      };

      await addDisputeEvidenceRecord(db, evidence);

      // 6. Run evidence validation
      const allEvidence = [...dispute.evidence, evidence];
      const validation = validateEvidenceForReasonCode(
        dispute.reason_code as DisputeReasonCode,
        allEvidence,
      );

      // 7. Compute remaining limits
      const orderAmountCents = order?.amountMinor
        ? parseInt(String(order.amountMinor))
        : 0;
      const { imageCount, videoCount } = await countEvidenceByType(id);
      const limits = computeRemainingLimits(
        imageCount,
        videoCount,
        orderAmountCents,
      );

      return reply.code(201).send({
        evidence,
        evidence_validation: validation,
        limits,
      });
    },
  );

  // GET /disputes/:id/evidence/:evidenceId/view — Get a signed view URL
  app.get<{ Params: { id: string; evidenceId: string } }>(
    "/disputes/:id/evidence/:evidenceId/view",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id, evidenceId } = request.params;

      // Look up the evidence record
      const rows = await db
        .select()
        .from(disputeEvidenceTable)
        .where(
          and(
            eq(disputeEvidenceTable.id, evidenceId),
            eq(disputeEvidenceTable.disputeId, id),
          ),
        );

      if (rows.length === 0) {
        return reply.code(404).send({ error: "EVIDENCE_NOT_FOUND" });
      }

      const evidenceRow = rows[0];
      if (!evidenceRow.uri) {
        return reply.code(400).send({
          error: "NO_FILE_URI",
          message: "This evidence record has no associated file",
        });
      }

      // Strip bucket prefix if present to get the inner object path
      const BUCKET_PREFIX = "dispute-evidence/";
      const objectPath = evidenceRow.uri.startsWith(BUCKET_PREFIX)
        ? evidenceRow.uri.slice(BUCKET_PREFIX.length)
        : evidenceRow.uri;

      const viewUrl = await createDisputeViewUrl(objectPath);

      return reply.send({
        view_url: viewUrl,
        expires_in: DISPUTE_VIEW_URL_TTL_SECONDS,
      });
    },
  );
}
