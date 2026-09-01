import type { Database } from "@haggle/db";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyHnpAccept,
  getAcceptedEventPriceMinor,
  normalizeAcceptRequest,
} from "../../hnp/accept-session.js";
import { hnpAcceptEnvelopeSchema, hnpOfferEnvelopeSchema } from "../../hnp/envelope-schema.js";
import { submitHnpOffer } from "../../hnp/submit-offer.js";
import type { EventDispatcher } from "../../lib/event-dispatcher.js";
import { executeGroupTerminal } from "../../lib/group-executor.js";
import { requireActorWithScope } from "../../lib/mcp-scopes.js";
import { validateSessionWriteAccess } from "../../lib/session-access.js";
import { uploadListingPhoto } from "../../lib/supabase-storage.js";
import {
  claimListing,
  createDraft,
  patchDraft,
  publishDraft,
  validateDraft,
} from "../../services/draft.service.js";
import { getSessionById } from "../../services/negotiation-session.service.js";
import { LISTING_RESOURCE_URI } from "../resources.js";
import { registerPlatformTools, requireOwnedDraft } from "./platform.js";
import { mcpError } from "./responses.js";

/**
 * Register all MCP tools with the server.
 * Tools that trigger UI use registerAppTool (ext-apps SDK).
 * Data-only tools use server.tool() (core MCP SDK).
 */
