import { and, type Database, eq, inArray, negotiationAgents, or } from "@haggle/db";
import { type DisputeReasonCode, DisputeService, REASON_CODE_REGISTRY } from "@haggle/dispute-core";
import {
  DEFAULT_NEGOTIATION_AGENT_PRESET_ID,
  getNegotiationAgentPreset,
  normalizeAgentAccent,
  unresolvedSellerRequirements,
} from "@haggle/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EventDispatcher } from "../../lib/event-dispatcher.js";
import { executeGroupTerminal } from "../../lib/group-executor.js";
import { storeListingPhoto } from "../../lib/listing-photo.js";
import { isListingId } from "../../lib/listing-ref.js";
import { getMcpActor } from "../../lib/mcp-actor.js";
import { effectiveMcpScopes, requireActorWithScope } from "../../lib/mcp-scopes.js";
import { checkoutUrl, negotiationChatUrl, publicAppBaseUrl } from "../../lib/public-urls.js";
import { validateSessionParticipant } from "../../lib/session-access.js";
import type { AuthUser } from "../../middleware/auth.js";
import {
  applyBuyerPauseAnswer,
  buyerCriteriaRequiredReject,
  isSellerCriteriaPauseReasoning,
  readSellerCriteriaFromSnapshot,
  SELLER_CRITERIA_PAUSE_MARKER,
  unresolvedBuyerPauseAsks,
} from "../../negotiation/phase/seller-criteria-pause.js";
import { getNotificationUserInfo } from "../../notification/get-user-info.js";
import { mcpConnectHint } from "../../routes/mcp-oauth.js";
import { evaluateDisputeOpeningEligibility } from "../../services/dispute-opening-eligibility.service.js";
import { describeDisputeOrderGate } from "../../services/dispute-order-gate.service.js";
import { createDisputeRecord, getDisputeByOrderId } from "../../services/dispute-record.service.js";
import {
  createAndPublishOwnedListing,
  getDraftById,
  getPublishedListingByPublicId,
  listPublishedListings,
  setOwnedListingPhoto,
} from "../../services/draft.service.js";
import { executeAutoPlayNext } from "../../services/execute-auto-play-next.service.js";
import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
  sanitizePersistedBuilderMemory,
} from "../../services/negotiation-agent-builder-chat.service.js";
import {
  attachNegotiationAutoPlayContext,
  getNegotiationAutoPlayContext,
} from "../../services/negotiation-auto-play.service.js";
import {
  getRoundsBySessionId,
  recordPauseAnswersOnRound,
} from "../../services/negotiation-round.service.js";
import {
  getSessionById,
  setSessionPerspective,
  updateSessionState,
} from "../../services/negotiation-session.service.js";
import {
  getCommerceOrderByOrderId,
  getCommerceOrderBySettlementApprovalId,
  getSettlementApprovalById,
  updateCommerceOrderStatus,
} from "../../services/payment-record.service.js";
import { buyerVisibleRequiredCriteria } from "../../services/public-listing-view.js";
import { getShipmentByOrderId } from "../../services/shipment-record.service.js";
import {
  parseStartBuyerNegotiationBody,
  startBuyerNegotiation,
} from "../../services/start-buyer-negotiation.service.js";
import { lockTestContractForDisputeOpen } from "../../services/test-contract-ledger.service.js";
import {
  haggleGetNegotiationInputSchema,
  normalizeGetNegotiationExpand,
} from "./mcp-get-negotiation-schema.js";
import { haggleGetListingInputSchema, haggleGetListingOutputSchema } from "./mcp-listing-schema.js";
import {
  advisorInputFromListing,
  buildPrepareNegotiationView,
  defaultBuilderMemory,
  listingImageMarkdown,
  MCP_MODE_GUIDANCE,
  negotiationSummaryMarkdown,
  summarizeTranscript,
} from "./mcp-negotiation-prep.js";
import { hagglePlayNextInputSchema } from "./mcp-play-next-schema.js";
import { haggleStartNegotiationInputSchema } from "./mcp-start-schema.js";
import {
  buildMcpGetNegotiationExpandView,
  expandMcpTranscript,
  mcpNegotiationTranscript,
  mcpStartNextActions,
  negotiationSayToUser,
  spokenRoundPriceMinor,
  spokenRoundSpeaker,
} from "./negotiation-talk.js";
import { mcpError, mcpJson } from "./responses.js";

const DEFAULT_BUILDER_SKILL_ID = "negotiation-agent-builder-v1";

const agentRoleSchema = z.enum(["buyer", "seller", "both"]);
const weightsSchema = z.object({
  w_p: z.number(),
  w_t: z.number(),
  w_r: z.number(),
  w_s: z.number(),
});
const agentConfigSchema = z.object({
  emoji: z.string().optional(),
  // Must match the REST schema: haggle_update_agent replaces the whole config
  // with the parsed object, so a field missing here is silently erased.
  accentColor: z
    .string()
    .optional()
    .transform((v) => normalizeAgentAccent(v) ?? undefined),
  basePresetId: z.string().optional(),
  negotiationAgentPresetId: z.string().optional(),
  weights: weightsSchema.optional(),
  engineParams: z.record(z.string(), z.unknown()).optional(),
  categoryAnswers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  voiceId: z.string().optional(),
  builderChatMemory: z
    .record(z.string(), z.unknown())
    .optional()
    .transform((m) => sanitizePersistedBuilderMemory(m)),
});

function requireActor(): AuthUser | null {
  return getMcpActor() ?? null;
}

function requireScopedActor(scope: "agents" | "listings" | "negotiate" | "orders" | "disputes") {
  return requireActorWithScope(scope);
}

type ResolvedBuyerAgent = {
  presetId: string;
  /** Stored builderChatMemory of a saved agent (web: savedMemory[savedId]). */
  memory?: Record<string, unknown>;
  weights?: Record<string, number>;
};

