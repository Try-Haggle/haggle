import { and, type Database, eq, inArray, negotiationAgents, or } from "@haggle/db";
import { type DisputeReasonCode, DisputeService, REASON_CODE_REGISTRY } from "@haggle/dispute-core";
import {
  DEFAULT_NEGOTIATION_AGENT_PRESET_ID,
  getNegotiationAgentPreset,
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
  isSellerCriteriaPauseReasoning,
  readSellerCriteriaFromSnapshot,
  SELLER_CRITERIA_PAUSE_MARKER,
  unresolvedBuyerPauseAsks,
} from "../../negotiation/phase/seller-criteria-pause.js";
import { mcpConnectHint } from "../../routes/mcp-oauth.js";
import { evaluateDisputeOpeningEligibility } from "../../services/dispute-opening-eligibility.service.js";
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
import { getShipmentByOrderId } from "../../services/shipment-record.service.js";
import {
  startBuyerNegotiation,
  startBuyerNegotiationSchema,
} from "../../services/start-buyer-negotiation.service.js";
import { negotiationSayToUser } from "./negotiation-talk.js";
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
  basePresetId: z.string().optional(),
  negotiationAgentPresetId: z.string().optional(),
  weights: weightsSchema.optional(),
  engineParams: z.record(z.unknown()).optional(),
  categoryAnswers: z.record(z.record(z.unknown())).optional(),
  voiceId: z.string().optional(),
  builderChatMemory: z
    .record(z.unknown())
    .optional()
    .transform((m) => sanitizePersistedBuilderMemory(m)),
});

function requireActor(): AuthUser | null {
  return getMcpActor() ?? null;
}

function requireScopedActor(scope: "agents" | "listings" | "negotiate" | "orders" | "disputes") {
  return requireActorWithScope(scope);
}

async function resolveBuyerPresetId(
  db: Database,
  actor: AuthUser,
  agentId: string | undefined,
): Promise<string> {
  const raw = agentId?.trim() || DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
  if (getNegotiationAgentPreset(raw)) return raw;
  if (!isListingId(raw)) {
    const byName = raw.toLowerCase();
    if (getNegotiationAgentPreset(byName)) return byName;
    return DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
  }
  const [agent] = await db
    .select()
    .from(negotiationAgents)
    .where(eq(negotiationAgents.id, raw))
    .limit(1);
  if (!agent || (!agent.isSystem && agent.userId !== actor.id)) {
    return DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
  }
  const config = agent.negotiationAgentConfig ?? {};
  const fromConfig = [config.basePresetId, config.negotiationAgentPresetId, agent.name].find(
    (value): value is string =>
      typeof value === "string" && Boolean(getNegotiationAgentPreset(value)),
  );
  return fromConfig ?? DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
}

