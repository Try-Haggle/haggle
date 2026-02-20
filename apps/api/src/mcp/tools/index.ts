import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@haggle/db";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import {
  createDraft,
  getDraftById,
  patchDraft,
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
        "Start a new listing draft for selling an item. Opens the listing wizard to fill in item details.",
      inputSchema: {},
      _meta: {
        ui: { resourceUri: LISTING_RESOURCE_URI },
        "openai/outputTemplate": LISTING_RESOURCE_URI,
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
        "Update fields on an existing listing draft. Only allowed fields (title, description, tags, category, condition, photoUrl, targetPrice, floorPrice, sellingDeadline, strategyConfig) can be patched.",
      inputSchema: {
        draft_id: z.string().uuid(),
        patch: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          category: z.string().optional(),
          condition: z.string().optional(),
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

  // TODO(slice-3): haggle_set_agent_strategy — AI 에이전트 프리셋 및 전략 설정
  // TODO(slice-4): haggle_validate_draft — 필수값 검증
  // TODO(slice-4): haggle_publish_listing — 리스팅 발행 + 공유 링크 생성
  // TODO(slice-5): haggle_create_negotiation_session — 구매자 협상 세션 생성
  // TODO(slice-5): haggle_submit_offer — 오퍼 제출 + AI 에이전트 결정
  // TODO(slice-6): haggle_claim — 24시간 소유권 연결
}