async function resolveBuyerAgent(
  db: Database,
  actor: AuthUser,
  agentId: string | undefined,
): Promise<ResolvedBuyerAgent> {
  const fallback = { presetId: DEFAULT_NEGOTIATION_AGENT_PRESET_ID };
  const raw = agentId?.trim() || DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
  if (getNegotiationAgentPreset(raw)) return { presetId: raw };
  if (!isListingId(raw)) {
    const byName = raw.toLowerCase();
    if (getNegotiationAgentPreset(byName)) return { presetId: byName };
    return fallback;
  }
  const [agent] = await db
    .select()
    .from(negotiationAgents)
    .where(eq(negotiationAgents.id, raw))
    .limit(1);
  if (!agent || (!agent.isSystem && agent.userId !== actor.id)) return fallback;
  const config = (agent.negotiationAgentConfig ?? {}) as Record<string, unknown>;
  const presetId =
    [config.basePresetId, config.negotiationAgentPresetId, agent.name].find(
      (value): value is string =>
        typeof value === "string" && Boolean(getNegotiationAgentPreset(value)),
    ) ?? DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
  const memory = config.builderChatMemory;
  const weights = config.weights;
  return {
    presetId,
    ...(memory && typeof memory === "object" && !Array.isArray(memory)
      ? { memory: memory as Record<string, unknown> }
      : {}),
    ...(weights && typeof weights === "object" && !Array.isArray(weights)
      ? { weights: weights as Record<string, number> }
      : {}),
  };
}

type RoundRow = Awaited<ReturnType<typeof getRoundsBySessionId>>[number];

function toTranscriptRounds(rounds: RoundRow[]) {
  return rounds.map((round) => {
    const meta = (round.metadata as Record<string, unknown> | null) ?? null;
    const heldQuestions = Array.isArray(meta?.pause_questions)
      ? meta.pause_questions.filter((q): q is string => typeof q === "string")
      : [];
    return {
      roundNo: round.roundNo,
      senderRole: round.senderRole,
      message: round.message,
      decision: round.decision,
      priceminor: round.priceminor,
      counterPriceMinor: round.counterPriceMinor,
      heldForCriteriaPause: isSellerCriteriaPauseReasoning(meta?.reasoning),
      pauseQuestions: heldQuestions,
    };
  });
}

export function publicListingView(listing: {
  publicId: string | null;
  title: string | null;
  description?: string | null;
  category: string | null;
  condition: string | null;
  targetPrice: string | null;
  photoUrl: string | null;
  sellerId?: string | null;
  negotiationAgentSnapshot?: unknown;
}) {
  return {
    public_id: listing.publicId,
    title: listing.title,
    description: listing.description ?? null,
    category: listing.category,
    condition: listing.condition,
    target_price: listing.targetPrice,
    photo_url: listing.photoUrl,
    image_markdown: listingImageMarkdown(listing.title, listing.photoUrl),
    claimed: listing.sellerId === undefined ? undefined : Boolean(listing.sellerId),
    listing_url: listing.publicId ? `${publicAppBaseUrl()}/l/${listing.publicId}` : null,
    required_criteria: buyerVisibleRequiredCriteria(listing.negotiationAgentSnapshot),
  };
}

export async function requireOwnedDraft(db: Database, draftId: string) {
  const scoped = requireScopedActor("listings");
  if (!scoped.ok) return scoped;
  const actor = scoped.actor;
  const draft = await getDraftById(db, draftId);
  if (!draft)
    return { ok: false as const, error: mcpError("DRAFT_NOT_FOUND", { draft_id: draftId }) };
  if (draft.userId && draft.userId !== actor.id) {
    return {
      ok: false as const,
      error: mcpError("FORBIDDEN", { message: "Not the owner of this draft" }),
    };
  }
  if (!draft.userId) {
    return {
      ok: false as const,
      error: mcpError("DRAFT_UNCLAIMED", { message: "Connect and claim this draft first" }),
    };
  }
  return { ok: true as const, actor, draft };
}