function publicListingView(listing: {
  publicId: string | null;
  title: string | null;
  description?: string | null;
  category: string | null;
  condition: string | null;
  targetPrice: string | null;
  photoUrl: string | null;
  sellerId?: string | null;
}) {
  return {
    public_id: listing.publicId,
    title: listing.title,
    description: listing.description ?? null,
    category: listing.category,
    condition: listing.condition,
    target_price: listing.targetPrice,
    photo_url: listing.photoUrl,
    claimed: listing.sellerId === undefined ? undefined : Boolean(listing.sellerId),
    listing_url: listing.publicId ? `${publicAppBaseUrl()}/l/${listing.publicId}` : null,
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
    "Show the connected Haggle account. If no account is connected, returns sign-in and sign-up URLs.",
    {},
    async () => {
      const actor = requireActor();
      if (!actor) {
        return mcpJson({ connected: false, ...mcpConnectHint() });
      }
      return mcpJson({
        connected: true,
        user_id: actor.id,
        role: actor.role ?? "user",
        scopes: effectiveMcpScopes(actor),
      });
    },
  );

  server.tool(
    "haggle_search_listings",
    "Search published Haggle listings. Public — no account required.",
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

  server.tool(
    "haggle_get_listing",
    "Get a published listing by its public id (the /l/:publicId slug).",
    { public_id: z.string().min(1) },
    async ({ public_id }) => {
      const listing = await getPublishedListingByPublicId(db, public_id);
      if (!listing) return mcpError("LISTING_NOT_FOUND", { public_id });
      return mcpJson({ listing: publicListingView(listing) });
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
    "haggle_builder_chat_turn",
    "One Agent Studio builder turn. Same pipeline as POST /negotiations/agents/builder/chat-turn. Persists builderChatMemory when agent_id is a user-owned agent.",
    {
      ...negotiationAgentBuilderTurnBodySchema.omit({ user_id: true }).shape,
    },
    async (args) => {
      const scoped = requireScopedActor("agents");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      const parsed = negotiationAgentBuilderTurnBodySchema.safeParse({
        ...args,
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
        return mcpJson({ agent_id: args.agent_id ?? null, ...result });
      } catch {
        return mcpError("CHAT_TURN_FAILED");
      }
    },
  );

  server.tool(
    "haggle_start_negotiation",
    "Start a buyer negotiation on a published listing. Same as POST /negotiations/start. Requires a connected account that is not the seller. public_id may be the slug (jc6r2T3d) or the full /l/... URL. agent_id is optional — use a preset (hunter, balancer, closer, verifier), an id from haggle_list_agents, or omit it to use balancer. Do not invent user IDs.",
    {
      public_id: z.string().min(1),
      agent_id: z.string().min(1).optional(),
      deadline_hours: z
        .number()
        .positive()
        .max(24 * 14)
        .optional(),
    },
    async ({ public_id, agent_id, deadline_hours }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const actor = scoped.actor;
      try {
        const presetId = await resolveBuyerPresetId(db, actor, agent_id);
        const parsed = startBuyerNegotiationSchema.safeParse({
          listing_public_id: public_id,
          negotiation_agent_preset_id: presetId,
          deadline_hours,
        });
        if (!parsed.success) {
          return mcpError("INVALID_START_REQUEST", { issues: parsed.error.issues });
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
                started.body.error === "BUYER_IS_SELLER"
                  ? "The connected account owns this listing. Connect a different Haggle user as the buyer."
                  : started.body.error === "LISTING_NOT_FOUND"
                    ? "Pass the listing slug or https://app.staging.tryhaggle.ai/l/<slug>."
                    : started.body.error === "INSUFFICIENT_SCOPE"
                      ? "Reconnect and allow the negotiate permission."
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
          next_actions: ["haggle_play_next", "haggle_get_negotiation"],
          message:
            "Negotiation started. Call haggle_play_next to advance a round. Open chat_url to watch on the web.",
        });
      } catch (error) {
        return mcpError("START_NEGOTIATION_FAILED", {
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    },
  );

  server.tool(
    "haggle_get_negotiation",
    "Read the live negotiation. Immediately quote say_to_user to the human — that is the counterpart's line. If pause_questions are present, ask those next; do not treat them as the seller's bargain line. Do not stop silently.",
    { session_id: z.string().uuid() },
    async ({ session_id }) => {
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
      const storedQuestions = Array.isArray(latestMeta?.pause_questions)
        ? latestMeta.pause_questions.filter(
            (q): q is string => typeof q === "string" && Boolean(q.trim()),
          )
        : [];
      const pauseDump = storedQuestions.join(" ");
      const latestSpoken =
        latest?.message?.trim() && latest.message.trim() !== pauseDump
          ? latest.message.trim()
          : null;
      const recent = rounds.slice(-4).map((round) => {
        const meta = (round.metadata as Record<string, unknown> | null) ?? null;
        const held = isSellerCriteriaPauseReasoning(meta?.reasoning);
        return {
          round_no: round.roundNo,
          sender_role: held ? round.senderRole : round.senderRole,
          message: round.message,
          decision: round.decision,
          price_minor: round.priceminor,
          held_for_criteria_pause: held,
        };
      });
      const driver = session.driver === "mcp" ? "mcp" : "web";
      const nextActions: string[] = [];
      if (session.status === "ACCEPTED") nextActions.push("haggle_create_checkout");
      else if (!["REJECTED", "EXPIRED", "SUPERSEDED", "STALLED"].includes(session.status)) {
        if (pauseAsks.length > 0) nextActions.push("haggle_answer_pause");
        else if (driver === "mcp") nextActions.push("haggle_play_next");
        nextActions.push("haggle_reject_negotiation");
      }
      const talk = negotiationSayToUser({
        counterpartRole: latest?.senderRole ?? "SELLER",
        counterpartMessage: latestSpoken,
        decision: latest?.decision,
        priceMinor: latest?.priceminor ?? session.lastOfferPriceMinor,
        pauseQuestions: pauseAsks.map((c) => c.ask),
        sessionStatus: session.status,
      });
      return mcpJson({
        session_id: session.id,
        status: session.status,
        current_round: session.currentRound,
        driver,
        chat_url: negotiationChatUrl(session.id),
        last_offer_price_minor: session.lastOfferPriceMinor,
        recent_messages: recent,
        pause_questions: pauseAsks.map((c) => c.ask),
        pause_check_ids: pauseAsks.map((c) => c.checkId),
        next_actions: nextActions,
        ...talk,
        instruction:
          "Speak say_to_user now. Ask ask_user. Do not wait for the human to prompt you.",
      });
    },
  );

  server.tool(
    "haggle_play_next",
    "Advance one Haggle auto-play round (DeepSeek plays a side). After the tool returns, immediately quote say_to_user. If pause_questions appear, those are buyer checks — not the seller's bargain line.",
    { session_id: z.string().uuid() },
    async ({ session_id }) => {
      const scoped = requireScopedActor("negotiate");
      if (!scoped.ok) return scoped.error;
      const played = await executeAutoPlayNext(db, {
        sessionId: session_id,
        actor: scoped.actor,
        expectedDriver: "mcp",
        eventDispatcher,
      });
      if (!played.ok) return mcpJson(played.body, true);
      const pauseQuestions = Array.isArray(played.body.pause_questions)
        ? played.body.pause_questions.filter((q): q is string => typeof q === "string")
        : [];
      const talk = negotiationSayToUser({
        counterpartRole: "SELLER",
        counterpartMessage: typeof played.body.message === "string" ? played.body.message : null,
        decision: typeof played.body.decision === "string" ? played.body.decision : null,
        priceMinor:
          typeof played.body.last_offer_price_minor === "number" ||
          typeof played.body.last_offer_price_minor === "string"
            ? played.body.last_offer_price_minor
            : null,
        pauseQuestions,
        sessionStatus:
          typeof played.body.session_status === "string" ? played.body.session_status : undefined,
      });
      return mcpJson({
        ...played.body,
        ...talk,
        instruction: "Speak say_to_user now. Ask ask_user. Do not stop silently.",
      });
    },
  );

  server.tool(
    "haggle_play_until",
    "Advance auto-play rounds until the session is terminal, paused, or the round cap is hit.",
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
      for (let i = 0; i < cap; i += 1) {
        const played = await executeAutoPlayNext(db, {
          sessionId: session_id,
          actor,
          expectedDriver: "mcp",
          eventDispatcher,
        });
        steps.push(played.body);
        if (!played.ok || played.body.complete || played.body.paused_for_buyer) {
          return mcpJson({ steps, ...played.body }, !played.ok);
        }
      }
      return mcpJson({ steps, complete: false, message: "Stopped at max_rounds" });
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
      const disputable = new Set([
        "PAID",
        "FULFILLMENT_PENDING",
        "FULFILLMENT_ACTIVE",
        "DELIVERED",
        "IN_DISPUTE",
      ]);
      if (!disputable.has(order.status)) {
        return mcpError("ORDER_NOT_DISPUTABLE", { order_status: order.status });
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
      return mcpJson({
        dispute_id: opened.dispute.id,
        evidence_url: `${publicAppBaseUrl()}/disputes/${opened.dispute.id}`,
        message: "Dispute opened. Upload evidence on the web.",
      });
    },
  );
}
