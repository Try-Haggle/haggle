#!/usr/bin/env npx tsx
/**
 * Cross-Language Negotiation Simulation
 *
 * Simulates a Korean buyer negotiating with a Spanish seller
 * for an iPhone 15 Pro, showing both sides' messages.
 */

// Inline the essential types and logic to avoid cross-package import issues

interface ProtocolDecision {
  action: string;
  price?: number;
  reasoning?: string;
  tactic_used?: string;
}
interface BuddyTone {
  style: 'professional' | 'friendly' | 'analytical' | 'assertive' | 'casual';
  formality: 'formal' | 'informal';
  emoji_use: boolean;
  signature_phrases: string[];
}

// ─── Language Detection (from language-detect.ts) ────────────────────
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g;
const KANA = /[\u3040-\u309F\u30A0-\u30FF]/g;
const CJK = /[\u4E00-\u9FFF]/g;
const VIET = /[\u01A0\u01A1\u01AF\u01B0\u0102\u0103\u0110\u0111\u1EA0-\u1EF9]/g;
const ES = /[ñ¿¡]/g;

function detectLanguage(text: string) {
  const clean = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (!clean) return { locale: "en", confidence: 0.5, script: "none" };
  const t = clean.length;
  if ((clean.match(HANGUL) || []).length / t > 0.3) return { locale: "ko", confidence: 0.9, script: "hangul" };
  if ((clean.match(KANA) || []).length / t > 0.1) return { locale: "ja", confidence: 0.85, script: "kana" };
  if ((clean.match(CJK) || []).length / t > 0.3) return { locale: "zh", confidence: 0.85, script: "cjk" };
  if ((clean.match(VIET) || []).length >= 2) return { locale: "vi", confidence: 0.8, script: "vietnamese" };
  if ((clean.match(ES) || []).length >= 1) return { locale: "es", confidence: 0.8, script: "spanish" };
  return { locale: "en", confidence: 0.7, script: "latin" };
}

// ─── Templates (simplified from message-renderer.ts) ─────────────────
const T: Record<string, Record<string, (p: string, style: string, role: string) => string>> = {
  en: {
    COUNTER: (p, s) => s === 'professional' ? `I'd like to propose ${p}.` : `How about ${p}? Pretty fair!`,
    ACCEPT: (p, s) => s === 'professional' ? `Agreed at ${p}. Let's proceed.` : `Deal at ${p}! Glad we worked this out!`,
    REJECT: (_, s) => s === 'professional' ? `I appreciate the offer, but I'll need to pass.` : `Thanks, but that doesn't work. Got a better number?`,
    HOLD: () => `Let me review the current terms.`,
    DISCOVER: (_, s, r) => r === 'buyer' ? `Could you tell me more about the condition?` : `Happy to provide details. What would you like to know?`,
    CONFIRM: (p) => `Confirmed at ${p}. Ready for settlement.`,
  },
  ko: {
    COUNTER: (p, s) => s === 'professional' ? `${p}을 제안드립니다.` : `${p} 어떠세요? 합리적인 가격이라고 생각해요!`,
    ACCEPT: (p, s) => s === 'professional' ? `${p}에 합의합니다. 진행하겠습니다.` : `좋아요, ${p}에 거래 성사! 잘 됐네요!`,
    REJECT: (_, s) => s === 'professional' ? `제안 감사드리지만, 이 조건으로는 어렵습니다.` : `감사하지만 좀 어려울 것 같아요. 다시 제안해주실 수 있나요?`,
    HOLD: () => `잠시 현재 조건을 검토하겠습니다.`,
    DISCOVER: (_, s, r) => r === 'buyer' ? `제품 상태에 대해 자세히 알려주실 수 있나요?` : `편하게 물어보세요! 뭐든 답해드릴게요.`,
    CONFIRM: (p) => `${p}에 확인합니다. 결제로 진행합니다.`,
  },
  es: {
    COUNTER: (p, s) => s === 'professional' ? `Me gustaría proponer ${p}.` : `¿Qué te parece ${p}?`,
    ACCEPT: (p, s) => s === 'professional' ? `De acuerdo en ${p}. Procedamos.` : `¡Trato hecho en ${p}!`,
    REJECT: (_, s) => s === 'professional' ? `Agradezco la oferta, pero no puedo aceptar.` : `Lo siento, ese precio no me funciona. ¿Algo mejor?`,
    HOLD: () => `Permíteme un momento para revisar.`,
    DISCOVER: (_, s, r) => r === 'buyer' ? `¿Podrías darme más detalles sobre el estado?` : `¡Pregunta lo que quieras!`,
    CONFIRM: (p) => `Confirmado en ${p}. Procedemos al pago.`,
  },
  ja: {
    COUNTER: (p, s) => s === 'professional' ? `${p}をご提案いたします。` : `${p}はいかがでしょうか？`,
    ACCEPT: (p, s) => s === 'professional' ? `${p}で合意いたします。` : `${p}で取引成立！`,
    REJECT: (_, s) => s === 'professional' ? `ご提案ありがとうございますが、難しいです。` : `すみません、ちょっと難しいです。`,
    HOLD: () => `少々お待ちください。`,
    DISCOVER: (_, s, r) => r === 'buyer' ? `商品の状態について教えていただけますか？` : `何でもお聞きください。`,
    CONFIRM: (p) => `${p}で確定します。決済に進みます。`,
  },
  vi: {
    COUNTER: (p, s) => s === 'professional' ? `Tôi đề xuất mức giá ${p}.` : `${p} được không bạn?`,
    ACCEPT: (p, s) => s === 'professional' ? `Đồng ý với giá ${p}.` : `Deal ${p}! Tuyệt vời!`,
    REJECT: (_, s) => s === 'professional' ? `Cảm ơn, nhưng tôi không thể chấp nhận.` : `Xin lỗi, giá này hơi cao.`,
    HOLD: () => `Xin chờ một chút.`,
    DISCOVER: (_, s, r) => r === 'buyer' ? `Bạn cho tôi biết tình trạng sản phẩm?` : `Bạn cứ hỏi!`,
    CONFIRM: (p) => `Xác nhận giá ${p}. Chuyển sang thanh toán.`,
  },
  zh: {
    COUNTER: (p, s) => s === 'professional' ? `我提议${p}。` : `${p}怎么样？`,
    ACCEPT: (p, s) => s === 'professional' ? `以${p}达成协议。` : `${p}成交！`,
    REJECT: (_, s) => s === 'professional' ? `感谢报价，但无法接受。` : `不好意思，价格不太合适。`,
    HOLD: () => `请稍等，确认条件。`,
    DISCOVER: (_, s, r) => r === 'buyer' ? `能介绍一下商品状况吗？` : `请随时提问！`,
    CONFIRM: (p) => `以${p}确认成交。`,
  },
};