export function registerPlatformTools(
  server: McpServer,
  db: Database,
  eventDispatcher?: EventDispatcher,
) {
  server.tool(
    "haggle_whoami",
    "Show the connected Haggle account (own email, display name, my_deals_url). If no account is connected, returns sign-in and sign-up URLs.",
    {},
    async () => {
      const actor = requireActor();
      if (!actor) {
        return mcpJson({ connected: false, ...mcpConnectHint() });
      }
      // Only the connected actor's own account data.
      let info: { email: string; displayName: string } | null = null;
      try {
        info = await getNotificationUserInfo(db, actor.id);
      } catch {
        info = null;
      }
      return mcpJson({
        connected: true,
        user_id: actor.id,
        role: actor.role ?? "user",
        scopes: effectiveMcpScopes(actor),
        email: info?.email ?? actor.email ?? null,
        display_name: info?.displayName ?? null,
        my_deals_url: `${publicAppBaseUrl()}/buy/dashboard`,
      });
    },
  );

  server.tool(
    "haggle_search_listings",
    "Search published Haggle listings. Public — no account required. When presenting a listing, show image_markdown (a Markdown image) when it is not null.",
    {
      q: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(40).optional(),
    },
    async ({ q, category, limit }) => {
      const listings = await listPublishedListings(db, {
        q,
        categories: category ? [category] : undefined,
        limit: limit ?? 12,
      });
      return mcpJson({
        listings: listings.map((listing) => publicListingView(listing)),
      });
    },
  );

  server.registerTool(
    "haggle_get_listing",
    {
      description:
        "Get a published listing by its public id (the /l/:publicId slug). Returns required_criteria as {checkId, ask}[] from extractSellerRequiredCriteria(listing.negotiationAgentSnapshot) — same source as the web start wizard. Empty when the seller has no required checks. Do not assume IMEI/완납/침수/Find My. When presenting a listing, show image_markdown (a Markdown image) when it is not null.",
      inputSchema: haggleGetListingInputSchema,
      outputSchema: haggleGetListingOutputSchema,
    },
    async ({ public_id }) => {
      const listing = await getPublishedListingByPublicId(db, public_id);
      if (!listing?.sellerId) return mcpError("LISTING_NOT_FOUND", { public_id });
      const view = { listing: publicListingView(listing) };
      return { ...mcpJson(view), structuredContent: view };
    },
  );

  server.tool(
    "haggle_create_listing",
    "Create and publish a listing as the connected user. Grok Bot and other text clients should use this instead of the ChatGPT listing widget. Requires a connected Haggle account. Do not invent user IDs. If the user attached a photo, pass it as image_base64 (raw base64 or a data URI) or photo_url (public HTTPS image). Title and asking price are required. If selling_deadline is omitted, the listing stays up for 7 days.",
    {
      title: z.string().min(1).max(200),
      target_price: z.string().min(1).max(20),
      description: z.string().max(4000).optional(),
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
      floor_price: z.string().max(20).optional(),
      tags: z.array(z.string().min(1).max(40)).max(12).optional(),
      selling_deadline: z.string().datetime().optional(),
      photo_url: z.string().url().optional(),
      image_base64: z.string().min(32).max(8_000_000).optional(),
      mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    },
    async ({
      title,
      target_price,
      description,
      category,
      condition,
      floor_price,
      tags,
      selling_deadline,
      photo_url,
      image_base64,
      mime_type,
    }) => {
      const scoped = requireScopedActor("listings");
      if (!scoped.ok) return scoped.error;
      const draftId = crypto.randomUUID();
      let storedPhotoUrl: string | undefined;
      if (image_base64 || photo_url) {
        const stored = await storeListingPhoto({
          storageKey: draftId,
          imageBase64: image_base64,
          mimeType: mime_type,
          photoUrl: photo_url,
        });
        if (!stored.ok) return mcpError(stored.error, { photo_url });
        storedPhotoUrl = stored.publicUrl;
      }
      const created = await createAndPublishOwnedListing(db, {
        userId: scoped.actor.id,
        title,
        targetPrice: target_price,
        description,
        category,
        condition,
        floorPrice: floor_price,
        tags,
        sellingDeadline: selling_deadline ? new Date(selling_deadline) : undefined,
        photoUrl: storedPhotoUrl,
      });
      if (!created.ok) {
        return mcpError(created.error, {
          draft_id: created.draftId,
          ...("errors" in created ? { errors: created.errors } : {}),
        });
      }
      return mcpJson({
        draft_id: created.draftId,
        public_id: created.publicId,
        share_url: created.shareUrl,
        listing_url: created.listingUrl,
        photo_url: created.photoUrl,
        next_actions: [
          "haggle_get_listing",
          "haggle_start_negotiation",
          "haggle_set_listing_photo",
        ],
        message: created.photoUrl
          ? "Listing is live with a photo. Share listing_url."
          : "Listing is live. Share listing_url. To add a photo later, call haggle_set_listing_photo with this public_id.",
      });
    },
  );

  server.tool(
    "haggle_set_listing_photo",
    "Add or replace the photo on a listing the connected user owns. Use this when the user already published a listing and later attaches a photo. Pass image_base64 from the chat attachment, or photo_url if you have a public HTTPS image.",
    {
      public_id: z.string().min(1),
      photo_url: z.string().url().optional(),
      image_base64: z.string().min(32).max(8_000_000).optional(),
      mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    },
    async ({ public_id, photo_url, image_base64, mime_type }) => {
      const scoped = requireScopedActor("listings");
      if (!scoped.ok) return scoped.error;
      if (!image_base64 && !photo_url) {
        return mcpError("PHOTO_REQUIRED", { public_id });
      }
      const stored = await storeListingPhoto({
        storageKey: public_id,
        imageBase64: image_base64,
        mimeType: mime_type,
        photoUrl: photo_url,
      });
      if (!stored.ok) return mcpError(stored.error, { public_id, photo_url });
      const updated = await setOwnedListingPhoto(db, {
        userId: scoped.actor.id,
        publicId: public_id,
        photoUrl: stored.publicUrl,
      });
      if (!updated.ok) return mcpError(updated.error, { public_id });
      return mcpJson({
        public_id: updated.publicId,
        photo_url: updated.photoUrl,
        listing_url: `${publicAppBaseUrl()}/l/${updated.publicId}`,
        message: "Photo saved on the listing.",
      });
    },
  );

  server.tool(
    "haggle_list_agents",
    "List the connected user's negotiation agents plus system presets. Same as the web studio.",
    { role: z.enum(["buyer", "seller", "both", "any"]).optional() },
    async ({ role }) => {
      const scoped = requireScopedActor("agents");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const ownership = or(
        eq(negotiationAgents.isSystem, true),
        eq(negotiationAgents.userId, actor.id),
      );
      const where =
        !role || role === "any"
          ? ownership
          : and(ownership, inArray(negotiationAgents.role, [role, "both"] as const));
      const agents = await db.select().from(negotiationAgents).where(where);
      return mcpJson({
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          is_system: agent.isSystem,
          description: agent.description,
        })),
      });
    },
  );

  server.tool(
    "haggle_get_agent",
    "Get one negotiation agent the connected user can use.",
    { agent_id: z.string().uuid() },
    async ({ agent_id }) => {
      const scoped = requireScopedActor("agents");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const [agent] = await db
        .select()
        .from(negotiationAgents)
        .where(eq(negotiationAgents.id, agent_id))
        .limit(1);
      if (!agent) return mcpError("AGENT_NOT_FOUND");
      if (!agent.isSystem && agent.userId !== actor.id) return mcpError("FORBIDDEN");
      return mcpJson({ agent });
    },
  );

  server.tool(
    "haggle_create_agent",
    "Create a custom negotiation agent for the connected user. Same as the web studio.",
    {
      name: z.string().min(1).max(100),
      description: z.string().max(1000).optional(),
      role: agentRoleSchema.optional(),
      config: agentConfigSchema.optional(),
    },
    async ({ name, description, role, config }) => {
      const scoped = requireScopedActor("agents");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const [inserted] = await db
        .insert(negotiationAgents)
        .values({
          name,
          displayName: name,
          description: description ?? null,
          advisorSkillId: DEFAULT_BUILDER_SKILL_ID,
          negotiationAgentConfig: config ?? {},
          role: role ?? "both",
          isSystem: false,
          userId: actor.id,
        })
        .returning();
      return mcpJson({ agent: inserted });
    },
  );

  server.tool(
    "haggle_update_agent",
    "Update a custom negotiation agent owned by the connected user.",
    {
      agent_id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(1000).optional(),
      role: agentRoleSchema.optional(),
      config: agentConfigSchema.optional(),
    },
    async ({ agent_id, name, description, role, config }) => {
      const scoped = requireScopedActor("agents");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const [existing] = await db
        .select()
        .from(negotiationAgents)
        .where(eq(negotiationAgents.id, agent_id))
        .limit(1);
      if (!existing) return mcpError("AGENT_NOT_FOUND");
      if (existing.isSystem || existing.userId !== actor.id) return mcpError("FORBIDDEN");
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) {
        patch.name = name;
        patch.displayName = name;
      }
      if (description !== undefined) patch.description = description;
      if (role !== undefined) patch.role = role;
      if (config !== undefined) patch.negotiationAgentConfig = config;
      const [updated] = await db
        .update(negotiationAgents)
        .set(patch)
        .where(and(eq(negotiationAgents.id, agent_id), eq(negotiationAgents.userId, actor.id)))
        .returning();
      return mcpJson({ agent: updated });
    },
  );

  server.tool(
    "haggle_prepare_negotiation",
    "Step 1 of a guided buyer negotiation (same path as the web start wizard). Returns required_criteria (must_answer), tag_questions with options, price_questions (targetPrice / budgetMax in whole dollars), presets, the user's saved agents, fulfillment_choices and an instruction. Ask the must-answers first, offer a strategy chat (haggle_builder_chat_turn with public_id), then ask consult vs delegate before haggle_start_negotiation. When presenting the listing, show listing.image_markdown (a Markdown image) when it is not null.",
    { public_id: z.string().min(1).describe("Listing slug (jc6r2T3d) or full /l/... URL") },
    async ({ public_id }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const listing = await getPublishedListingByPublicId(db, public_id);
      if (!listing) return mcpError("LISTING_NOT_FOUND", { public_id });
      const agents = await db
        .select()
        .from(negotiationAgents)
        .where(and(eq(negotiationAgents.userId, actor.id), eq(negotiationAgents.isSystem, false)));
      return mcpJson(
        buildPrepareNegotiationView(
          listing,
          agents
            .filter((a) => a.role === "buyer" || a.role === "both")
            .map((a) => ({ id: a.id, name: a.name, description: a.description })),
        ),
      );
    },
  );

  server.tool(
    "haggle_builder_chat_turn",
    "One buyer-strategy builder turn. Same pipeline as POST /negotiations/agents/builder/chat-turn. Pass public_id and the server fills the listing (price, tags, seller required criteria); omit previous_memory on the first turn and pass back builder_memory from the previous result on later turns so you can discuss strategy over several turns. builder_memory is accepted as-is by haggle_start_negotiation. Persists builderChatMemory when agent_id is a user-owned agent.",
    {
      ...negotiationAgentBuilderTurnBodySchema.omit({ user_id: true }).shape,
      public_id: z
        .string()
        .min(1)
        .optional()
        .describe("Listing slug or /l/... URL; server-fills listings and seller_required_criteria"),
      previous_memory: negotiationAgentBuilderTurnBodySchema.shape.previous_memory.optional(),
    },
    async ({ public_id, previous_memory, ...args }) => {
      const scoped = requireScopedActor("agents");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      let listingInput: ReturnType<typeof advisorInputFromListing> | undefined;
      let fallbackMemory: ReturnType<typeof defaultBuilderMemory> | undefined;
      if (public_id) {
        const listing = await getPublishedListingByPublicId(db, public_id);
        if (!listing) return mcpError("LISTING_NOT_FOUND", { public_id });
        listingInput = advisorInputFromListing(listing);
        fallbackMemory = defaultBuilderMemory(listing);
      }
      const parsed = negotiationAgentBuilderTurnBodySchema.safeParse({
        ...args,
        ...(listingInput && !args.listings?.length ? { listings: listingInput.listings } : {}),
        ...(listingInput && !args.seller_required_criteria?.length
          ? { seller_required_criteria: listingInput.seller_required_criteria }
          : {}),
        previous_memory: previous_memory ?? fallbackMemory,
        user_id: actor.id,
      });
      if (!parsed.success) {
        return mcpError("INVALID_BODY", { issues: parsed.error.issues });
      }
      try {
        const result = await processNegotiationAgentBuilderTurn({
          ...parsed.data,
          user_id: actor.id,
        });
        if (args.agent_id) {
          const [existing] = await db
            .select()
            .from(negotiationAgents)
            .where(eq(negotiationAgents.id, args.agent_id))
            .limit(1);
          if (existing && !existing.isSystem && existing.userId === actor.id) {
            const config = {
              ...((existing.negotiationAgentConfig as Record<string, unknown> | null) ?? {}),
              builderChatMemory: sanitizePersistedBuilderMemory(result.memory),
            };
            await db
              .update(negotiationAgents)
              .set({ negotiationAgentConfig: config, updatedAt: new Date() })
              .where(eq(negotiationAgents.id, existing.id));
          }
        }
        return mcpJson({
          agent_id: args.agent_id ?? null,
          ...result,
          // Start accepts this directly as builder_memory; pass it back as previous_memory next turn.
          builder_memory: result.memory,
          next_actions: ["haggle_builder_chat_turn", "haggle_start_negotiation"],
          instruction:
            "Relay the reply to the user. Continue the strategy chat with previous_memory = builder_memory, or start with builder_memory.",
        });
      } catch {
        return mcpError("CHAT_TURN_FAILED");
      }
    },
  );

  server.registerTool(
    "haggle_start_negotiation",
    {
      description:
        "Start a buyer negotiation on a published listing. Same as POST /negotiations/start. Requires a connected account that is not the seller. public_id may be the slug (jc6r2T3d) or the full /l/... URL. agent_id is optional — use a preset (hunter, balancer, closer, verifier), an id from haggle_list_agents, or omit it to use balancer. Call haggle_get_listing first and answer required_criteria ({checkId, ask}) via buyerCriteria ({checkId, stance?}). Empty start is 409 BUYER_CRITERIA_REQUIRED with required_criteria {checkId, ask}[] (and required_check_ids) and no session. Do not assume IMEI/완납/침수/Find My. Do not use answer_pause. Do not invent user IDs. Web parity: call haggle_prepare_negotiation first, then pass the user's answers as buyerCriteria and builder_memory {budgetMax, targetPrice} (whole dollars) — without budgetMax the walk-away price is the asking price. A saved agent_id applies its stored memory and weights. Optional agent_weights, agent_overrides, fulfillment, buyer_control_mode (manual = consult, auto = delegate). After start: consult = haggle_play_next each round with the user; delegate = haggle_play_until.",
      inputSchema: haggleStartNegotiationInputSchema,
    },
    async ({
      public_id,
      agent_id,
      deadline_hours,
      buyerCriteria,
      builder_memory,
      agent_weights,
      agent_overrides,
      buyer_control_mode,
      fulfillment,
    }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      try {
        const agent = await resolveBuyerAgent(db, actor, agent_id);
        // Web parity: this call's briefing wins, else the saved agent's memory/weights.
        const memory = builder_memory ?? agent.memory;
        const weights = agent_weights ?? agent.weights;
        const parsed = parseStartBuyerNegotiationBody({
          listing_public_id: public_id,
          negotiation_agent_preset_id: agent.presetId,
          deadline_hours,
          ...(buyerCriteria ? { buyerCriteria } : {}),
          ...(memory ? { negotiation_agent_builder_memory: memory } : {}),
          ...(weights ? { agent_weights: weights } : {}),
          ...(agent_overrides ? { agent_overrides } : {}),
          ...(buyer_control_mode ? { buyer_control_mode } : {}),
          ...(fulfillment ? { fulfillment } : {}),
        });
        if (!parsed.ok) {
          return mcpError(parsed.body.error, {
            ...(parsed.body.message ? { message: parsed.body.message } : {}),
            issues: parsed.body.issues,
          });
        }
        const started = await startBuyerNegotiation(db, {
          body: parsed.data,
          buyerId: actor.id,
          isGuest: false,
          driver: "mcp",
          allowGuest: false,
          chatUrl: undefined,
        });
        if (!started.ok) {
          return mcpJson(
            {
              ...started.body,
              hint:
                started.body.error === "LISTING_UNCLAIMED"
                  ? "This listing has no seller connected yet, so it is not open for negotiation. Choose a different listing."
                  : started.body.error === "BUYER_IS_SELLER"
                    ? "The connected account owns this listing. Connect a different Haggle user as the buyer."
                    : started.body.error === "LISTING_NOT_FOUND"
                      ? "Pass the listing slug or https://app.staging.tryhaggle.ai/l/<slug>."
                      : started.body.error === "INSUFFICIENT_SCOPE"
                        ? "Reconnect and allow the negotiate permission."
                        : started.body.error === "BUYER_CRITERIA_REQUIRED"
                          ? "Ask the user each required_criteria.ask from this error or haggle_get_listing, then pass buyerCriteria ({checkId, stance?}). Do not invent checkIds. Do not use haggle_answer_pause."
                          : undefined,
            },
            true,
          );
        }
        return mcpJson({
          session_id: started.body.session_id,
          status: started.body.status,
          driver: "mcp",
          chat_url: negotiationChatUrl(started.body.session_id),
          buyer_control_mode: buyer_control_mode ?? "auto",
          next_actions: mcpStartNextActions(false),
          mode_guidance: MCP_MODE_GUIDANCE,
          message:
            "Negotiation started. Consult mode: call haggle_play_next each round, show the counterpart line and price, decide the next move with the user. Delegate mode: call haggle_play_until. Open chat_url to watch on the web.",
        });
      } catch (error) {
        return mcpError("START_NEGOTIATION_FAILED", {
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    },
  );

  server.registerTool(
    "haggle_get_negotiation",
    {
      description:
        "Read the live negotiation. Immediately quote say_to_user to the human — that is the counterpart's line. If pause_questions are present, ask those next; do not treat them as the seller's bargain line. Do not stop silently. Default response includes full transcript + offers (plus recent_messages). expand is optional if you only need a subset. Show summary_markdown (round table with seller offer / my offer / note, status, chat_url link) to the user instead of dumping every message; the structured fields remain for follow-up.",
      inputSchema: haggleGetNegotiationInputSchema,
    },
    async ({ session_id, expand }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const session = await getSessionById(db, session_id);
      if (!session) return mcpError("SESSION_NOT_FOUND");
      const access = validateSessionParticipant(actor, session);
      if (!access.ok) return mcpError(access.error);
      const rounds = await getRoundsBySessionId(db, session.id);
      const latest = rounds.at(-1);
      const latestMeta = (latest?.metadata as Record<string, unknown> | null) ?? null;
      const pauseSnapshot =
        getNegotiationAutoPlayContext(session.negotiationAgentSnapshot)?.buyerSnapshot ??
        session.negotiationAgentSnapshot;
      const pauseAsks =
        isSellerCriteriaPauseReasoning(latestMeta?.reasoning) && !latestMeta?.buyer_pause_answers
          ? unresolvedBuyerPauseAsks(pauseSnapshot)
          : [];
      const expandFields = normalizeGetNegotiationExpand(expand);
      const foldView = buildMcpGetNegotiationExpandView(
        rounds.map((round) => {
          const meta = (round.metadata as Record<string, unknown> | null) ?? null;
          const pauseQuestions = Array.isArray(meta?.pause_questions)
            ? meta.pause_questions.filter((q): q is string => typeof q === "string")
            : [];
          return {
            roundNo: round.roundNo,
            senderRole: round.senderRole,
            message: round.message,
            decision: round.decision,
            priceminor: round.priceminor,
            counterPriceMinor: round.counterPriceMinor,
            heldForCriteriaPause: isSellerCriteriaPauseReasoning(meta?.reasoning),
            pauseQuestions,
          };
        }),
        session.currentRound,
        expandFields,
      );
      const recent = foldView.recent_messages;
      const lastMsg = recent.at(-1);
      const driver = session.driver === "mcp" ? "mcp" : "web";
      const nextActions: string[] = [];
      const playBlocked = Boolean(buyerCriteriaRequiredReject(pauseSnapshot));
      if (session.status === "ACCEPTED") nextActions.push("haggle_create_checkout");
      else if (!["REJECTED", "EXPIRED", "SUPERSEDED", "STALLED"].includes(session.status)) {
        if (pauseAsks.length > 0 && !playBlocked) nextActions.push("haggle_answer_pause");
        else if (driver === "mcp" && !playBlocked) nextActions.push("haggle_play_next");
        nextActions.push("haggle_reject_negotiation");
      }
      const latestSpeaker =
        lastMsg?.speaker ??
        spokenRoundSpeaker({
          senderRole: latest?.senderRole,
          message: lastMsg?.message,
          heldForCriteriaPause: isSellerCriteriaPauseReasoning(latestMeta?.reasoning),
        });
      const latestSpoken = lastMsg?.message ?? null;
      const latestSpokenPrice =
        lastMsg?.price_minor ??
        spokenRoundPriceMinor({
          priceMinor: latest?.priceminor,
          counterPriceMinor: latest?.counterPriceMinor,
        });
      const talk = negotiationSayToUser({
        counterpartRole: latestSpeaker,
        counterpartMessage: latestSpoken,
        decision: latest?.decision,
        priceMinor: latestSpokenPrice ?? session.lastOfferPriceMinor,
        pauseQuestions: pauseAsks.map((c) => c.ask),
        sessionStatus: session.status,
      });
      return mcpJson({
        session_id: session.id,
        status: session.status,
        current_round: foldView.current_round,
        driver,
        chat_url: negotiationChatUrl(session.id),
        // Soft control_mode — counterpart-visible (CU-ready / M2)
        buyer_control_mode: session.buyerControlMode === "manual" ? "manual" : "auto",
        seller_control_mode: session.sellerControlMode === "manual" ? "manual" : "auto",
        speaker: latestSpeaker,
        spoken_price_minor: latestSpokenPrice,
        last_offer_price_minor: session.lastOfferPriceMinor,
        recent_messages: recent,
        ...(foldView.transcript ? { transcript: foldView.transcript } : {}),
        ...(foldView.offers ? { offers: foldView.offers } : {}),
        pause_questions: pauseAsks.map((c) => c.ask),
        pause_check_ids: pauseAsks.map((c) => c.checkId),
        summary_markdown: negotiationSummaryMarkdown(
          foldView.transcript ?? recent,
          session.status,
          negotiationChatUrl(session.id),
        ),
        next_actions: nextActions,
        ...talk,
        instruction:
          "Speak say_to_user now. Ask ask_user. Do not wait for the human to prompt you.",
      });
    },
  );

  server.registerTool(
    "haggle_play_next",
    {
      description:
        "Advance one Haggle auto-play round (DeepSeek plays a side). After the tool returns, immediately quote say_to_user. If ask_user asked for a price/accept, pass the user's counter as price_minor (integer cents, 42000 = $420) and optional message — same as the web counter, not hnp_submit_offer. Omit both fields to autoplay. Consult mode: call this once per round and discuss each counterpart line and price with the user. Rejected with BUYER_CRITERIA_REQUIRED if seller required criteria exist and buyerCriteria was not provided at start — do not start auto-play and do not use answer_pause. Show summary_markdown (round table with seller offer / my offer / note, status, chat_url link) to the user instead of dumping every message; the structured fields remain for follow-up.",
      inputSchema: hagglePlayNextInputSchema,
    },
    async ({ session_id, price_minor, message }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const played = await executeAutoPlayNext(db, {
        sessionId: session_id,
        actor: scoped.actor,
        expectedDriver: "mcp",
        eventDispatcher,
        ...(price_minor !== undefined ? { priceMinor: price_minor } : {}),
        ...(message !== undefined ? { message } : {}),
      });
      if (!played.ok) return mcpJson(played.body, true);
      const pauseQuestions = Array.isArray(played.body.pause_questions)
        ? played.body.pause_questions.filter((q): q is string => typeof q === "string")
        : [];
      const rounds = await getRoundsBySessionId(db, session_id);
      const latest = rounds.at(-1);
      const latestMeta = (latest?.metadata as Record<string, unknown> | null) ?? null;
      const transcript = mcpNegotiationTranscript(
        toTranscriptRounds(rounds),
        Number(played.body.current_round ?? latest?.roundNo ?? 0),
      );
      const lastMsg = transcript.recent_messages.at(-1);
      const speaker =
        lastMsg?.speaker ??
        spokenRoundSpeaker({
          senderRole: latest?.senderRole,
          message: lastMsg?.message,
          heldForCriteriaPause: isSellerCriteriaPauseReasoning(latestMeta?.reasoning),
        });
      const spoken = lastMsg?.message ?? null;
      const spokenPrice =
        lastMsg?.price_minor ??
        spokenRoundPriceMinor({
          priceMinor: latest?.priceminor,
          counterPriceMinor: latest?.counterPriceMinor,
        });
      const talk = negotiationSayToUser({
        counterpartRole: speaker,
        counterpartMessage: spoken,
        decision:
          typeof played.body.decision === "string"
            ? played.body.decision
            : (latest?.decision ?? null),
        priceMinor: spokenPrice,
        pauseQuestions,
        sessionStatus:
          typeof played.body.session_status === "string" ? played.body.session_status : undefined,
      });
      return mcpJson({
        ...played.body,
        speaker,
        spoken_price_minor: spokenPrice,
        message: spoken,
        current_round: transcript.current_round,
        recent_messages: transcript.recent_messages,
        summary_markdown: negotiationSummaryMarkdown(
          expandMcpTranscript(toTranscriptRounds(rounds)),
          typeof played.body.session_status === "string" ? played.body.session_status : null,
          negotiationChatUrl(session_id),
        ),
        ...talk,
        instruction: "Speak say_to_user now. Ask ask_user. Do not stop silently.",
      });
    },
  );

  server.tool(
    "haggle_play_until",
    "Delegate mode: advance auto-play rounds until the session is terminal, paused, or the round cap is hit. Returns transcript_summary (per round: who, price_minor, one line) and chat_url. For consult mode use haggle_play_next each round instead. Show summary_markdown (round table with seller offer / my offer / note, status, chat_url link) to the user instead of dumping every message; the structured fields remain for follow-up.",
    {
      session_id: z.string().uuid(),
      max_rounds: z.number().int().min(1).max(8).optional(),
    },
    async ({ session_id, max_rounds }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const cap = max_rounds ?? 8;
      const steps: unknown[] = [];
      let last: Record<string, unknown> = { complete: false, message: "Stopped at max_rounds" };
      let failed = false;
      for (let i = 0; i < cap; i += 1) {
        const played = await executeAutoPlayNext(db, {
          sessionId: session_id,
          actor,
          expectedDriver: "mcp",
          eventDispatcher,
        });
        steps.push(played.body);
        if (!played.ok || played.body.complete || played.body.paused_for_buyer) {
          last = played.body;
          failed = !played.ok;
          break;
        }
      }
      const rounds = await getRoundsBySessionId(db, session_id);
      const transcript = buildMcpGetNegotiationExpandView(toTranscriptRounds(rounds), 0, [
        "transcript",
      ]).transcript;
      return mcpJson(
        {
          steps,
          ...last,
          transcript_summary: summarizeTranscript(transcript ?? []),
          summary_markdown: negotiationSummaryMarkdown(
            transcript ?? [],
            typeof last.session_status === "string" ? last.session_status : null,
            negotiationChatUrl(session_id),
          ),
          chat_url: negotiationChatUrl(session_id),
        },
        failed,
      );
    },
  );

  server.tool(
    "haggle_answer_pause",
    "Answer a seller-criteria pause so auto-play can continue. Same as POST /pause/answer.",
    {
      session_id: z.string().uuid(),
      answer: z.string().max(2000).optional(),
      stances: z
        .array(z.object({ checkId: z.string().min(1), stance: z.string().max(2000) }))
        .optional(),
    },
    async ({ session_id, answer, stances }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const session = await getSessionById(db, session_id);
      if (!session) return mcpError("SESSION_NOT_FOUND");
      if (actor.id !== session.buyerId) return mcpError("PAUSE_ANSWER_BUYER_ONLY");
      const context = getNegotiationAutoPlayContext(session.negotiationAgentSnapshot);
      if (!context) return mcpError("AUTO_PLAY_CONTEXT_MISSING");
      const startReject = buyerCriteriaRequiredReject(context.buyerSnapshot);
      if (startReject) return mcpJson(startReject, true);
      const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(
        context.buyerSnapshot,
      );
      const unresolved = unresolvedSellerRequirements(sellerRequired, buyerCriteria);
      if (unresolved.length === 0) {
        return mcpJson({ ok: true, resolved: true, remaining_check_ids: [] });
      }
      const stanceByCheckId = new Map<string, string>();
      for (const item of stances ?? []) {
        if (item.stance.trim()) stanceByCheckId.set(item.checkId, item.stance.trim());
      }
      const { buyerSnapshot: newBuyerSnapshot, applied } = applyBuyerPauseAnswer(
        context.buyerSnapshot,
        unresolved,
        stanceByCheckId,
        answer,
      );
      if (applied === 0) {
        return mcpError("PAUSE_ANSWER_EMPTY", {
          pause_check_ids: unresolved.map((c) => c.checkId),
        });
      }
      const newContext = { ...context, buyerSnapshot: newBuyerSnapshot };
      const persisted = await setSessionPerspective(
        db,
        session.id,
        session.role,
        attachNegotiationAutoPlayContext(newBuyerSnapshot, newContext),
        session.version,
      );
      if (!persisted) return mcpError("CONCURRENT_MODIFICATION");
      const rounds = await getRoundsBySessionId(db, session.id);
      const askingRound = [...rounds]
        .reverse()
        .find((round) =>
          String((round.metadata as Record<string, unknown> | null)?.reasoning ?? "").includes(
            SELLER_CRITERIA_PAUSE_MARKER,
          ),
        );
      if (askingRound) {
        await recordPauseAnswersOnRound(
          db,
          askingRound.id,
          unresolved.flatMap((criterion) => {
            const stance = stanceByCheckId.get(criterion.checkId) ?? answer?.trim();
            if (!stance) return [];
            return [
              {
                checkId: criterion.checkId,
                ask: (criterion.buyerAskKo ?? criterion.questionKo)?.trim() ?? criterion.checkId,
                stance,
              },
            ];
          }),
        ).catch(() => {});
      }
      return mcpJson({
        ok: true,
        applied,
        chat_url: negotiationChatUrl(session.id),
      });
    },
  );

  server.tool(
    "haggle_reject_negotiation",
    "Reject an open negotiation. Same as PATCH /negotiations/sessions/:id/reject.",
    { session_id: z.string().uuid() },
    async ({ session_id }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const session = await getSessionById(db, session_id);
      if (!session) return mcpError("SESSION_NOT_FOUND");
      const access = validateSessionParticipant(actor, session);
      if (!access.ok) return mcpError(access.error);
      if (["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"].includes(session.status)) {
        return mcpError("SESSION_TERMINAL", { session_status: session.status });
      }
      const updated = await updateSessionState(db, session.id, session.version, {
        status: "REJECTED",
      });
      if (!updated) return mcpError("CONCURRENT_MODIFICATION");
      if (eventDispatcher) {
        await eventDispatcher
          .dispatch({
            domain: "negotiation",
            type: "negotiation.session.terminal",
            payload: {
              session_id: session.id,
              terminal_status: "REJECTED",
              intent_id: session.intentId,
            },
            idempotency_key: `neg_terminal_${session.id}_REJECTED`,
            timestamp: Date.now(),
          })
          .catch(() => {});
        if (session.groupId) {
          await executeGroupTerminal(
            db,
            session.groupId,
            session.id,
            "REJECTED",
            eventDispatcher,
          ).catch(() => {});
        }
      }
      return mcpJson({ updated: true, session_status: "REJECTED" });
    },
  );

  server.tool(
    "haggle_create_checkout",
    "Return the web checkout URL after ACCEPTED. MCP never signs wallets or moves money.",
    { session_id: z.string().uuid() },
    async ({ session_id }) => {
      const scoped = requireScopedActor("orders");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const session = await getSessionById(db, session_id);
      if (!session) return mcpError("SESSION_NOT_FOUND");
      if (actor.id !== session.buyerId) return mcpError("CHECKOUT_BUYER_ONLY");
      if (session.status !== "ACCEPTED") {
        return mcpError("SESSION_NOT_ACCEPTED", { session_status: session.status });
      }
      const approval = await getSettlementApprovalById(db, session.id);
      if (approval?.approval_state !== "APPROVED" || approval.terms.buyer_id !== actor.id) {
        return mcpError("CHECKOUT_NOT_READY");
      }
      return mcpJson({
        checkout_url: checkoutUrl(session.id),
        message:
          "Open this URL while logged in to sign the wallet or complete card on-ramp. MCP does not move money.",
      });
    },
  );

  server.tool(
    "haggle_get_order",
    "Get the commerce order for a session or order id. Read-only.",
    {
      session_id: z.string().uuid().optional(),
      order_id: z.string().uuid().optional(),
    },
    async ({ session_id, order_id }) => {
      const scoped = requireScopedActor("orders");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const order = order_id
        ? await getCommerceOrderByOrderId(db, order_id)
        : session_id
          ? await getCommerceOrderBySettlementApprovalId(db, session_id)
          : null;
      if (!order) return mcpError("ORDER_NOT_FOUND");
      if (actor.role !== "admin" && actor.id !== order.buyerId && actor.id !== order.sellerId) {
        return mcpError("FORBIDDEN");
      }
      return mcpJson({
        order: {
          id: order.id,
          status: order.status,
          amount_minor: order.amountMinor,
          currency: order.currency,
          listing_id: order.listingId,
        },
        order_url: `${publicAppBaseUrl()}/orders/${order.id}`,
      });
    },
  );

  server.tool(
    "haggle_get_shipment",
    "Get shipment status for an order. Labels are created on the web.",
    { order_id: z.string().uuid() },
    async ({ order_id }) => {
      const scoped = requireScopedActor("orders");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const order = await getCommerceOrderByOrderId(db, order_id);
      if (!order) return mcpError("ORDER_NOT_FOUND");
      if (actor.role !== "admin" && actor.id !== order.buyerId && actor.id !== order.sellerId) {
        return mcpError("FORBIDDEN");
      }
      const shipment = await getShipmentByOrderId(db, order_id);
      return mcpJson({
        shipment: shipment
          ? {
              id: shipment.id,
              status: shipment.status,
              carrier: shipment.carrier,
              tracking_number: shipment.tracking_number ?? null,
            }
          : null,
        message: "Create or print shipping labels on the web.",
        shipment_url: `${publicAppBaseUrl()}/orders/${order_id}`,
      });
    },
  );

  server.tool(
    "haggle_start_dispute",
    "Open a dispute on an order the connected user is a party to. File evidence on the web. MCP does not move money.",
    {
      order_id: z.string().uuid(),
      reason_code: z.string().min(1),
      text: z.string().max(2000).optional(),
    },
    async ({ order_id, reason_code, text }) => {
      const scoped = requireScopedActor("disputes");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const order = await getCommerceOrderByOrderId(db, order_id);
      if (!order) return mcpError("ORDER_NOT_FOUND");
      let openedBy: "buyer" | "seller";
      if (actor.id === order.buyerId) openedBy = "buyer";
      else if (actor.id === order.sellerId) openedBy = "seller";
      else return mcpError("FORBIDDEN", { message: "You are not a party to this order" });
      if (!(reason_code in REASON_CODE_REGISTRY)) {
        return mcpError("INVALID_REASON_CODE");
      }
      const orderGate = describeDisputeOrderGate(order.status);
      if (!orderGate.disputable) {
        return mcpError("ORDER_NOT_DISPUTABLE", {
          order_status: orderGate.order_status,
          blocking_gate: orderGate.blocking_gate,
          message: orderGate.message,
          hint: orderGate.hint,
          staging_fixture: orderGate.staging_fixture,
        });
      }
      const shipment = await getShipmentByOrderId(db, order_id);
      const eligibility = evaluateDisputeOpeningEligibility({
        reasonCode: reason_code as DisputeReasonCode,
        openedBy,
        orderStatus: order.status,
        shipment,
      });
      if (!eligibility.eligible) {
        return mcpJson({ error: "NOT_ELIGIBLE", ...eligibility }, true);
      }
      const existing = await getDisputeByOrderId(db, order_id);
      if (
        existing &&
        !["CLOSED", "RESOLVED_BUYER_FAVOR", "RESOLVED_SELLER_FAVOR", "PARTIAL_REFUND"].includes(
          existing.status,
        )
      ) {
        return mcpJson(
          {
            error: "ACTIVE_DISPUTE_EXISTS",
            dispute_id: existing.id,
            evidence_url: `${publicAppBaseUrl()}/disputes/${existing.id}`,
          },
          true,
        );
      }
      const opened = new DisputeService().openCase({
        order_id,
        reason_code: reason_code as DisputeReasonCode,
        opened_by: openedBy,
        initial_evidence: text ? [{ submitted_by: openedBy, type: "text", text }] : [],
      });
      try {
        if (typeof db.transaction === "function") {
          await db.transaction(async (tx) => {
            const txDb = tx as unknown as Database;
            await createDisputeRecord(txDb, opened.dispute);
            await updateCommerceOrderStatus(txDb, order_id, "IN_DISPUTE");
          });
        } else {
          await createDisputeRecord(db, opened.dispute);
          await updateCommerceOrderStatus(db, order_id, "IN_DISPUTE");
        }
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          return mcpError("ACTIVE_DISPUTE_EXISTS");
        }
        throw error;
      }
      const testContractLock = lockTestContractForDisputeOpen(order_id, opened.dispute.id);
      return mcpJson({
        dispute_id: opened.dispute.id,
        evidence_url: `${publicAppBaseUrl()}/disputes/${opened.dispute.id}`,
        message: "Dispute opened. Upload evidence on the web.",
        test_contract_lock: testContractLock.locked
          ? {
              locked: true,
              idempotent: testContractLock.idempotent,
              status: testContractLock.entry.status,
            }
          : { locked: false, reason: testContractLock.reason },
      });
    },
  );
}
