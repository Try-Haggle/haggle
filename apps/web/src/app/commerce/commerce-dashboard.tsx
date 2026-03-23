"use client";

import { useState, useCallback, useEffect } from "react";
import s from "./commerce.module.css";
import {
  createInitialState,
  buyerApprove,
  sellerApprove,
  processPayment,
  submitShippingInfo,
  advanceShipment,
  triggerDeliveryException,
  fileDispute,
  startAiReview,
  resolveDispute,
  updateNegotiation,
  formatCurrency,
  getPhaseLabel,
  getPhaseIndex,
  DISPUTE_REASON_OPTIONS,
  type CommerceState,
  type ShipmentInfo,
  type OrderPhase,
  type DisputeReasonCode,
  type NegotiationResult,
} from "./commerce-engine";

// ─── Phase Stepper ───────────────────────────────────────────

const PHASES: { key: OrderPhase; label: string; num: number }[] = [
  { key: "APPROVAL", label: "승인", num: 1 },
  { key: "PAYMENT", label: "결제", num: 2 },
  { key: "FULFILLMENT", label: "이행", num: 3 },
  { key: "DELIVERY", label: "배송", num: 4 },
  { key: "COMPLETED", label: "완료", num: 5 },
];

function Stepper({ state }: { state: CommerceState }) {
  const current = getPhaseIndex(state.phase);
  const isDispute = state.phase === "IN_DISPUTE" || state.phase === "REFUNDED";

  return (
    <div className={s.stepper}>
      {PHASES.map((p, i) => {
        let cls = s.step;
        if (isDispute && p.key === "COMPLETED") cls += ` ${s.stepDispute}`;
        else if (i === current) cls += ` ${s.stepActive}`;
        else if (i < current) cls += ` ${s.stepDone}`;

        return (
          <div key={p.key} className={cls}>
            <div className={s.stepDot}>
              {i < current ? "✓" : isDispute && p.key === "COMPLETED" ? "!" : p.num}
            </div>
            {isDispute && p.key === "COMPLETED"
              ? state.phase === "REFUNDED" ? "환불됨" : "분쟁"
              : p.label}
          </div>
        );
      })}
    </div>
  );
}

// ─── Deal Summary Card (editable in APPROVAL phase) ─────────

