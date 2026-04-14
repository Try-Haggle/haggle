import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@haggle/db";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import {
  createDraft,
  getDraftById,
  patchDraft,
  validateDraft,
  publishDraft,
  claimListing,
} from "../../services/draft.service.js";
import { uploadListingPhoto } from "../../lib/supabase-storage.js";
import { LISTING_RESOURCE_URI } from "../resources.js";
import { createSession, getSessionById } from "../../services/negotiation-session.service.js";
import { executeNegotiationRound } from "../../lib/negotiation-executor.js";
import type { EventDispatcher } from "../../lib/event-dispatcher.js";

/**
 * Register all MCP tools with the server.
 * Tools that trigger UI use registerAppTool (ext-apps SDK).
 * Data-only tools use server.tool() (core MCP SDK).
 */
export function registerTools(server: McpServer, db: Database, eventDispatcher?: EventDispatcher) {
  // ─── haggle_ping ─────────────────────────────────────────
  server.tool(
    "haggle_ping",
    "Health check tool. Returns server status and timestamp. Use this to verify the Haggle MCP server is connected and responding.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ok",
            message: "Haggle MCP server is connected!",
            timestamp: new Date().toISOString(),
            version: "0.1.0",
          }),
        },
      ],
    }),
  );

  // ─── haggle_start_draft ────────────────────────────────────
  // Opens the listing wizard widget in the host iframe.
  registerAppTool(
    server,
    "haggle_start_draft",
    {
      title: "Start Draft",
      description:
        "Start a new listing draft for selling an item. Opens the listing wizard UI where the user fills in details step by step. IMPORTANT: If the user provided specific item details (e.g. title, price, condition) in the same message, you may call haggle_apply_patch right after to populate those fields. But if the user only said something vague like 'I want to sell something' without concrete details, do NOT call haggle_apply_patch. Instead, let them use the wizard UI or ask for more details in chat.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: LISTING_RESOURCE_URI },
        "openai/outputTemplate": LISTING_RESOURCE_URI,
        "openai/widgetAccessible": true,
      },
    },
    async () => {
      const draft = await createDraft(db);
      return {
        structuredContent: {
          draft_id: draft.id,
          draft,
        },
        content: [
          {
            type: "text" as const,
            text: "Draft created! Fill in the item details in the form.",
          },
        ],
      };
    },
  );

  // ─── haggle_get_draft ──────────────────────────────────────
  server.tool(
    "haggle_get_draft",
    "Retrieve the current state of a listing draft by its ID.",
    { draft_id: z.string().uuid() },
    async ({ draft_id }) => {
      const draft = await getDraftById(db, draft_id);
      if (!draft) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Draft not found", draft_id }),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ draft_id, draft }),
          },
        ],
      };
    },
  );

  // ─── haggle_apply_patch ────────────────────────────────────
  // Callable from both the model and the widget (visibility: ["model", "app"]).
  registerAppTool(
    server,
    "haggle_apply_patch",
    {
      title: "Apply Patch",
      description:
        "Update fields on an existing listing draft. IMPORTANT: Bundle ALL mentioned fields into a single call — do NOT split into multiple calls. Only call this when the user explicitly mentions specific details (title, price, condition, etc.) in the conversation, or when the widget UI sends a patch. Do NOT guess or auto-fill fields that the user has not mentioned. Allowed fields: title, description, tags, category, condition, photoUrl, targetPrice, floorPrice, sellingDeadline, strategyConfig.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        draft_id: z.string().uuid(),
        patch: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          category: z
            .enum([
              "electronics",
              "clothing",
              "furniture",
              "collectibles",
              "sports",
              "vehicles",
              "books",
              "other",
            ])
            .optional(),
          condition: z
            .enum(["new", "like_new", "good", "fair", "poor"])
            .optional(),
          photoUrl: z.string().optional(),
          targetPrice: z.string().optional(),
          floorPrice: z.string().optional(),
          sellingDeadline: z.string().datetime().optional(),
          strategyConfig: z.record(z.unknown()).optional(),
        }),
      },
      _meta: {
        ui: {
          resourceUri: LISTING_RESOURCE_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": LISTING_RESOURCE_URI,
        "openai/widgetAccessible": true,
      },
    },
    async ({ draft_id, patch }) => {
      // Convert ISO string to Date for timestamp field
      const servicePatch = {
        ...patch,
        sellingDeadline: patch.sellingDeadline
          ? new Date(patch.sellingDeadline)
          : undefined,
      };

      const draft = await patchDraft(db, draft_id, servicePatch);
      if (!draft) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Draft not found", draft_id }),
            },
          ],
        };
      }
      return {
        structuredContent: { draft_id, draft },
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ draft_id, draft }),
          },
        ],
      };
    },
  );

  // ─── haggle_validate_draft ──────────────────────────────────
  server.tool(
    "haggle_validate_draft",
    "Validate a listing draft before publishing. Checks that all required fields (title, asking price, selling deadline) are filled in. Returns ok: true if valid, or a list of errors with the step number to navigate to for fixing. Call this before haggle_publish_listing.",
    { draft_id: z.string().uuid() },
    async ({ draft_id }) => {
      const draft = await getDraftById(db, draft_id);
      if (!draft) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Draft not found", draft_id }),
            },
          ],
        };
      }

      const errors = validateDraft(draft);
      if (errors.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, errors, draft_id }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, draft_id }),
          },
        ],
      };
    },
  );

  // ─── haggle_publish_listing ────────────────────────────────
  registerAppTool(
    server,
    "haggle_publish_listing",
    {
      title: "Publish Listing",
      description:
        "Publish a validated listing draft. This creates a public share link that buyers can use to start negotiation. IMPORTANT: Always call haggle_validate_draft first. If validation fails, do NOT call this tool — instead guide the user to fix the missing fields. On success, the widget will show the 'Listing Live' screen with the share link.",
      inputSchema: {
        draft_id: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: LISTING_RESOURCE_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": LISTING_RESOURCE_URI,
        "openai/widgetAccessible": true,
      },
    },
    async ({ draft_id }) => {
      // Pre-validate
      const draft = await getDraftById(db, draft_id);
      if (!draft) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Draft not found", draft_id }),
            },
          ],
        };
      }

      const errors = validateDraft(draft);
      if (errors.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Validation failed — call haggle_validate_draft first",
                errors,
                draft_id,
              }),
            },
          ],
        };
      }

      try {
        const result = await publishDraft(db, draft_id);
        if (!result) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Draft not found", draft_id }),
              },
            ],
          };
        }

        return {
          structuredContent: {
            draft_id,
            public_id: result.publicId,
            share_url: result.shareUrl,
            claim_token: result.claimToken,
            claim_expires_at: result.claimExpiresAt,
            draft: result.draft,
          },
          content: [
            {
              type: "text" as const,
              text: `Listing published! Share link: ${result.shareUrl}`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : "Publish failed",
                draft_id,
              }),
            },
          ],
        };
      }
    },
  );

  // ─── haggle_upload_photo ─────────────────────────────────
  // Widget-only tool: receives base64 image, uploads to Supabase Storage,
  // patches draft.photoUrl with the public URL.
  registerAppTool(
    server,
    "haggle_upload_photo",
    {
      title: "Upload Photo",
      description:
        "Upload a listing photo. Receives a base64-encoded image from the widget, stores it in Supabase Storage, and updates the draft's photoUrl. This tool is called automatically by the widget when the user selects a photo — do NOT call it from the model.",
      inputSchema: {
        draft_id: z.string().uuid(),
        image_base64: z
          .string()
          .describe("Base64-encoded image data (without data URI prefix)"),
        mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: {
          resourceUri: LISTING_RESOURCE_URI,
          visibility: ["app"],
        },
        "openai/outputTemplate": LISTING_RESOURCE_URI,
        "openai/widgetAccessible": true,
      },
    },
    async ({ draft_id, image_base64, mime_type }) => {
      try {
        const { publicUrl } = await uploadListingPhoto(
          draft_id,
          image_base64,
          mime_type,
        );

        // Patch draft with the uploaded photo URL
        const draft = await patchDraft(db, draft_id, { photoUrl: publicUrl });
        if (!draft) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Draft not found", draft_id }),
              },
            ],
          };
        }

        return {
          structuredContent: { draft_id, photo_url: publicUrl, draft },
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ draft_id, photo_url: publicUrl }),
            },
          ],
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Photo upload failed";
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message, draft_id }),
            },
          ],
        };
      }
    },
  );

  // ─── haggle_create_negotiation_session ───────────────────
  // 구매자 AI 에이전트가 리스팅을 보고 협상 세션을 시작
  server.tool(
    "haggle_create_negotiation_session",
    `Start a negotiation session for a listing as a buyer.

HOW TO DECIDE PARAMETERS — read the conversation carefully:
- If the user says something simple like "negotiate for me" or "get me a good deal" → use ONLY the required fields (listing_id, buyer_id, seller_id, max_price, target_price). Defaults will handle everything else.
- If the user expresses preferences like "I'm not in a rush", "I want to be aggressive", "price is all I care about", "I trust this seller" → map those to the optional strategy fields:
  • "aggressive" / "lowball" → lower target_price, higher concession_beta (0.3-0.5), higher accept_threshold (0.82+)
  • "patient" / "not in a rush" → longer deadline_hours (48-72), lower alpha_time (0.1-0.15)
  • "price is everything" → higher alpha_price (0.5-0.6), lower alpha_reputation (0.1)
  • "I trust this seller" / high reputation → higher alpha_reputation (0.3), lower accept_threshold (0.7)
  • "quick deal" / "just get it done" → shorter deadline, lower accept_threshold (0.65-0.7), higher concession_beta (0.7-0.9)
  • "firm" / "don't budge much" → lower concession_beta (0.2-0.4), lower concession_k (0.5-0.8)

Only fill in the optional fields you can confidently infer. Leave the rest as defaults.`,
    {
      // ── Required ──
      listing_id: z.string().uuid().describe("The listing to negotiate on"),
      buyer_id: z.string().uuid().describe("The buyer's user ID"),
      seller_id: z.string().uuid().describe("The seller's user ID"),
      max_price: z.number().positive().describe("Maximum price the buyer is willing to pay (in cents). This is the walk-away point."),
      target_price: z.number().positive().describe("Ideal price the buyer wants to achieve (in cents). Should be lower than max_price."),

      // ── Optional: Timing ──
      deadline_hours: z.number().positive().optional().describe("Negotiation deadline in hours. Default 24. Patient buyers: 48-72. Urgent: 6-12."),

      // ── Optional: Priority weights (must sum to ~1.0) ──
      alpha_price: z.number().min(0).max(1).optional().describe("How much the buyer cares about price. Default 0.4. Range 0.2-0.6."),
      alpha_time: z.number().min(0).max(1).optional().describe("How much time pressure matters. Default 0.25. Patient: 0.1. Urgent: 0.4."),
      alpha_reputation: z.number().min(0).max(1).optional().describe("How much seller trust matters. Default 0.2. Trusted seller: 0.3. Unknown: 0.1."),
      alpha_satisfaction: z.number().min(0).max(1).optional().describe("How much overall deal satisfaction matters. Default 0.15."),

      // ── Optional: Decision thresholds ──
      accept_threshold: z.number().min(0).max(1).optional().describe("Minimum utility to auto-accept. Default 0.78. Aggressive: 0.82+. Easy-going: 0.65-0.70."),
      counter_threshold: z.number().min(0).max(1).optional().describe("Minimum utility to counter (below = reject). Default 0.45."),
      reject_threshold: z.number().min(0).max(1).optional().describe("Below this utility, hard reject. Default 0.2."),
      near_deal_threshold: z.number().min(0).max(1).optional().describe("Utility level signaling 'almost there'. Default 0.72."),

      // ── Optional: Concession behavior ──
      concession_beta: z.number().min(0.1).max(1).optional().describe("How fast to concede. Default 0.6. Aggressive/firm: 0.2-0.4. Quick-deal: 0.7-0.9."),
      concession_k: z.number().min(0.1).max(3).optional().describe("Concession curve shape. Default 1.2. Firm early: 0.5-0.8. Front-loaded: 1.5-2.0."),

      // ── Optional: Negotiation style label ──
      style: z.enum(["balanced", "aggressive", "patient", "quick_deal", "firm"]).optional()
        .describe("Shortcut: sets multiple params at once. Can be overridden by individual fields above."),
    },
    async (params) => {
      try {
        const {
          listing_id, buyer_id, seller_id, max_price, target_price,
          style,
        } = params;

        // Style presets — individual params override these
        const presets = getStylePreset(style);

        const deadlineHours = params.deadline_hours ?? presets.deadline_hours ?? 24;
        const expiresAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

        const alphaPrice = params.alpha_price ?? presets.alpha_price ?? 0.4;
        const alphaTime = params.alpha_time ?? presets.alpha_time ?? 0.25;
        const alphaReputation = params.alpha_reputation ?? presets.alpha_reputation ?? 0.2;
        const alphaSatisfaction = params.alpha_satisfaction ?? presets.alpha_satisfaction ?? 0.15;

        const session = await createSession(db, {
          listingId: listing_id,
          strategyId: style ?? "buyer_default",
          role: "BUYER",
          buyerId: buyer_id,
          sellerId: seller_id,
          counterpartyId: seller_id,
          strategySnapshot: {
            role: "BUYER",
            p_reservation: max_price,
            p_target: target_price,
            p_initial: target_price,
            t_max: deadlineHours * 60 * 60 * 1000,
            alpha: {
              price: alphaPrice,
              time: alphaTime,
              reputation: alphaReputation,
              satisfaction: alphaSatisfaction,
            },
            thresholds: {
              accept: params.accept_threshold ?? presets.accept_threshold ?? 0.78,
              counter: params.counter_threshold ?? presets.counter_threshold ?? 0.45,
              reject: params.reject_threshold ?? presets.reject_threshold ?? 0.2,
              near_deal: params.near_deal_threshold ?? presets.near_deal_threshold ?? 0.72,
            },
            concession: {
              beta: params.concession_beta ?? presets.concession_beta ?? 0.6,
              k: params.concession_k ?? presets.concession_k ?? 1.2,
            },
          },
          expiresAt,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                session_id: session.id,
                status: session.status,
                listing_id,
                role: "BUYER",
                style: style ?? "balanced",
                strategy_summary: {
                  priority: `price ${Math.round(alphaPrice * 100)}% / time ${Math.round(alphaTime * 100)}% / trust ${Math.round(alphaReputation * 100)}% / satisfaction ${Math.round(alphaSatisfaction * 100)}%`,
                  accept_above: params.accept_threshold ?? presets.accept_threshold ?? 0.78,
                  concession_speed: params.concession_beta ?? presets.concession_beta ?? 0.6,
                },
                expires_at: expiresAt.toISOString(),
                message: "Negotiation session created. Use haggle_submit_offer to send your first offer.",
              }),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : "Failed to create session",
              }),
            },
          ],
        };
      }
    },
  );

  // ─── haggle_submit_offer ───────────────────────────────────
  // 구매자 AI 에이전트가 오퍼 제출. 엔진이 판매자측 카운터/수락/거절 결정.
  server.tool(
    "haggle_submit_offer",
    "Submit a price offer in an active negotiation session. The engine evaluates and returns a counter-offer, acceptance, or rejection. Include the session_id and your offer price in cents.",
    {
      session_id: z.string().uuid().describe("The negotiation session ID"),
      price_minor: z.number().int().positive().describe("Your offer price in cents (e.g. 5000 = $50.00)"),
      idempotency_key: z.string().min(1).describe("Unique key to prevent duplicate submissions"),
    },
    async ({ session_id, price_minor, idempotency_key }) => {
      try {
        const session = await getSessionById(db, session_id);
        if (!session) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify({ error: "SESSION_NOT_FOUND" }) }],
          };
        }

        const result = await executeNegotiationRound(
          db,
          {
            sessionId: session_id,
            offerPriceMinor: price_minor,
            senderRole: "BUYER",
            idempotencyKey: idempotency_key,
            roundData: {},
            nowMs: Date.now(),
          },
          eventDispatcher,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                round_id: result.roundId,
                round_no: result.roundNo,
                decision: result.decision,
                counter_price: result.outgoingPrice,
                utility: result.utility,
                session_status: result.sessionStatus,
                idempotent: result.idempotent,
                escalation: result.escalation
                  ? { type: result.escalation.type, context: result.escalation.context }
                  : undefined,
                message:
                  result.decision === "ACCEPT"
                    ? "Offer accepted! The deal is done."
                    : result.decision === "REJECT"
                      ? "Offer rejected. The negotiation has ended."
                      : result.decision === "NEAR_DEAL"
                        ? `Close to a deal! Counter-offer: ${result.outgoingPrice} cents. Consider accepting.`
                        : `Counter-offer: ${result.outgoingPrice} cents. Submit a new offer to continue negotiating.`,
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: message.startsWith("SESSION_") ? message : "ROUND_EXECUTION_FAILED",
                detail: message,
              }),
            },
          ],
        };
      }
    },
  );

  // ─── haggle_claim ────────────────────────────────────────
  // 리스팅 소유권을 사용자에게 연결 (24시간 내 claim token 검증)
  server.tool(
    "haggle_claim",
    "Claim ownership of a published listing using the claim token. The token was provided when the listing was published via haggle_publish_listing. Must be claimed within 24 hours before it expires. This links the listing to a real user account.",
    {
      claim_token: z.string().min(1).describe("The claim token returned by haggle_publish_listing"),
      user_id: z.string().uuid().describe("The authenticated user's ID to link to the listing"),
    },
    async ({ claim_token, user_id }) => {
      try {
        const result = await claimListing(db, claim_token, user_id);

        if (!result.ok) {
          const errorMessages: Record<string, string> = {
            invalid_token: "Claim token not found or listing is not published.",
            expired: "Claim token has expired (24-hour window). You need to re-publish the listing.",
            already_claimed: "This listing has already been claimed by another user.",
          };

          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: result.error,
                  message: errorMessages[result.error] ?? "Claim failed",
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                draft_id: result.draftId,
                user_id,
                message: "Listing claimed successfully! The listing is now linked to your account.",
              }),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : "Claim failed",
              }),
            },
          ],
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Style presets — maps a single keyword to a coherent strategy configuration
// ---------------------------------------------------------------------------

