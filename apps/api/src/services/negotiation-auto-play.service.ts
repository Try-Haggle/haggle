import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isProductionRuntime } from "../config/runtime.js";

const CONTEXT_KEY = "auto_play_context";
const TERMINAL_STATUSES = new Set([
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "NEAR_DEAL",
  "STALLED",
]);

export interface NegotiationAutoPlayContext {
  version: 1 | 2;
  runTokenHash: string;
  buyerTargetMinor: number;
  maxRounds: number;
  buyerSnapshot: Record<string, unknown>;
  sellerSnapshot: Record<string, unknown>;
}

export interface NegotiationAutoPlayRound {
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  priceminor: string;
  counterPriceMinor: string | null;
  message: string | null;
}

export interface NegotiationAutoPlaySession {
  status: string;
  currentRound: number;
  role: "BUYER" | "SELLER";
  negotiationAgentSnapshot: Record<string, unknown>;
}

export interface NegotiationAutoPlayPlan {
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  responderRole: "BUYER" | "SELLER";
  responderSnapshot: Record<string, unknown>;
  offerPriceMinor: number;
  messageText: string;
}

export function attachNegotiationAutoPlayContext(
  snapshot: Record<string, unknown>,
  context: NegotiationAutoPlayContext,
): Record<string, unknown> {
  return {
    ...stripAutoPlayContext(snapshot),
    [CONTEXT_KEY]: sealAutoPlayContext(context),
  };
}

export function createNegotiationAutoPlaySetup(input: {
  buyerSnapshot: Record<string, unknown>;
  sellerSnapshot: Record<string, unknown>;
  buyerTargetMinor: number;
  maxRounds: number;
}): {
  runToken: string;
  buyerSnapshot: Record<string, unknown>;
  sellerSnapshot: Record<string, unknown>;
} {
  const runToken = randomBytes(32).toString("base64url");
  const context: NegotiationAutoPlayContext = {
    version: 2,
    runTokenHash: hashRunToken(runToken),
    buyerTargetMinor: input.buyerTargetMinor,
    maxRounds: input.maxRounds,
    buyerSnapshot: stripAutoPlayContext(input.buyerSnapshot),
    sellerSnapshot: stripAutoPlayContext(input.sellerSnapshot),
  };

  return {
    runToken,
    buyerSnapshot: attachNegotiationAutoPlayContext(input.buyerSnapshot, context),
    sellerSnapshot: attachNegotiationAutoPlayContext(input.sellerSnapshot, context),
  };
}