function DealSummary({
  state,
  onUpdate,
}: {
  state: CommerceState;
  onUpdate: (patch: Partial<NegotiationResult>) => void;
}) {
  const n = state.negotiation;
  const editable = state.phase === "APPROVAL";
  const savings = n.original_price > 0
    ? Math.round(((n.original_price - n.agreed_price) / n.original_price) * 100)
    : 0;
  const fee = Math.round(n.agreed_price * 0.015);

  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>
        📋 거래 요약
        {editable && <span className={s.editHint}>수정 가능</span>}
      </h3>
      <div className={s.dealGrid}>
        <div className={`${s.dealItem} ${s.dealItemWide}`}>
          <span className={s.dealLabel}>상품</span>
          {editable ? (
            <input
              className={s.dealInput}
              value={n.listing_title}
              onChange={(e) => onUpdate({ listing_title: e.target.value })}
            />
          ) : (
            <span className={s.dealValue}>{n.listing_title}</span>
          )}
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>카테고리</span>
          {editable ? (
            <input
              className={s.dealInput}
              value={n.listing_category}
              onChange={(e) => onUpdate({ listing_category: e.target.value })}
            />
          ) : (
            <span className={s.dealValue}>{n.listing_category}</span>
          )}
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>협상 라운드</span>
          {editable ? (
            <input
              className={s.dealInput}
              type="number"
              min={1}
              value={n.rounds_taken}
              onChange={(e) => onUpdate({ rounds_taken: Number(e.target.value) || 1 })}
            />
          ) : (
            <span className={s.dealValue}>{n.rounds_taken}라운드</span>
          )}
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>원가 ($)</span>
          {editable ? (
            <div className={s.dealInputWrap}>
              <span className={s.dealInputPrefix}>$</span>
              <input
                className={s.dealInput}
                type="number"
                min={0}
                step={0.01}
                value={(n.original_price / 100).toFixed(2)}
                onChange={(e) => onUpdate({ original_price: Math.round((Number(e.target.value) || 0) * 100) })}
              />
            </div>
          ) : (
            <span className={s.dealValue}>{formatCurrency(n.original_price)}</span>
          )}
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>합의 가격 ($)</span>
          {editable ? (
            <div className={s.dealInputWrap}>
              <span className={s.dealInputPrefix}>$</span>
              <input
                className={`${s.dealInput} ${s.dealInputPrice}`}
                type="number"
                min={0}
                step={0.01}
                value={(n.agreed_price / 100).toFixed(2)}
                onChange={(e) => onUpdate({ agreed_price: Math.round((Number(e.target.value) || 0) * 100) })}
              />
            </div>
          ) : (
            <span className={s.dealPrice}>{formatCurrency(n.agreed_price)}</span>
          )}
          <span className={s.dealSavings}>
            {savings > 0 ? `${savings}% 절약` : ""}
            {n.original_price > 0 && ` (원가 ${formatCurrency(n.original_price)})`}
          </span>
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>플랫폼 수수료 (합의가격 × 1.5%)</span>
          <span className={s.dealValue}>{formatCurrency(fee)}</span>
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>판매자</span>
          {editable ? (
            <input
              className={s.dealInput}
              value={n.seller_name}
              onChange={(e) => onUpdate({ seller_name: e.target.value })}
            />
          ) : (
            <span className={s.dealValue}>{n.seller_name}</span>
          )}
        </div>

        <div className={s.dealItem}>
          <span className={s.dealLabel}>구매자</span>
          {editable ? (
            <input
              className={s.dealInput}
              value={n.buyer_name}
              onChange={(e) => onUpdate({ buyer_name: e.target.value })}
            />
          ) : (
            <span className={s.dealValue}>{n.buyer_name}</span>
          )}
        </div>

        {editable && (
          <div className={s.dealItem}>
            <span className={s.dealLabel}>판매자 승인 방식</span>
            <select
              className={s.dealInput}
              value={n.seller_approval_mode}
              onChange={(e) => onUpdate({ seller_approval_mode: e.target.value as NegotiationResult["seller_approval_mode"] })}
            >
              <option value="AUTO_WITHIN_POLICY">자동 승인</option>
              <option value="MANUAL_CONFIRMATION">수동 확인</option>
            </select>
          </div>
        )}
      </div>

      {editable && n.agreed_price > 0 && (
        <div className={s.dealBreakdown}>
          <span>구매자 지불: <strong>{formatCurrency(n.agreed_price)}</strong></span>
          <span>→ 에스크로: <strong>{formatCurrency(n.agreed_price - fee)}</strong></span>
          <span>→ 수수료: <strong>{formatCurrency(fee)}</strong></span>
        </div>
      )}
    </div>
  );
}

// ─── Wallets Card ────────────────────────────────────────────

