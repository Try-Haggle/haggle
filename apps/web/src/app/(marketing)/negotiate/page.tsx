"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function makeDevToken(sub: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256" })).replace(/=/g, "");
  const payload = btoa(JSON.stringify({ sub })).replace(/=/g, "");
  return `${header}.${payload}.`;
}

const BUYER_ID = "33333333-3333-3333-3333-333333333333";
const SELLER_ID = "22222222-2222-2222-2222-222222222222";
const LISTING_ID = "11111111-1111-1111-1111-111111111111";
const BUYER_TOKEN = makeDevToken(BUYER_ID);
const SELLER_TOKEN = makeDevToken(SELLER_ID);

// MasterStrategy — engine-session/strategy/types.ts
function buildStrategy(role: "BUYER" | "SELLER", form: StrategyForm) {
  const isBuyer = role === "BUYER";
  return {
    id: `strat-${role.toLowerCase()}`,
    user_id: isBuyer ? BUYER_ID : SELLER_ID,
    weights: { w_p: form.w_p, w_t: form.w_t, w_r: form.w_r, w_s: form.w_s },
    p_target: isBuyer ? form.buyer_target : form.seller_target,
    p_limit: isBuyer ? form.buyer_limit : form.seller_limit,
    alpha: form.alpha,
    beta: form.beta,
    t_deadline: 3600_000,
    v_t_floor: 0.1,
    n_threshold: 3,
    v_s_base: 0.5,
    w_rep: 0.5,
    w_info: 0.5,
    u_threshold: form.u_threshold,
    u_aspiration: form.u_aspiration,
    persona: "balanced",
    created_at: Date.now(),
    expires_at: Date.now() + 3600_000,
  };
}

interface StrategyForm {
  buyer_target: number;
  buyer_limit: number;
  seller_target: number;
  seller_limit: number;
  w_p: number;
  w_t: number;
  w_r: number;
  w_s: number;
  alpha: number;
  beta: number;
  u_threshold: number;
  u_aspiration: number;
}

const DEFAULT_STRATEGY: StrategyForm = {
  // Narrow ZOPA: buyer up to 10000, seller down to 9000 → overlap only 9000-10000
  buyer_target: 7000,   // buyer's dream price
  buyer_limit: 10000,   // buyer's walk-away
  seller_target: 12000, // seller's dream price
  seller_limit: 9000,   // seller's walk-away
  w_p: 0.6,
  w_t: 0.2,
  w_r: 0.1,
  w_s: 0.1,
  alpha: 0.4,           // slower concession → more rounds
  beta: 1.2,
  u_threshold: 0.7,     // higher bar → won't accept first decent offer
  u_aspiration: 0.9,
};

interface Utility {
  u_total: number;
  v_p: number;
  v_t: number;
  v_r: number;
  v_s: number;
}

interface SessionView {
  id: string;
  status: string;
  current_round: number;
  last_offer_price_minor: string | null;
  last_utility: Utility | null;
  role: string;
  version: number;
}

interface RoundView {
  id: string;
  round_no: number;
  sender_role: string;
  message_type: string;
  price_minor: string;
  counter_price_minor: string | null;
  utility: Utility | null;
  decision: string | null;
}

interface OfferResponse {
  idempotent: boolean;
  round_id: string;
  round_no: number;
  decision: string;
  outgoing_price: number;
  utility: Utility;
  session_status: string;
  escalation?: { type: string; context: unknown };
}

interface SideState {
  sessionId: string | null;
  session: SessionView | null;
  rounds: RoundView[];
}

interface TimelineEntry {
  ts: number;
  from: "BUYER" | "SELLER";
  to: "BUYER" | "SELLER";
  price: number;
  decision: string;
  utility: Utility;
  counterPrice: number | null;
  sessionStatus: string;
}

