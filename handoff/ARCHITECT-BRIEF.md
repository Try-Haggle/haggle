# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 14 — "Start Negotiation" Button → Intent API

### Context
The buyer landing page (`/l/[publicId]`) has a "Start Negotiation" button with no onClick handler. This step connects it to the WaitingIntent API to create a buyer intent, which can then be matched with the seller's listing.

### Flow
1. Buyer clicks "Start Negotiation"
2. Frontend creates a WaitingIntent via `POST /intents`
3. Frontend calls `POST /intents/trigger-match` to find immediate matches
4. If match found → show "Match found! Negotiation starting..." 
5. If no match → show "Intent registered! You'll be notified when a match is found."
6. Redirect to a negotiation status page or show inline status

### Build Order

#### 1. Create `apps/web/src/app/l/[publicId]/negotiation-api.ts`

```ts
import { api } from "@/lib/api-client";

export interface CreateIntentResponse {
  intent: {
    id: string;
    status: string;
  };
}

export async function createBuyerIntent(params: {
  userId: string;
  category: string;
  keywords: string[];
  listingId: string;
  agentPreset: string;
  targetPrice?: number;
}) {
  // Build a minimal strategy from the agent preset
  const strategy = buildStrategyFromPreset(params.agentPreset, params.targetPrice);

  return api.post<CreateIntentResponse>("/api/intents", {
    user_id: params.userId,
    role: "BUYER",
    category: params.category || "general",
    keywords: params.keywords || [],
    strategy,
    min_u_total: 0.3,
    max_active_sessions: 5,
    expires_in_days: 30,
  });
}

export async function triggerMatch(category: string, listingId: string) {
  return api.post<{ match_result: { matched: unknown[]; rejected: unknown[]; total_evaluated: number } }>(
    "/api/intents/trigger-match",
    {
      category,
      listing_id: listingId,
      context_template: {
        // Minimal context for matching — real context built server-side
        price: { current: 0, target: 0, limit: 0, opening: 0 },
        time: { round: 1, max_rounds: 10, deadline_pressure: 0 },
        risk: { trust_score: 0.5, escrow_active: true, dispute_rate: 0, is_first_transaction: false },
        relationship: { repeat_partner: false, total_history: 0, avg_concession: 0 },
      },
    },
  );
}

function buildStrategyFromPreset(presetId: string, targetPrice?: number) {
  // Map buyer agent presets to MasterStrategy-like objects
  // These are stored as strategy snapshots in the intent
  const presets: Record<string, Record<string, unknown>> = {
    fox: { aggression: 0.7, patience: 0.5, risk: 0.6, style: "aggressive" },
    owl: { aggression: 0.3, patience: 0.9, risk: 0.3, style: "analytical" },
    dolphin: { aggression: 0.5, patience: 0.7, risk: 0.4, style: "collaborative" },
    bear: { aggression: 0.9, patience: 0.3, risk: 0.8, style: "hardball" },
  };

  return {
    preset: presetId,
    params: presets[presetId] || presets.fox,
    target_price: targetPrice,
  };
}
```

#### 2. Update `buyer-landing.tsx` — Add onClick handler

Add state + handler:
```ts
const [negotiationState, setNegotiationState] = useState<"idle" | "loading" | "success" | "error">("idle");
const [negotiationMessage, setNegotiationMessage] = useState("");
```

Add onClick to the Start Negotiation button:
```ts
onClick={async () => {
  if (!selectedAgent) return;
  setNegotiationState("loading");

  try {
    // If user is not logged in, redirect to claim/auth page
    if (!user) {
      // Store intent in sessionStorage so we can create it after auth
      sessionStorage.setItem("pendingIntent", JSON.stringify({
        listingId: listing.id,
        publicId: listing.publicId,
        category: listing.category,
        agentPreset: selectedAgent,
      }));
      window.location.href = `/claim?redirect=/l/${listing.publicId}`;
      return;
    }

    const result = await createBuyerIntent({
      userId: user.email,  // user info passed as prop — use email or ID
      category: listing.category || "general",
      keywords: listing.tags || [],
      listingId: listing.id,
      agentPreset: selectedAgent,
      targetPrice: listing.targetPrice ? parseFloat(listing.targetPrice) : undefined,
    });

    setNegotiationState("success");
    setNegotiationMessage("Your negotiation agent is set up! Matching you with the seller...");

    // Try immediate match
    try {
      const match = await triggerMatch(listing.category || "general", listing.id);
      if (match.match_result.matched.length > 0) {
        setNegotiationMessage("Match found! Your agent will start negotiating shortly.");
      } else {
        setNegotiationMessage("Intent registered! You'll be notified when negotiation begins.");
      }
    } catch {
      // Match trigger failed, but intent was created successfully
      setNegotiationMessage("Intent registered! Matching will happen shortly.");
    }
  } catch (err) {
    setNegotiationState("error");
    setNegotiationMessage("Something went wrong. Please try again.");
    console.warn("Failed to create intent:", err);
  }
}}
```

Show the negotiation state below the button:
```tsx
{negotiationState === "loading" && (
  <div className="text-center text-sm text-slate-400 mt-3">Setting up your agent...</div>
)}
{negotiationState === "success" && (
  <div className="text-center text-sm text-emerald-400 mt-3">{negotiationMessage}</div>
)}
{negotiationState === "error" && (
  <div className="text-center text-sm text-red-400 mt-3">{negotiationMessage}</div>
)}
```

### Flags
- Flag: Read buyer-landing.tsx FULLY. It's a 500-line component. Understand the state.
- Flag: `user` prop is `{ email, name, avatarUrl } | null`. When null, redirect to auth.
- Flag: `selectedAgent` is the currently selected buyer agent preset ID (string).
- Flag: The listing prop has id, publicId, category, tags, targetPrice — use these for the intent.
- Flag: Do NOT add a negotiation chat UI. Just the "start" action + status message for now.
- Flag: Disable the button while loading. Show loading state.
- Flag: The `triggerMatch` call is best-effort. If it fails, the intent still exists.

### Definition of Done
- [ ] negotiation-api.ts created
- [ ] "Start Negotiation" button has onClick handler
- [ ] Unauthenticated users → redirect to /claim
- [ ] Authenticated users → create intent → try match → show status
- [ ] Loading/success/error states shown
- [ ] Button disabled during loading
- [ ] No crashes on API failure

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