interface StylePreset {
  deadline_hours?: number;
  alpha_price?: number;
  alpha_time?: number;
  alpha_reputation?: number;
  alpha_satisfaction?: number;
  accept_threshold?: number;
  counter_threshold?: number;
  reject_threshold?: number;
  near_deal_threshold?: number;
  concession_beta?: number;
  concession_k?: number;
}

function getStylePreset(style?: string): StylePreset {
  switch (style) {
    case "aggressive":
      // 공격적: 낮은 가격 고집, 느린 양보, 높은 수락 기준
      return {
        alpha_price: 0.55, alpha_time: 0.2, alpha_reputation: 0.1, alpha_satisfaction: 0.15,
        accept_threshold: 0.83, counter_threshold: 0.5, reject_threshold: 0.25, near_deal_threshold: 0.76,
        concession_beta: 0.35, concession_k: 0.7,
      };

    case "patient":
      // 인내형: 시간 여유, 느린 양보, 좋은 딜 기다림
      return {
        deadline_hours: 72,
        alpha_price: 0.4, alpha_time: 0.12, alpha_reputation: 0.25, alpha_satisfaction: 0.23,
        accept_threshold: 0.8, counter_threshold: 0.45, reject_threshold: 0.2, near_deal_threshold: 0.74,
        concession_beta: 0.45, concession_k: 1.0,
      };

    case "quick_deal":
      // 속전속결: 빠른 양보, 낮은 수락 기준
      return {
        deadline_hours: 12,
        alpha_price: 0.3, alpha_time: 0.35, alpha_reputation: 0.15, alpha_satisfaction: 0.2,
        accept_threshold: 0.68, counter_threshold: 0.4, reject_threshold: 0.18, near_deal_threshold: 0.62,
        concession_beta: 0.8, concession_k: 1.8,
      };

    case "firm":
      // 단호형: 거의 양보 안 함, 가격 중시
      return {
        alpha_price: 0.5, alpha_time: 0.2, alpha_reputation: 0.15, alpha_satisfaction: 0.15,
        accept_threshold: 0.82, counter_threshold: 0.5, reject_threshold: 0.3, near_deal_threshold: 0.76,
        concession_beta: 0.25, concession_k: 0.5,
      };

    case "balanced":
    default:
      // 기본: 모든 값 기본값 사용
      return {};
  }
}