export function getNegotiationAutoPlayContext(
  snapshot: Record<string, unknown>,
): NegotiationAutoPlayContext | null {
  const value = snapshot[CONTEXT_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Partial<NegotiationAutoPlayContext>;
  if (
    (context.version !== 1 && context.version !== 2) ||
    typeof context.runTokenHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(context.runTokenHash) ||
    !Number.isInteger(context.buyerTargetMinor) ||
    (context.buyerTargetMinor ?? 0) <= 0 ||
    !Number.isInteger(context.maxRounds) ||
    (context.maxRounds ?? 0) <= 0 ||
    (context.maxRounds ?? 0) > 32
  ) {
    return null;
  }

  if (context.version === 2) {
    const stored = value as Partial<SealedAutoPlayContext>;
    if (
      typeof stored.sealedBuyerSnapshot !== "string" ||
      typeof stored.sealedSellerSnapshot !== "string"
    ) {
      return null;
    }
    return openSealedAutoPlayContext({
      version: 2,
      runTokenHash: context.runTokenHash,
      buyerTargetMinor: context.buyerTargetMinor as number,
      maxRounds: context.maxRounds as number,
      sealedBuyerSnapshot: stored.sealedBuyerSnapshot,
      sealedSellerSnapshot: stored.sealedSellerSnapshot,
    });
  }

  if (
    !context.buyerSnapshot ||
    typeof context.buyerSnapshot !== "object" ||
    Array.isArray(context.buyerSnapshot) ||
    !context.sellerSnapshot ||
    typeof context.sellerSnapshot !== "object" ||
    Array.isArray(context.sellerSnapshot)
  ) {
    return null;
  }
  return context as NegotiationAutoPlayContext;
}

export function validateNegotiationAutoPlayToken(
  context: NegotiationAutoPlayContext,
  runToken: string | undefined,
): boolean {
  if (!runToken) return false;
  const expected = Buffer.from(context.runTokenHash, "hex");
  const actual = Buffer.from(hashRunToken(runToken), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isNegotiationAutoPlayTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function planNegotiationAutoPlayRound(
  session: NegotiationAutoPlaySession,
  rounds: NegotiationAutoPlayRound[],
  context: NegotiationAutoPlayContext,
): NegotiationAutoPlayPlan | null {
  if (isNegotiationAutoPlayTerminal(session.status) || session.currentRound >= context.maxRounds) {
    return null;
  }

  const latestRound = rounds.at(-1);
  // A persisted round records the incoming sender. The generated response came
  // from the opposite role, which becomes the sender of the next round. Derive
  // this from durable round data rather than the mutable session perspective so
  // a retry after a failed request cannot accidentally swap sides.
  const senderRole: "BUYER" | "SELLER" = latestRound
    ? latestRound.senderRole === "BUYER"
      ? "SELLER"
      : "BUYER"
    : "BUYER";
  const responderRole: "BUYER" | "SELLER" = senderRole === "BUYER" ? "SELLER" : "BUYER";
  const latestOutgoing = latestRound
    ? Number(latestRound.counterPriceMinor ?? latestRound.priceminor)
    : context.buyerTargetMinor;
  if (!Number.isFinite(latestOutgoing) || latestOutgoing <= 0) return null;

  const offerPriceMinor =
    senderRole === "BUYER" ? Math.max(context.buyerTargetMinor, latestOutgoing) : latestOutgoing;
  const offerDollars = (offerPriceMinor / 100).toFixed(2);
  const messageText =
    latestRound?.message?.trim() ||
    (latestRound
      ? `Thanks for the response. I can do $${offerDollars}.`
      : `Hi, I'm interested in this listing. I'd like to offer $${offerDollars}.`);

  return {
    roundNo: session.currentRound + 1,
    senderRole,
    responderRole,
    responderSnapshot: responderRole === "SELLER" ? context.sellerSnapshot : context.buyerSnapshot,
    offerPriceMinor,
    messageText,
  };
}

function hashRunToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

interface SealedAutoPlayContext {
  version: 2;
  runTokenHash: string;
  buyerTargetMinor: number;
  maxRounds: number;
  sealedBuyerSnapshot: string;
  sealedSellerSnapshot: string;
}

function stripAutoPlayContext(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { [CONTEXT_KEY]: _dropped, ...rest } = snapshot;
  return rest;
}

function sealAutoPlayContext(context: NegotiationAutoPlayContext): SealedAutoPlayContext {
  return {
    version: 2,
    runTokenHash: context.runTokenHash,
    buyerTargetMinor: context.buyerTargetMinor,
    maxRounds: context.maxRounds,
    sealedBuyerSnapshot: sealJson(stripAutoPlayContext(context.buyerSnapshot)),
    sealedSellerSnapshot: sealJson(stripAutoPlayContext(context.sellerSnapshot)),
  };
}

function openSealedAutoPlayContext(
  stored: SealedAutoPlayContext,
): NegotiationAutoPlayContext | null {
  const buyerSnapshot = openJson(stored.sealedBuyerSnapshot);
  const sellerSnapshot = openJson(stored.sealedSellerSnapshot);
  if (!buyerSnapshot || !sellerSnapshot) return null;
  return {
    version: 2,
    runTokenHash: stored.runTokenHash,
    buyerTargetMinor: stored.buyerTargetMinor,
    maxRounds: stored.maxRounds,
    buyerSnapshot,
    sellerSnapshot,
  };
}

function sealKey(): Buffer {
  const secret =
    process.env.AUTO_PLAY_SEAL_SECRET?.trim() || process.env.SUPABASE_JWT_SECRET?.trim();
  if (secret) {
    return createHash("sha256").update(`haggle.autoplay.seal.v2:${secret}`).digest();
  }
  if (isProductionRuntime()) {
    throw new Error("AUTO_PLAY_SEAL_SECRET is required in production");
  }
  return createHash("sha256").update("haggle.autoplay.seal.dev").digest();
}

function sealJson(value: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function openJson(sealed: string): Record<string, unknown> | null {
  if (typeof sealed !== "string" || sealed.length === 0) return null;
  try {
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