function render(locale: string, action: string, price: number | undefined, style: string, role: string): string {
  const p = price ? `$${price}` : '';
  const templates = T[locale] ?? T.en!;
  const fn = templates[action] ?? (() => `${action} ${p}`);
  return fn(p, style, role);
}

// Using inline render function (no cross-package imports needed)

// ─── Setup ────────────────────────────────────────────────────────────

const BUYER_LOCALE = "ko";
const SELLER_LOCALE = "es";

const buyerTone: BuddyTone = {
  style: "friendly",
  formality: "informal",
  emoji_use: true,
  signature_phrases: [],
};

const sellerTone: BuddyTone = {
  style: "professional",
  formality: "formal",
  emoji_use: false,
  signature_phrases: [],
};

function renderBothSides(
  decision: ProtocolDecision,
  senderRole: "buyer" | "seller",
  tone: BuddyTone,
) {
  const senderLocale = senderRole === "buyer" ? BUYER_LOCALE : SELLER_LOCALE;
  const counterpartyLocale = senderRole === "buyer" ? SELLER_LOCALE : BUYER_LOCALE;

  const senderMsg = render(senderLocale, decision.action, decision.price, tone.style, senderRole);
  const counterpartyMsg = render(counterpartyLocale, decision.action, decision.price, tone.style, senderRole);

  return { senderMsg, counterpartyMsg };
}

// ─── Language Detection Demo ──────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════");
console.log("  🌐 Cross-Language Negotiation Simulation");
console.log("  Korean Buyer 🇰🇷 ↔ Spanish Seller 🇪🇸");
console.log("  iPhone 15 Pro 256GB — Asking price: $650");
console.log("═══════════════════════════════════════════════════════════════\n");

// Test language detection
console.log("── Language Detection ──────────────────────────────────────\n");
const testInputs = [
  { text: "이 아이폰 상태가 어때요?", expected: "ko" },
  { text: "¿Cuál es el estado de la batería?", expected: "es" },
  { text: "What's the battery health?", expected: "en" },
  { text: "Tình trạng pin thế nào?", expected: "vi" },
  { text: "这个手机电池怎么样？", expected: "zh" },
  { text: "バッテリーの状態はどうですか？", expected: "ja" },
];

