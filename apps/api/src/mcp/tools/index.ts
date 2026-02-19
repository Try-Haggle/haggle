import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@haggle/db";
import {
  createDraft,
  getDraftById,
  patchDraft,
} from "../../services/draft.service.js";

/**
 * Register all MCP tools with the server.
 * Each tool delegates to the service layer for DB operations.
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
  server.tool(
    "haggle_start_draft",
    "Start a new listing draft for selling an item. Returns a draft ID and empty draft object that can be filled in via haggle_apply_patch.",
    {},
    async () => {
      const draft = await createDraft(db);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              draft_id: draft.id,
              draft,
              message: "Draft created! Tell me about the item you want to sell.",
            }),
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
  server.tool(
    "haggle_apply_patch",
    "Update fields on an existing listing draft. Only allowed fields (title, description, tags, category, condition, photoUrl, targetPrice, floorPrice, sellingDeadline, strategyConfig) can be patched.",
    {
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