export default function NegotiatePage() {
  const [strategy, setStrategy] = useState<StrategyForm>(DEFAULT_STRATEGY);
  const [buyer, setBuyer] = useState<SideState>({ sessionId: null, session: null, rounds: [] });
  const [seller, setSeller] = useState<SideState>({ sessionId: null, session: null, rounds: [] });
  const [buyerOffer, setBuyerOffer] = useState("8000");
  const [sellerOffer, setSellerOffer] = useState("10000");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function appendLog(line: string) {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev].slice(0, 60));
  }

  async function api(token: string, path: string, init?: RequestInit) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }
    return data as Record<string, unknown>;
  }

  async function createBothSessions() {
    setBusy(true);
    setTimeline([]);
    try {
      const bData = await api(BUYER_TOKEN, "/negotiations/sessions", {
        method: "POST",
        body: JSON.stringify({
          listing_id: LISTING_ID,
          strategy_id: "buyer-strategy",
          role: "BUYER",
          buyer_id: BUYER_ID,
          seller_id: SELLER_ID,
          counterparty_id: SELLER_ID,
          strategy_snapshot: buildStrategy("BUYER", strategy),
        }),
      });
      const bSession = bData.session as SessionView;
      setBuyer({ sessionId: bSession.id, session: bSession, rounds: [] });
      appendLog(`✓ BUYER session ${bSession.id.slice(0, 8)}…`);

      const sData = await api(SELLER_TOKEN, "/negotiations/sessions", {
        method: "POST",
        body: JSON.stringify({
          listing_id: LISTING_ID,
          strategy_id: "seller-strategy",
          role: "SELLER",
          buyer_id: BUYER_ID,
          seller_id: SELLER_ID,
          counterparty_id: BUYER_ID,
          strategy_snapshot: buildStrategy("SELLER", strategy),
        }),
      });
      const sSession = sData.session as SessionView;
      setSeller({ sessionId: sSession.id, session: sSession, rounds: [] });
      appendLog(`✓ SELLER session ${sSession.id.slice(0, 8)}…`);
    } catch (e) {
      appendLog(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSide(side: "BUYER" | "SELLER", sessionId: string) {
    const token = side === "BUYER" ? BUYER_TOKEN : SELLER_TOKEN;
    const data = await api(token, `/negotiations/sessions/${sessionId}`);
    const updater = side === "BUYER" ? setBuyer : setSeller;
    updater({
      sessionId,
      session: data.session as SessionView,
      rounds: (data.rounds as RoundView[]) ?? [],
    });
  }

  async function submitOffer(from: "BUYER" | "SELLER") {
    // From X submits → counterparty's session evaluates (counterparty engine processes incoming offer from X)
    const to: "BUYER" | "SELLER" = from === "BUYER" ? "SELLER" : "BUYER";
    const targetState = to === "BUYER" ? buyer : seller;
    const targetToken = to === "BUYER" ? BUYER_TOKEN : SELLER_TOKEN;
    const price = Number(from === "BUYER" ? buyerOffer : sellerOffer);
    if (!targetState.sessionId) {
      appendLog(`✗ ${to} session not created yet`);
      return;
    }
    setBusy(true);
    try {
      const resp = (await api(targetToken, `/negotiations/sessions/${targetState.sessionId}/offers`, {
        method: "POST",
        body: JSON.stringify({
          price_minor: price,
          sender_role: from,
          idempotency_key: crypto.randomUUID(),
          round_data: {
            r_score: 0.7,
            i_completeness: 0.8,
            t_elapsed: 60,
            n_success: 5,
            n_dispute_losses: 0,
          },
        }),
      })) as unknown as OfferResponse;

      setTimeline((prev) => [
        ...prev,
        {
          ts: Date.now(),
          from,
          to,
          price,
          decision: resp.decision,
          utility: resp.utility,
          counterPrice: resp.outgoing_price,
          sessionStatus: resp.session_status,
        },
      ]);
      appendLog(
        `${from}→${to} ${price} | ${resp.decision} | counter=${resp.outgoing_price} | U=${resp.utility.u_total.toFixed(3)} | ${resp.session_status}`,
      );

      await refreshSide(to, targetState.sessionId);
    } catch (e) {
      appendLog(`✗ ${from}→${to} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function autoNegotiate() {
    if (!buyer.sessionId || !seller.sessionId) {
      appendLog("✗ create sessions first");
      return;
    }
    setBusy(true);
    try {
      // Buyer opens with their initial target.
      let nextFrom: "BUYER" | "SELLER" = "BUYER";
      let nextPrice = strategy.buyer_target;
      const maxRounds = 12;

      for (let i = 0; i < maxRounds; i++) {
        const to: "BUYER" | "SELLER" = nextFrom === "BUYER" ? "SELLER" : "BUYER";
        const targetState = to === "BUYER" ? buyer : seller;
        const targetToken = to === "BUYER" ? BUYER_TOKEN : SELLER_TOKEN;
        if (!targetState.sessionId) break;

        const resp = (await api(targetToken, `/negotiations/sessions/${targetState.sessionId}/offers`, {
          method: "POST",
          body: JSON.stringify({
            price_minor: Math.round(nextPrice),
            sender_role: nextFrom,
            idempotency_key: crypto.randomUUID(),
            round_data: { r_score: 0.7, i_completeness: 0.8, t_elapsed: 60 + i * 30, n_success: 5, n_dispute_losses: 0 },
          }),
        })) as unknown as OfferResponse;

        const priceUsed = nextPrice;
        setTimeline((prev) => [...prev, {
          ts: Date.now(), from: nextFrom, to, price: Math.round(priceUsed),
          decision: resp.decision, utility: resp.utility,
          counterPrice: resp.outgoing_price, sessionStatus: resp.session_status,
        }]);
        appendLog(
          `auto[${i + 1}] ${nextFrom}→${to} ${Math.round(priceUsed)} | ${resp.decision} counter=${resp.outgoing_price} U=${resp.utility.u_total.toFixed(3)} ${resp.session_status}`,
        );

        await refreshSide(to, targetState.sessionId);

        if (resp.decision === "ACCEPT" || resp.session_status === "ACCEPTED") {
          appendLog(`✓ DEAL @ ${Math.round(priceUsed)}`);
          break;
        }
        if (resp.decision === "REJECT" || resp.session_status === "REJECTED" || resp.session_status === "EXPIRED") {
          appendLog(`✗ ended: ${resp.decision} / ${resp.session_status}`);
          break;
        }

        // counter offer becomes the next incoming price; flip sides
        nextFrom = to;
        nextPrice = resp.outgoing_price;
        // small delay so UI can render
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {
      appendLog(`✗ auto: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function simulateInMemory() {
    setBusy(true);
    setTimeline([]);
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/negotiations/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_strategy: buildStrategy("BUYER", strategy),
          seller_strategy: buildStrategy("SELLER", strategy),
          initial_offer: { from: "BUYER", price_minor: Math.round(strategy.buyer_target) },
          max_rounds: 20,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        appendLog(`✗ simulate ${res.status} ${JSON.stringify(data)}`);
        return;
      }
      const transcript = (data.transcript ?? []) as Array<{
        step: number;
        from: "BUYER" | "SELLER";
        to: "BUYER" | "SELLER";
        price: number;
        decision: string;
        counter_price: number | null;
        utility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
        session_status: string;
      }>;
      setTimeline(
        transcript.map((t) => ({
          ts: Date.now() + t.step,
          from: t.from,
          to: t.to,
          price: t.price,
          decision: t.decision,
          utility: t.utility,
          counterPrice: t.counter_price,
          sessionStatus: t.session_status,
        })),
      );
      const elapsed = (performance.now() - t0).toFixed(1);
      appendLog(
        `⚡ simulate ${transcript.length} rounds in ${elapsed}ms (server ${data.duration_ms}ms) → ${data.terminal_reason} @ ${data.final_price}`,
      );
    } catch (e) {
      appendLog(`✗ simulate ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function actSide(side: "BUYER" | "SELLER", action: "accept" | "reject") {
    const state = side === "BUYER" ? buyer : seller;
    const token = side === "BUYER" ? BUYER_TOKEN : SELLER_TOKEN;
    if (!state.sessionId) return;
    setBusy(true);
    try {
      await api(token, `/negotiations/sessions/${state.sessionId}/${action}`, { method: "PATCH" });
      appendLog(`${side} ${action}ed`);
      await refreshSide(side, state.sessionId);
    } catch (e) {
      appendLog(`✗ ${side} ${action}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
        Haggle Engine Playground
      </h1>
      <p style={{ color: "#555", marginBottom: 16, fontSize: 14 }}>
        Real engine: <code>computeUtility</code> + <code>makeDecision</code> + <code>computeCounterOffer</code>.
        Each side has its own session; an offer from X is evaluated by Y&apos;s engine.
      </p>

      <StrategyEditor strategy={strategy} setStrategy={setStrategy} disabled={busy || !!buyer.session} />

      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <button onClick={createBothSessions} disabled={busy} style={primaryBtn}>
          {buyer.session ? "↻ Recreate Sessions" : "1. Create BUYER + SELLER Sessions"}
        </button>
        <button onClick={autoNegotiate} disabled={busy || !buyer.sessionId} style={{ ...primaryBtn, background: "#06f" }}>
          ▶ Auto-negotiate (ping-pong)
        </button>
        <button onClick={simulateInMemory} disabled={busy} style={{ ...primaryBtn, background: "#a0f" }}>
          ⚡ Simulate (in-memory, instant)
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <SidePanel
          title="🛒 BUYER engine"
          color="#0a7"
          state={buyer}
          offerValue={buyerOffer}
          onOfferChange={setBuyerOffer}
          onOffer={() => submitOffer("BUYER")}
          onAccept={() => actSide("BUYER", "accept")}
          onReject={() => actSide("BUYER", "reject")}
          busy={busy}
          target={strategy.buyer_target}
          limit={strategy.buyer_limit}
        />
        <SidePanel
          title="🏪 SELLER engine"
          color="#c63"
          state={seller}
          offerValue={sellerOffer}
          onOfferChange={setSellerOffer}
          onOffer={() => submitOffer("SELLER")}
          onAccept={() => actSide("SELLER", "accept")}
          onReject={() => actSide("SELLER", "reject")}
          busy={busy}
          target={strategy.seller_target}
          limit={strategy.seller_limit}
        />
      </div>

      <Timeline entries={timeline} />

      <section style={cardStyle}>
        <h2 style={h2Style}>📋 Activity Log</h2>
        <div style={{ fontFamily: "monospace", fontSize: 12, maxHeight: 200, overflow: "auto" }}>
          {log.length === 0 && <em style={{ color: "#999" }}>no activity</em>}
          {log.map((line, i) => (
            <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #f0f0f0" }}>{line}</div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StrategyEditor({
  strategy, setStrategy, disabled,
}: { strategy: StrategyForm; setStrategy: (s: StrategyForm) => void; disabled: boolean }) {
  function update<K extends keyof StrategyForm>(k: K, v: number) {
    setStrategy({ ...strategy, [k]: v });
  }
  return (
    <section style={{ ...cardStyle, marginBottom: 16 }}>
      <h2 style={h2Style}>⚙️ Strategy (MasterStrategy → reconstructStrategy)</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, fontSize: 12 }}>
        <NumField label="Buyer target" value={strategy.buyer_target} onChange={(v) => update("buyer_target", v)} disabled={disabled} />
        <NumField label="Buyer limit" value={strategy.buyer_limit} onChange={(v) => update("buyer_limit", v)} disabled={disabled} />
        <NumField label="Seller target" value={strategy.seller_target} onChange={(v) => update("seller_target", v)} disabled={disabled} />
        <NumField label="Seller limit" value={strategy.seller_limit} onChange={(v) => update("seller_limit", v)} disabled={disabled} />
        <NumField label="w_p (price)" value={strategy.w_p} step={0.05} onChange={(v) => update("w_p", v)} disabled={disabled} />
        <NumField label="w_t (time)" value={strategy.w_t} step={0.05} onChange={(v) => update("w_t", v)} disabled={disabled} />
        <NumField label="w_r (rep)" value={strategy.w_r} step={0.05} onChange={(v) => update("w_r", v)} disabled={disabled} />
        <NumField label="w_s (social)" value={strategy.w_s} step={0.05} onChange={(v) => update("w_s", v)} disabled={disabled} />
        <NumField label="alpha (concession)" value={strategy.alpha} step={0.05} onChange={(v) => update("alpha", v)} disabled={disabled} />
        <NumField label="beta (Faratin)" value={strategy.beta} step={0.1} onChange={(v) => update("beta", v)} disabled={disabled} />
        <NumField label="u_threshold" value={strategy.u_threshold} step={0.05} onChange={(v) => update("u_threshold", v)} disabled={disabled} />
        <NumField label="u_aspiration" value={strategy.u_aspiration} step={0.05} onChange={(v) => update("u_aspiration", v)} disabled={disabled} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#888" }}>
        Σw = {(strategy.w_p + strategy.w_t + strategy.w_r + strategy.w_s).toFixed(2)} (must be ≈ 1.0).
        Locked after session creation — use Recreate to change.
      </div>
    </section>
  );
}

function NumField({
  label, value, onChange, disabled, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; disabled: boolean; step?: number }) {
  return (
    <label>
      <div style={{ color: "#666", marginBottom: 2 }}>{label}</div>
      <input
        type="number"
        value={value}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, width: "100%" }}
      />
    </label>
  );
}

function SidePanel(props: {
  title: string;
  color: string;
  state: SideState;
  offerValue: string;
  onOfferChange: (v: string) => void;
  onOffer: () => void;
  onAccept: () => void;
  onReject: () => void;
  busy: boolean;
  target: number;
  limit: number;
}) {
  const { title, color, state, offerValue, onOfferChange, onOffer, onAccept, onReject, busy, target, limit } = props;
  const u = state.session?.last_utility;
  return (
    <section style={{ ...cardStyle, borderTop: `4px solid ${color}` }}>
      <h2 style={{ ...h2Style, color }}>{title}</h2>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
        target={target} · limit={limit}
      </div>
      {state.session ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.6 }}>
            <div><b>Status:</b> <span style={statusBadge(state.session.status)}>{state.session.status}</span></div>
            <div><b>Round:</b> {state.session.current_round} · <b>v:</b> {state.session.version}</div>
            <div><b>Last offer:</b> {state.session.last_offer_price_minor ?? "—"}</div>
          </div>

          {u && (
            <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 4, fontSize: 11, marginBottom: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Last utility breakdown</div>
              <div>U_total = <b>{u.u_total.toFixed(4)}</b></div>
              <div>V_p={u.v_p.toFixed(3)} · V_t={u.v_t.toFixed(3)} · V_r={u.v_r.toFixed(3)} · V_s={u.v_s.toFixed(3)}</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              value={offerValue}
              onChange={(e) => onOfferChange(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="price"
            />
            <button onClick={onOffer} disabled={busy} style={{ ...btnStyle, background: color }}>
              Send offer
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onAccept} disabled={busy} style={{ ...smallBtn, background: "#0a7" }}>Accept</button>
            <button onClick={onReject} disabled={busy} style={{ ...smallBtn, background: "#c33" }}>Reject</button>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>Round history</div>
            <div style={{ maxHeight: 140, overflow: "auto", fontSize: 11, fontFamily: "monospace" }}>
              {state.rounds.length === 0 && <em style={{ color: "#999" }}>—</em>}
              {state.rounds.map((r) => (
                <div key={r.id} style={{ padding: "2px 0", borderBottom: "1px solid #f0f0f0" }}>
                  #{r.round_no} {r.sender_role} {r.message_type} {r.price_minor}
                  {r.counter_price_minor ? ` ↩ ${r.counter_price_minor}` : ""}
                  {r.decision ? ` [${r.decision}]` : ""}
                  {r.utility ? ` U=${r.utility.u_total.toFixed(2)}` : ""}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <em style={{ color: "#999" }}>no session</em>
      )}
    </section>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <section style={{ ...cardStyle, marginBottom: 16 }}>
      <h2 style={h2Style}>💬 Negotiation Timeline ({entries.length})</h2>
      {entries.length === 0 && <em style={{ color: "#999", fontSize: 12 }}>no offers yet</em>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e, i) => {
          const isBuyerFrom = e.from === "BUYER";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: isBuyerFrom ? "flex-start" : "flex-end",
              }}
            >
              <div
                style={{
                  background: isBuyerFrom ? "#e6f7f0" : "#fff0e6",
                  border: `1px solid ${isBuyerFrom ? "#0a7" : "#c63"}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  maxWidth: "75%",
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                  {e.from} → {e.to} · ${e.price.toLocaleString()}
                </div>
                <div style={{ color: "#444" }}>
                  Engine decision: <b style={decisionStyle(e.decision)}>{e.decision}</b>
                  {e.counterPrice && e.counterPrice !== e.price ? ` · counter $${e.counterPrice.toLocaleString()}` : ""}
                </div>
                <div style={{ color: "#666", fontSize: 11 }}>
                  U_total={e.utility.u_total.toFixed(3)} · V_p={e.utility.v_p.toFixed(2)} · V_t={e.utility.v_t.toFixed(2)} · V_r={e.utility.v_r.toFixed(2)} · V_s={e.utility.v_s.toFixed(2)}
                </div>
                <div style={{ color: "#888", fontSize: 10 }}>
                  status: {e.sessionStatus} · {new Date(e.ts).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function statusBadge(status: string): React.CSSProperties {
  const map: Record<string, string> = {
    ACTIVE: "#06f",
    CREATED: "#888",
    NEAR_DEAL: "#f80",
    ACCEPTED: "#0a7",
    REJECTED: "#c33",
    EXPIRED: "#666",
    SUPERSEDED: "#888",
  };
  return {
    background: map[status] ?? "#888",
    color: "white",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
  };
}

function decisionStyle(decision: string): React.CSSProperties {
  const map: Record<string, string> = {
    ACCEPT: "#0a7",
    COUNTER: "#06f",
    REJECT: "#c33",
    NEAR_DEAL: "#f80",
    ESCALATE: "#a0a",
  };
  return { color: map[decision] ?? "#111" };
}

const pageStyle: React.CSSProperties = {
  maxWidth: 1080,
  margin: "2rem auto",
  padding: "1rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd",
  padding: 16,
  borderRadius: 8,
  color: "#111",
  marginBottom: 0,
};

const h2Style: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 15,
  marginBottom: 10,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#fff",
  color: "#111",
  fontSize: 13,
};

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#06f",
  color: "white",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const smallBtn: React.CSSProperties = { ...btnStyle, padding: "4px 10px", fontSize: 12 };
const primaryBtn: React.CSSProperties = { ...btnStyle, padding: "10px 18px", fontSize: 14, background: "#111" };