for (const { text, expected } of testInputs) {
  const result = detectLanguage(text);
  const match = result.locale === expected ? "✅" : "❌";
  console.log(`  ${match} "${text}"`);
  console.log(`     → detected: ${result.locale} (${result.script}, confidence: ${result.confidence.toFixed(2)})\n`);
}

// ─── Negotiation Simulation ───────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  📋 Negotiation Rounds");
console.log("═══════════════════════════════════════════════════════════════\n");

interface Round {
  num: number;
  phase: "DISCOVERY" | "OPENING" | "BARGAINING" | "CLOSING";
  sender: "buyer" | "seller";
  decision: ProtocolDecision;
}

const rounds: Round[] = [
  // Round 1: Discovery
  {
    num: 1,
    phase: "DISCOVERY",
    sender: "buyer",
    decision: { action: "DISCOVER", reasoning: "Want to know item condition" },
  },
  {
    num: 1,
    phase: "DISCOVERY",
    sender: "seller",
    decision: { action: "DISCOVER", reasoning: "Sharing item details" },
  },
  // Round 2: Opening
  {
    num: 2,
    phase: "OPENING",
    sender: "buyer",
    decision: { action: "COUNTER", price: 520, reasoning: "Opening offer below market", tactic_used: "anchoring" },
  },
  // Round 3: Seller counter
  {
    num: 3,
    phase: "BARGAINING",
    sender: "seller",
    decision: { action: "COUNTER", price: 610, reasoning: "Counter above target", tactic_used: "reciprocal_concession" },
  },
  // Round 4: Buyer counter
  {
    num: 4,
    phase: "BARGAINING",
    sender: "buyer",
    decision: { action: "COUNTER", price: 560, reasoning: "Faratin curve counter", tactic_used: "reciprocal_concession" },
  },
  // Round 5: Seller counter
  {
    num: 5,
    phase: "BARGAINING",
    sender: "seller",
    decision: { action: "COUNTER", price: 585, reasoning: "Getting closer", tactic_used: "reciprocal_concession" },
  },
  // Round 6: Buyer accepts
  {
    num: 6,
    phase: "BARGAINING",
    sender: "buyer",
    decision: { action: "ACCEPT", price: 585, reasoning: "Gap < 5%, accepting", tactic_used: "near_deal_acceptance" },
  },
  // Round 7: Confirm
  {
    num: 7,
    phase: "CLOSING",
    sender: "seller",
    decision: { action: "CONFIRM", price: 585, reasoning: "Confirming deal" },
  },
];

for (const round of rounds) {
  const tone = round.sender === "buyer" ? buyerTone : sellerTone;
  const { senderMsg, counterpartyMsg } = renderBothSides(
    round.decision,
    round.sender,
    tone,
  );

  const senderFlag = round.sender === "buyer" ? "🇰🇷 Buyer" : "🇪🇸 Seller";
  const senderLocale = round.sender === "buyer" ? "ko" : "es";
  const counterpartyFlag = round.sender === "buyer" ? "🇪🇸 Seller" : "🇰🇷 Buyer";
  const counterpartyLocale = round.sender === "buyer" ? "es" : "ko";

  console.log(`── Round ${round.num} · ${round.phase} · ${round.decision.action}${round.decision.price ? ` $${round.decision.price}` : ""} ──`);
  console.log();
  console.log(`  ${senderFlag} sees (${senderLocale}):`);
  console.log(`    "${senderMsg}"`);
  console.log();
  console.log(`  ${counterpartyFlag} sees (${counterpartyLocale}):`);
  console.log(`    "${counterpartyMsg}"`);
  console.log();

  // Show internal protocol decision
  console.log(`  ⚙️  Internal: { action: "${round.decision.action}"${round.decision.price ? `, price: ${round.decision.price}` : ""} }`);
  console.log();
}

// ─── Summary ──────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════");
console.log("  ✅ Deal closed at $585");
console.log("  🇰🇷 Buyer saw everything in Korean");
console.log("  🇪🇸 Seller saw everything in Spanish");
console.log("  ⚙️  Internal processing: all English");
console.log("  💰 Translation cost: $0 (template-based)");
console.log("═══════════════════════════════════════════════════════════════");