export function registerTools(server: McpServer, db: Database, eventDispatcher?: EventDispatcher) {
  registerPlatformTools(server, db, eventDispatcher);

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
  // Accepts an optional patch so the model can create + populate in one call.
  registerAppTool(
    server,
    "haggle_start_draft",
    {
      title: "Start Draft",
      description:
        "Start a listing draft. Grok Bot and other text clients should prefer haggle_create_listing, which publishes in one call. ChatGPT hosts may open the listing wizard. If the user already gave title, price, condition, or deadline, include them in 'patch'. Include sellingDeadline when you know it — publish requires title, asking price, and deadline.",
      inputSchema: {
        patch: z
          .object({
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
            condition: z.enum(["new", "like_new", "good", "fair", "poor"]).optional(),
            targetPrice: z.string().optional(),
            floorPrice: z.string().optional(),
            sellingDeadline: z.string().datetime().optional(),
          })
          .optional(),
      },
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
    async ({ patch }) => {
      const scoped = requireActorWithScope("listings");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      let draft = await createDraft(db, { userId: actor.id });

      // If the model included initial fields, apply them immediately
      if (patch && Object.keys(patch).length > 0) {
        const patched = await patchDraft(db, draft.id, {
          ...patch,
          sellingDeadline: patch.sellingDeadline ? new Date(patch.sellingDeadline) : undefined,
        });
        if (patched) draft = patched;
      }

      return {
        structuredContent: {
          draft_id: draft.id,
          draft,
        },
        content: [
          {
            type: "text" as const,
            text: patch
              ? "Draft created with your item details! Review and complete the remaining fields."
              : "Draft created! Fill in the item details in the form.",
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
      const owned = await requireOwnedDraft(db, draft_id);
      if (!owned.ok) return owned.error;
      const draft = owned.draft;
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
        "Update fields on an existing listing draft. IMPORTANT: Bundle ALL mentioned fields into a single call — do NOT split into multiple calls. Only call this when the user explicitly mentions specific details (title, price, condition, etc.) in the conversation, or when the widget UI sends a patch. Do NOT guess or auto-fill fields that the user has not mentioned. Allowed fields: title, description, tags, category, condition, photoUrl, targetPrice, floorPrice, sellingDeadline, negotiationAgentSnapshot.",
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
          condition: z.enum(["new", "like_new", "good", "fair", "poor"]).optional(),
          photoUrl: z.string().optional(),
          targetPrice: z.string().optional(),
          floorPrice: z.string().optional(),
          sellingDeadline: z.string().datetime().optional(),
          negotiationAgentSnapshot: z.record(z.unknown()).optional(),
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
      const owned = await requireOwnedDraft(db, draft_id);
      if (!owned.ok) return owned.error;
      // Convert ISO string to Date for timestamp field
      const servicePatch = {
        ...patch,
        sellingDeadline: patch.sellingDeadline ? new Date(patch.sellingDeadline) : undefined,
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
      const owned = await requireOwnedDraft(db, draft_id);
      if (!owned.ok) return owned.error;
      const draft = owned.draft;
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
      const owned = await requireOwnedDraft(db, draft_id);
      if (!owned.ok) return owned.error;
      // Pre-validate
      const draft = owned.draft;
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
        image_base64: z.string().describe("Base64-encoded image data (without data URI prefix)"),
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
      const owned = await requireOwnedDraft(db, draft_id);
      if (!owned.ok) return owned.error;
      try {
        const { publicUrl } = await uploadListingPhoto(draft_id, image_base64, mime_type);

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
        const message = err instanceof Error ? err.message : "Photo upload failed";
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

  // ─── haggle_auto_detect ──────────────────────────────────
  // Widget-only tool: vision LLM suggests tags
  // from photo + title (+ optional description).
  registerAppTool(
    server,
    "haggle_auto_detect",
    {
      title: "Auto-Detect Listing",
      description:
        "Analyze a draft's photo + title with vision LLM. Returns 4–8 lowercase-hyphenated tags. Widget calls this once both photo and title are present. Do NOT call from the model.",
      inputSchema: { draft_id: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: LISTING_RESOURCE_URI, visibility: ["app"] },
        "openai/outputTemplate": LISTING_RESOURCE_URI,
        "openai/widgetAccessible": true,
      },
    },
    async ({ draft_id }) => {
      const owned = await requireOwnedDraft(db, draft_id);
      if (!owned.ok) return owned.error;
      const draft = owned.draft;
      if (!draft) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Draft not found", draft_id }) },
          ],
        };
      }
      if (!draft.photoUrl || !draft.title) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "photoUrl and title are required", draft_id }),
            },
          ],
        };
      }
      const { autoDetectListing } = await import("../../services/listing-auto-detect.service.js");
      const result = await autoDetectListing({
        photoUrl: draft.photoUrl,
        title: draft.title,
        description: draft.description,
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.error.code, message: result.error.message }),
            },
          ],
        };
      }
      return {
        structuredContent: {
          draft_id,
          tags: result.tags,
        },
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ draft_id, tags: result.tags }),
          },
        ],
      };
    },
  );

  // ─── hnp_submit_offer ────────────────────────────────────
  // Protocol path: full HNP envelope, same ingress as REST.
  server.tool(
    "hnp_submit_offer",
    "Submit an HNP OFFER or COUNTER envelope. Same protocol ingress as REST.",
    {
      envelope: hnpOfferEnvelopeSchema,
    },
    async ({ envelope }) => {
      const scoped = requireActorWithScope("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      try {
        const session = await getSessionById(db, envelope.session_id);
        if (!session) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: JSON.stringify({ error: "SESSION_NOT_FOUND" }) },
            ],
          };
        }
        const writeAccess = validateSessionWriteAccess(actor, session, {
          senderRole: envelope.sender_role,
          senderAgentId: envelope.sender_agent_id,
          action: "offer",
        });
        if (!writeAccess.ok) {
          return mcpError(writeAccess.error);
        }

        const result = await submitHnpOffer(db, envelope, { eventDispatcher });
        if (!result.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ...result.body, status: result.status }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                protocol: "hnp",
                round_id: result.roundId,
                round_no: result.roundNo,
                decision: result.decision,
                counter_price: result.counterPrice,
                session_status: result.sessionStatus,
                idempotent: result.idempotent,
                proposal_hash: result.proposalHash,
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

  // ─── hnp_accept ──────────────────────────────────────────
  server.tool(
    "hnp_accept",
    "Accept a bound HNP proposal with an ACCEPT envelope. Same ingress and agreement path as REST PATCH /negotiations/sessions/:id/accept.",
    {
      envelope: hnpAcceptEnvelopeSchema,
    },
    async ({ envelope }) => {
      const scoped = requireActorWithScope("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      try {
        const session = await getSessionById(db, envelope.session_id);
        if (!session) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: JSON.stringify({ error: "SESSION_NOT_FOUND" }) },
            ],
          };
        }
        const writeAccess = validateSessionWriteAccess(actor, session, {
          senderRole: envelope.sender_role,
          senderAgentId: envelope.sender_agent_id,
          action: "accept",
        });
        if (!writeAccess.ok) {
          return mcpError(writeAccess.error);
        }

        const accepted = normalizeAcceptRequest({ hnp: envelope }, envelope.session_id, Date.now());
        if (!accepted.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(accepted.body) }],
          };
        }

        const applied = await applyHnpAccept(db, session, accepted);
        if (!applied.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(applied.body) }],
          };
        }

        if (applied.updated && eventDispatcher) {
          await eventDispatcher
            .dispatch({
              domain: "negotiation",
              type: "negotiation.agreed",
              payload: {
                session_id: session.id,
                agreed_price_minor: getAcceptedEventPriceMinor({
                  agreement: applied.agreement,
                  session,
                }),
                buyer_id: session.buyerId,
                seller_id: session.sellerId,
              },
              idempotency_key: `neg_agreed_${session.id}`,
              timestamp: Date.now(),
            })
            .catch((err) => {
              console.error("[mcp] negotiation.agreed error:", err);
            });

          if (session.groupId) {
            await executeGroupTerminal(
              db,
              session.groupId,
              session.id,
              "ACCEPTED",
              eventDispatcher,
            ).catch((err) => {
              console.error("[mcp] group terminal error:", err);
            });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                protocol: "hnp",
                updated: applied.updated,
                idempotent: applied.idempotent ?? false,
                session_status: applied.session_status,
                agreement: applied.agreement,
                transaction_handoff: applied.transaction_handoff,
                transaction_handoff_summary: applied.transaction_handoff_summary,
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
                error: "HNP_ACCEPT_FAILED",
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
    },
    async ({ claim_token }) => {
      const scoped = requireActorWithScope("listings");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      try {
        const result = await claimListing(db, claim_token, actor.id);

        if (!result.ok) {
          const errorMessages: Record<string, string> = {
            invalid_token: "Claim token not found or listing is not published.",
            expired:
              "Claim token has expired (24-hour window). You need to re-publish the listing.",
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
                user_id: actor.id,
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