function Wallets({ state }: { state: CommerceState }) {
  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>💳 지갑</h3>
      {state.escrow_held > 0 && (
        <div className={s.escrowBar}>
          <span className={s.escrowLabel}>에스크로</span>
          <span className={s.escrowAmount}>{formatCurrency(state.escrow_held)}</span>
        </div>
      )}
      <div className={s.walletGrid}>
        <div className={`${s.wallet} ${s.walletBuyer}`}>
          <div className={s.walletLabel}>구매자</div>
          <div className={s.walletBalance}>{formatCurrency(state.buyer_wallet.balance)}</div>
          <div className={s.walletAddr}>{state.buyer_wallet.address}</div>
        </div>
        <div className={`${s.wallet} ${s.walletSeller}`}>
          <div className={s.walletLabel}>판매자</div>
          <div className={s.walletBalance}>{formatCurrency(state.seller_wallet.balance)}</div>
          <div className={s.walletAddr}>{state.seller_wallet.address}</div>
        </div>
        <div className={`${s.wallet} ${s.walletPlatform}`}>
          <div className={s.walletLabel}>플랫폼 수수료</div>
          <div className={s.walletBalance}>{formatCurrency(state.platform_wallet.balance)}</div>
          <div className={s.walletAddr}>{state.platform_wallet.address}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Trust Scores Card ───────────────────────────────────────

function TrustScores({ state }: { state: CommerceState }) {
  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>🛡️ 신뢰 점수</h3>
      <div className={s.trustGrid}>
        <div className={s.trustItem}>
          <div className={s.trustLabel}>구매자 신뢰도</div>
          <div className={s.trustScore}>{(state.trust_scores.buyer_reliability * 100).toFixed(0)}%</div>
          <div className={s.trustBar}>
            <div className={s.trustFill} style={{ width: `${state.trust_scores.buyer_reliability * 100}%` }} />
          </div>
        </div>
        <div className={s.trustItem}>
          <div className={s.trustLabel}>판매자 신뢰도</div>
          <div className={s.trustScore}>{(state.trust_scores.seller_reliability * 100).toFixed(0)}%</div>
          <div className={s.trustBar}>
            <div className={s.trustFill} style={{ width: `${state.trust_scores.seller_reliability * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline Card ───────────────────────────────────────────

function Timeline({ state }: { state: CommerceState }) {
  const events = [...state.timeline].reverse();
  const actorClass: Record<string, string> = {
    buyer: s.actorBuyer,
    seller: s.actorSeller,
    system: s.actorSystem,
    ai: s.actorAi,
  };

  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>📜 타임라인</h3>
      <div className={s.timeline}>
        {events.map((evt) => (
          <div key={evt.id} className={s.timelineItem}>
            <div className={s.timelineIcon}>
              <div className={s.timelineDot}>{evt.icon}</div>
              <div className={s.timelineLine} />
            </div>
            <div className={s.timelineContent}>
              <p className={s.timelineTitle}>
                {evt.title}
                <span className={`${s.timelineActor} ${actorClass[evt.actor] ?? ""}`}>
                  {{ buyer: "구매자", seller: "판매자", system: "시스템", ai: "AI" }[evt.actor]}
                </span>
              </p>
              <p className={s.timelineDetail}>{evt.detail}</p>
              <p className={s.timelineTime}>
                {new Date(evt.timestamp).toLocaleTimeString("ko-KR")}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Action Panel ────────────────────────────────────────────

function ActionPanel({
  state,
  onAction,
}: {
  state: CommerceState;
  onAction: (action: string, payload?: unknown) => void;
}) {
  const [carrier, setCarrier] = useState("FedEx");
  const [trackingNum, setTrackingNum] = useState("FDX-A1B2C3D4");
  const [disputeReason, setDisputeReason] = useState<DisputeReasonCode>("ITEM_NOT_AS_DESCRIBED");
  const [disputeDesc, setDisputeDesc] = useState("");
  const [disputeEvidence, setDisputeEvidence] = useState("");

  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>
        🎮 액션
        <span className={`${s.badge} ${
          state.phase === "IN_DISPUTE" || state.phase === "REFUNDED" ? s.badgeDispute :
          state.phase === "COMPLETED" ? s.badgeCompleted :
          state.phase === "PAYMENT" ? s.badgePayment :
          state.phase === "FULFILLMENT" ? s.badgeFulfillment :
          state.phase === "DELIVERY" ? s.badgeDelivery :
          s.badgeApproval
        }`}>
          {getPhaseLabel(state.phase)}
        </span>
      </h3>

      <div className={s.actions}>
        {/* ── Approval Phase ── */}
        {state.approval_state === "MUTUALLY_ACCEPTABLE" && (
          <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => onAction("buyer_approve")}>
            ✅ 구매자: 거래 승인
          </button>
        )}

        {state.approval_state === "AWAITING_SELLER_APPROVAL" && (
          <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => onAction("seller_approve")}>
            ✅ 판매자: 거래 승인
          </button>
        )}

        {/* ── Payment Phase ── */}
        {state.phase === "PAYMENT" && state.payment_status !== "SETTLED" && (
          <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => onAction("process_payment")}>
            💰 결제 진행 (x402 모의)
          </button>
        )}

        {/* ── Fulfillment Phase — Shipping Form ── */}
        {state.phase === "FULFILLMENT" && state.shipment_status === "LABEL_PENDING" && (
          <>
            <div className={s.formGrid}>
              <div className={s.formGroup}>
                <label className={s.formLabel}>운송사</label>
                <select className={s.formSelect} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                  <option value="FedEx">FedEx</option>
                  <option value="UPS">UPS</option>
                  <option value="USPS">USPS</option>
                  <option value="DHL">DHL</option>
                </select>
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>운송장 번호</label>
                <input className={s.formInput} value={trackingNum} onChange={(e) => setTrackingNum(e.target.value)} />
              </div>
            </div>
            <button
              className={`${s.btn} ${s.btnSecondary}`}
              onClick={() => onAction("submit_shipping", {
                carrier,
                tracking_number: trackingNum,
                tracking_url: `https://track.${carrier.toLowerCase()}.com/${trackingNum}`,
                eta: new Date(Date.now() + 5 * 86400_000).toISOString(),
              } satisfies ShipmentInfo)}
            >
              📦 판매자: 배송 정보 입력
            </button>
          </>
        )}

        {/* ── Delivery Phase — Advance Shipment ── */}
        {state.shipment && ["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(state.shipment_status) && (
          <>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => onAction("advance_shipment")}>
              🚚 배송 진행 →{" "}
              {state.shipment_status === "LABEL_CREATED" ? "배송 중" :
               state.shipment_status === "IN_TRANSIT" ? "배달 출발" :
               "배달 완료"}
            </button>
            <button className={`${s.btn} ${s.btnDanger}`} onClick={() => onAction("delivery_exception")}>
              ⚠️ 배송 예외 시뮬레이션
            </button>
          </>
        )}

        {/* ── File Dispute ── */}
        {state.dispute_status === "NONE" && state.payment_status === "SETTLED" && state.phase !== "COMPLETED" && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid rgba(40,29,18,0.1)", margin: "4px 0" }} />
            <div className={s.formGrid}>
              <div className={s.formGroup}>
                <label className={s.formLabel}>사유</label>
                <select className={s.formSelect} value={disputeReason} onChange={(e) => setDisputeReason(e.target.value as DisputeReasonCode)}>
                  {DISPUTE_REASON_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>설명</label>
                <input
                  className={s.formInput}
                  placeholder="간단한 설명..."
                  value={disputeDesc}
                  onChange={(e) => setDisputeDesc(e.target.value)}
                />
              </div>
              <div className={`${s.formGroup} full`}>
                <label className={s.formLabel}>증거</label>
                <textarea
                  className={s.formTextarea}
                  placeholder="문제를 상세히 기술해 주세요..."
                  value={disputeEvidence}
                  onChange={(e) => setDisputeEvidence(e.target.value)}
                />
              </div>
            </div>
            <button
              className={`${s.btn} ${s.btnDanger}`}
              disabled={!disputeDesc}
              onClick={() => onAction("file_dispute", {
                reason_code: disputeReason,
                description: disputeDesc || "Dispute filed by buyer",
                evidence_text: disputeEvidence || "No additional evidence",
              })}
            >
              ⚖️ 구매자: 분쟁 신청
            </button>
          </>
        )}

        {/* ── Dispute AI Review ── */}
        {state.dispute_status === "OPEN" && (
          <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => onAction("start_ai_review")}>
            🤖 AI 분쟁 심사 시작
          </button>
        )}

        {state.dispute_status === "UNDER_REVIEW" && (
          <>
            <p style={{ fontSize: "0.85rem", color: "#54473a", margin: "0 0 6px" }}>
              AI가 심사 중입니다... 모의 결과를 선택하세요:
            </p>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => onAction("resolve_dispute", "buyer_favor")}>
              🏆 판결: 구매자 승소 (전액 환불)
            </button>
            <button className={`${s.btn} ${s.btnOutline}`} onClick={() => onAction("resolve_dispute", "partial_refund")}>
              ⚖️ 판결: 부분 환불 (50%)
            </button>
            <button className={`${s.btn} ${s.btnSecondary}`} onClick={() => onAction("resolve_dispute", "seller_favor")}>
              🛡️ 판결: 판매자 승소 (환불 없음)
            </button>
          </>
        )}

        {/* ── Dispute Result ── */}
        {state.dispute?.resolution && (
          <div className={`${s.disputeResult} ${
            state.dispute_status === "RESOLVED_BUYER_FAVOR" ? s.disputeBuyerWin :
            state.dispute_status === "RESOLVED_SELLER_FAVOR" ? s.disputeSellerWin :
            s.disputePartial
          }`}>
            <p className={s.disputeOutcome}>{state.dispute.resolution.outcome}</p>
            <p className={s.disputeSummary}>{state.dispute.resolution.summary}</p>
            {state.dispute.resolution.refund_amount != null && (
              <p className={s.disputeSummary}>
                <strong>환불: {formatCurrency(state.dispute.resolution.refund_amount)}</strong>
              </p>
            )}
          </div>
        )}

        {/* ── Completed ── */}
        {state.phase === "COMPLETED" && (
          <div style={{ textAlign: "center", padding: "12px", color: "#2d8a4e" }}>
            <div style={{ fontSize: "2rem" }}>🎉</div>
            <strong>거래 완료!</strong>
            <p style={{ fontSize: "0.85rem", margin: "4px 0 0", color: "#54473a" }}>
              판매자 수령액: {formatCurrency(state.seller_received)}
            </p>
          </div>
        )}

        {/* ── Reset ── */}
        {(state.phase === "COMPLETED" || state.phase === "REFUNDED") && (
          <button className={`${s.btn} ${s.btnOutline}`} onClick={() => onAction("reset")}>
            🔄 데모 초기화
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Shipping Status Card ────────────────────────────────────

function ShippingCard({ state }: { state: CommerceState }) {
  if (!state.shipment && state.shipment_status === "IDLE") return null;

  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>📦 배송</h3>
      {state.shipment ? (
        <div className={s.dealGrid}>
          <div className={s.dealItem}>
            <span className={s.dealLabel}>운송사</span>
            <span className={s.dealValue}>{state.shipment.carrier}</span>
          </div>
          <div className={s.dealItem}>
            <span className={s.dealLabel}>운송장 번호</span>
            <span className={s.dealValue} style={{ fontFamily: "monospace" }}>
              {state.shipment.tracking_number}
            </span>
          </div>
          <div className={s.dealItem}>
            <span className={s.dealLabel}>상태</span>
            <span className={`${s.badge} ${
              state.shipment_status === "DELIVERED" ? s.badgeCompleted :
              state.shipment_status === "DELIVERY_EXCEPTION" ? s.badgeDispute :
              s.badgeDelivery
            }`}>
              {state.shipment_status.replace(/_/g, " ")}
            </span>
          </div>
          <div className={s.dealItem}>
            <span className={s.dealLabel}>도착 예정일</span>
            <span className={s.dealValue}>
              {new Date(state.shipment.eta).toLocaleDateString("ko-KR")}
            </span>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: "0.85rem", color: "#8a7e6f", margin: 0 }}>
          판매자의 배송 정보 입력을 기다리는 중...
        </p>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────

export function CommerceDashboard() {
  const [state, setState] = useState<CommerceState | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setState(createInitialState());
    } catch (err) {
      console.error("createInitialState failed:", err);
      setInitError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleAction = useCallback((action: string, payload?: unknown) => {
    setState((prev) => {
      if (!prev) return prev;
      switch (action) {
        case "buyer_approve":
          return buyerApprove(prev);
        case "seller_approve":
          return sellerApprove(prev);
        case "process_payment":
          return processPayment(prev);
        case "submit_shipping":
          return submitShippingInfo(prev, payload as ShipmentInfo);
        case "advance_shipment":
          return advanceShipment(prev);
        case "delivery_exception":
          return triggerDeliveryException(prev);
        case "file_dispute":
          return fileDispute(prev, {
            reason_code: (payload as { reason_code: DisputeReasonCode }).reason_code,
            description: (payload as { description: string }).description,
            evidence_text: (payload as { evidence_text: string }).evidence_text,
          });
        case "start_ai_review":
          return startAiReview(prev);
        case "resolve_dispute":
          return resolveDispute(prev, payload as "buyer_favor" | "seller_favor" | "partial_refund");
        case "update_negotiation":
          return updateNegotiation(prev, payload as Partial<NegotiationResult>);
        case "reset":
          return createInitialState();
        default:
          return prev;
      }
    });
  }, []);

  if (!state) {
    return (
      <div className={s.shell}>
        <div className={s.header}>
          <h1>커머스 대시보드</h1>
          <a href="/" className={s.backLink}>← 협상 플레이그라운드</a>
        </div>
        <div className={s.card} style={{ textAlign: "center", padding: "48px" }}>
          {initError ? (
            <div style={{ color: "#c0392b" }}>
              <p style={{ fontWeight: 700 }}>초기화 실패</p>
              <pre style={{ fontSize: "0.8rem", whiteSpace: "pre-wrap", textAlign: "left" }}>{initError}</pre>
            </div>
          ) : (
            <p>로딩 중...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={s.shell}>
      <div className={s.header}>
        <h1>커머스 대시보드</h1>
        <a href="/" className={s.backLink}>← 협상 플레이그라운드</a>
      </div>

      <Stepper state={state} />

      <div className={s.main}>
        <div>
          <DealSummary state={state} onUpdate={(patch) => handleAction("update_negotiation", patch)} />
          <Wallets state={state} />
          <ShippingCard state={state} />
          <Timeline state={state} />
        </div>

        <div>
          <ActionPanel state={state} onAction={handleAction} />
          <TrustScores state={state} />
        </div>
      </div>
    </div>
  );
}
