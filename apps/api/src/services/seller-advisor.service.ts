/**
 * Seller Advisor Service.
 *
 * Given the seller's chat message + current strategy memory + listing context,
 * calls GPT-4o-mini to:
 *   - Extract structured negotiation strategy hints from the seller's input
 *   - Return a conversational reply guiding the seller
 *
 * Pure LLM layer. No DB reads/writes. Never throws — failures returned as error string.
 */

import OpenAI from "openai";

export interface SellerStrategyMemory {
  dealBreakers: string[];      // 절대 안 되는 조건
  mustEmphasize: string[];     // 강조하고 싶은 부분 (e.g. "like new condition", "original box included")
  tone: "firm" | "friendly" | "flexible";
  urgency: "high" | "medium" | "low";
  notes: string[];             // 기타 자유 메모
}

export interface SellerAdvisorInput {
  message: string;
  previousMemory: SellerStrategyMemory;
  listingTitle: string;
  listingPrice: string;
  agentPreset: string;         // e.g. "gatekeeper", "diplomat"
}

export interface SellerAdvisorResult {
  memory: SellerStrategyMemory;
  reply: string;
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `You are a negotiation strategy advisor helping a seller configure their AI negotiation agent on Haggle — a P2P marketplace.

The seller has already chosen a negotiation agent preset (e.g. Gatekeeper, Diplomat). Your job is to help the seller add personal strategy preferences on top of that preset via natural conversation.

Extract the following from the seller's message and update the strategy memory accordingly:
- dealBreakers: conditions the seller will absolutely NOT accept (e.g. "no trades", "no local pickup only", "won't go below $X")
- mustEmphasize: things the seller wants the AI to highlight to buyers (e.g. "barely used", "original packaging", "includes all accessories")
- tone: how the seller wants the agent to communicate — "firm" (professional, assertive), "friendly" (warm, conversational), or "flexible" (open to creative deals)
- urgency: how fast the seller wants to close — "high" (needs to sell fast), "medium" (flexible), "low" (willing to wait for right buyer)
- notes: any other strategy hints that don't fit above categories

Reply in the same language the seller uses (Korean or English).
Keep replies concise (2–4 sentences). Confirm what you've captured and ask one follow-up question if useful.
Never make up information. Only extract what the seller explicitly states.

Respond with JSON:
{
  "memory": { "dealBreakers": [...], "mustEmphasize": [...], "tone": "firm|friendly|flexible", "urgency": "high|medium|low", "notes": [...] },
  "reply": "..."
}`;

export async function runSellerAdvisorTurn(
  input: SellerAdvisorInput,
): Promise<SellerAdvisorResult> {
  const client = getOpenAI();

  const userPrompt = `Listing: "${input.listingTitle}" — asking $${input.listingPrice}
Agent preset: ${input.agentPreset}
Current strategy memory: ${JSON.stringify(input.previousMemory)}

Seller says: "${input.message}"`;

  try {
    const resp = await client.chat.completions.create({
      model: process.env.AUTO_DETECT_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const content = resp.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { memory?: SellerStrategyMemory; reply?: string };

    return {
      memory: {
        dealBreakers: parsed.memory?.dealBreakers ?? input.previousMemory.dealBreakers,
        mustEmphasize: parsed.memory?.mustEmphasize ?? input.previousMemory.mustEmphasize,
        tone: parsed.memory?.tone ?? input.previousMemory.tone,
        urgency: parsed.memory?.urgency ?? input.previousMemory.urgency,
        notes: parsed.memory?.notes ?? input.previousMemory.notes,
      },
      reply: parsed.reply ?? "Got it! Anything else you'd like to add?",
    };
  } catch {
    return {
      memory: input.previousMemory,
      reply: "Sorry, I had trouble processing that. Could you rephrase?",
    };
  }
}

export function buildInitialSellerMemory(): SellerStrategyMemory {
  return {
    dealBreakers: [],
    mustEmphasize: [],
    tone: "friendly",
    urgency: "medium",
    notes: [],
  };
}
