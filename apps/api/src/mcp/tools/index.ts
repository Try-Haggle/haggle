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
} from "../../services/draft.service.js";
import { LISTING_RESOURCE_URI } from "../resources.js";

/**
 * Register all MCP tools with the server.
 * Tools that trigger UI use registerAppTool (ext-apps SDK).
 * Data-only tools use server.tool() (core MCP SDK).
 */
export function registerTools(server: McpServer, db: Database) {
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

  // TODO(slice-5): haggle_create_negotiation_session — 구매자 협상 세션 생성
  // TODO(slice-5): haggle_submit_offer — 오퍼 제출 + AI 에이전트 결정
  // TODO(slice-6): haggle_claim — 24시간 소유권 연결
}
