"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeCounterOffer,
  computeUtility,
  makeDecision,
  type DecisionAction,
  type NegotiationContext,
  type UtilityResult,
  type UtilityWeights,
} from "./playground-engine";
import styles from "./playground.module.css";

type Actor = "seller" | "buyer";
type StageStatus = "ready" | "running" | "agreed" | "rejected" | "escalated";
type EventAction = DecisionAction | "OPEN";
type PresetId = "balanced" | "aggressive" | "patient";

interface EngineConfig {
  label: string;
  startPrice: number;
  targetPrice: number;
  limitPrice: number;
  deadlineHours: number;
  alpha: number;
  beta: number;
  timeFloor: number;
  threshold: number;
  aspiration: number;
  reputation: number;
  infoCompleteness: number;
  successCount: number;
  disputeLosses: number;
  weights: UtilityWeights;
}

interface TimelineEntry {
  id: string;
  actor: Actor;
  round: number;
  action: EventAction;
  incomingPrice: number;
  outgoingPrice?: number;
  elapsedHours: number;
  note: string;
  utility?: UtilityResult;
}

interface SimulationState {
  status: StageStatus;
  round: number;
  activeActor: Actor;
  currentPrice: number;
  elapsedHours: number;
  agreedPrice?: number;
  sellerNoConcession: number;
  buyerNoConcession: number;
  lastSellerOffer: number;
  lastBuyerOffer: number;
  timeline: TimelineEntry[];
}

interface TimeSamplePoint {
  hour: number;
  value: number;
}

interface ProjectionPoint {
  round: number;
  status: StageStatus;
  price: number;
  elapsedHours: number;
  sellerUtility: UtilityResult;
  buyerUtility: UtilityResult;
}

interface AgreementForecast {
  outcome: ProjectionPoint;
  intersectionIndex: number;
  closestGap: number;
  firstAgreementIndex: number | null;
}

interface PriceBandPoint {
  hour: number;
  sellerPrice: number;
  buyerPrice: number;
  overlap: boolean;
  gap: number;
}

const PRESETS: Record<PresetId, { seller: Partial<EngineConfig>; buyer: Partial<EngineConfig> }> = {
  balanced: {
    seller: {
      startPrice: 1120,
      targetPrice: 1080,
      limitPrice: 920,
      threshold: 0.45,
      aspiration: 0.74,
      beta: 0.8,
      alpha: 1.1,
      timeFloor: 0.42,
      weights: { w_p: 0.46, w_t: 0.16, w_r: 0.18, w_s: 0.2 },
    },
    buyer: {
      startPrice: 780,
      targetPrice: 860,
      limitPrice: 1020,
      threshold: 0.43,
      aspiration: 0.76,
      beta: 0.84,
      alpha: 1.08,
      timeFloor: 0.36,
      weights: { w_p: 0.5, w_t: 0.15, w_r: 0.15, w_s: 0.2 },
    },
  },
  aggressive: {
    seller: {
      startPrice: 1180,
      targetPrice: 1125,
      limitPrice: 940,
      threshold: 0.5,
      aspiration: 0.82,
      beta: 0.62,
      alpha: 1.25,
      timeFloor: 0.18,
      weights: { w_p: 0.58, w_t: 0.12, w_r: 0.12, w_s: 0.18 },
    },
    buyer: {
      startPrice: 720,
      targetPrice: 815,
      limitPrice: 980,
      threshold: 0.48,
      aspiration: 0.82,
      beta: 0.6,
      alpha: 1.24,
      timeFloor: 0.16,
      weights: { w_p: 0.59, w_t: 0.12, w_r: 0.11, w_s: 0.18 },
    },
  },
  patient: {
    seller: {
      startPrice: 1110,
      targetPrice: 1040,
      limitPrice: 905,
      threshold: 0.39,
      aspiration: 0.68,
      beta: 1.16,
      alpha: 0.92,
      timeFloor: 0.68,
      weights: { w_p: 0.4, w_t: 0.22, w_r: 0.18, w_s: 0.2 },
    },
    buyer: {
      startPrice: 790,
      targetPrice: 875,
      limitPrice: 1040,
      threshold: 0.38,
      aspiration: 0.69,
      beta: 1.14,
      alpha: 0.9,
      timeFloor: 0.64,
      weights: { w_p: 0.42, w_t: 0.22, w_r: 0.16, w_s: 0.2 },
    },
  },
};

const SELLER_DEFAULT: EngineConfig = {
  label: "셀러 엔진",
  startPrice: 1120,
  targetPrice: 1080,
  limitPrice: 920,
  deadlineHours: 24,
  alpha: 1.1,
  beta: 0.8,
  timeFloor: 0.42,
  threshold: 0.45,
  aspiration: 0.74,
  reputation: 0.88,
  infoCompleteness: 0.92,
  successCount: 6,
  disputeLosses: 0,
  weights: { w_p: 0.46, w_t: 0.16, w_r: 0.18, w_s: 0.2 },
};

const BUYER_DEFAULT: EngineConfig = {
  label: "바이어 엔진",
  startPrice: 780,
  targetPrice: 860,
  limitPrice: 1020,
  deadlineHours: 24,
  alpha: 1.08,
  beta: 0.84,
  timeFloor: 0.36,
  threshold: 0.43,
  aspiration: 0.76,
  reputation: 0.82,
  infoCompleteness: 0.9,
  successCount: 4,
  disputeLosses: 0,
  weights: { w_p: 0.5, w_t: 0.15, w_r: 0.15, w_s: 0.2 },
};

function normalizeWeights(weights: UtilityWeights): UtilityWeights {
  const total = weights.w_p + weights.w_t + weights.w_r + weights.w_s;
  if (total <= 0) {
    return { w_p: 0.25, w_t: 0.25, w_r: 0.25, w_s: 0.25 };
  }

  return {
    w_p: weights.w_p / total,
    w_t: weights.w_t / total,
    w_r: weights.w_r / total,
    w_s: weights.w_s / total,
  };
}

function roundPrice(value: number): number {
  return Math.round(value);
}

function formatCurrency(value: number | undefined): string {
  if (value == null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatActor(actor: Actor): string {
  return actor === "seller" ? "셀러" : "바이어";
}

function formatStatus(status: StageStatus): string {
  switch (status) {
    case "ready":
      return "준비";
    case "running":
      return "진행 중";
    case "agreed":
      return "합의";
    case "rejected":
      return "거절";
    case "escalated":
      return "사람 개입";
    default:
      return status;
  }
}

function formatAction(action: EventAction): string {
  switch (action) {
    case "OPEN":
      return "시작";
    case "ACCEPT":
      return "수락";
    case "COUNTER":
      return "카운터";
    case "REJECT":
      return "거절";
    case "NEAR_DEAL":
      return "거의 성사";
    case "ESCALATE":
      return "사람 개입";
    default:
      return action;
  }
}

function computeTimeUtilityPreview(config: EngineConfig, elapsedHours: number): number {
  const ratio = Math.max(0, 1 - elapsedHours / config.deadlineHours) ** config.alpha;
  return Math.max(config.timeFloor, ratio);
}

function buildTimeSeries(config: EngineConfig, samples = 24): TimeSamplePoint[] {
  const steps = Math.max(2, samples);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const hour = (config.deadlineHours / steps) * index;
    return {
      hour,
      value: computeTimeUtilityPreview(config, hour),
    };
  });
}

function buildLinePath(points: TimeSamplePoint[], width: number, height: number): string {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = (point.hour / points[points.length - 1].hour) * width;
      const y = (1 - point.value) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildIndexedPath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }

  const maxIndex = Math.max(values.length - 1, 1);
  return values
    .map((value, index) => {
      const x = (index / maxIndex) * width;
      const y = (1 - value) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function pointPosition(config: EngineConfig, elapsedHours: number, width: number, height: number) {
  const clampedHour = Math.min(Math.max(elapsedHours, 0), config.deadlineHours);
  return {
    x: (clampedHour / config.deadlineHours) * width,
    y: (1 - computeTimeUtilityPreview(config, clampedHour)) * height,
  };
}

function computeActorUtility(actor: Actor, config: EngineConfig, price: number, elapsedHours: number): UtilityResult {
  return computeUtility(buildContext(actor, config, price, elapsedHours));
}

function projectNegotiation(
  simulation: SimulationState,
  seller: EngineConfig,
  buyer: EngineConfig,
  elapsedStepHours: number,
  maxSteps = 12,
): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  let current = simulation;

  for (let index = 0; index < maxSteps; index += 1) {
    points.push({
      round: current.round,
      status: current.status,
      price: current.status === "agreed" ? current.agreedPrice ?? current.currentPrice : current.currentPrice,
      elapsedHours: current.elapsedHours,
      sellerUtility: computeActorUtility("seller", seller, current.currentPrice, current.elapsedHours),
      buyerUtility: computeActorUtility("buyer", buyer, current.currentPrice, current.elapsedHours),
    });

    if (current.status === "agreed" || current.status === "rejected" || current.status === "escalated") {
      break;
    }

    current = advanceSimulation(current, seller, buyer, elapsedStepHours);
  }

  return points;
}

function makeInitialSimulation(seller: EngineConfig, buyer: EngineConfig): SimulationState {
  return {
    status: "ready",
    round: 1,
    activeActor: "seller",
    currentPrice: buyer.startPrice,
    elapsedHours: 0,
    sellerNoConcession: 0,
    buyerNoConcession: 0,
    lastSellerOffer: seller.startPrice,
    lastBuyerOffer: buyer.startPrice,
    timeline: [
      {
        id: "opening",
        actor: "buyer",
        round: 0,
        action: "OPEN",
        incomingPrice: buyer.startPrice,
        outgoingPrice: buyer.startPrice,
        elapsedHours: 0,
        note: `바이어가 ${formatCurrency(buyer.startPrice)}에 첫 제안을 시작합니다.`,
      },
    ],
  };
}

function buildContext(actor: Actor, config: EngineConfig, effectivePrice: number, elapsedHours: number): NegotiationContext {
  return {
    weights: normalizeWeights(config.weights),
    price: {
      p_effective: effectivePrice,
      p_target: config.targetPrice,
      p_limit: config.limitPrice,
    },
    time: {
      t_elapsed: elapsedHours,
      t_deadline: config.deadlineHours,
      alpha: config.alpha,
      v_t_floor: config.timeFloor,
    },
    risk: {
      r_score: config.reputation,
      i_completeness: config.infoCompleteness,
      w_rep: 0.55,
      w_info: 0.45,
    },
    relationship: {
      n_success: config.successCount,
      n_dispute_losses: config.disputeLosses,
      n_threshold: 8,
      v_s_base: 0.14,
    },
  };
}

function computeDesiredOffer(actor: Actor, config: EngineConfig, elapsedHours: number): number {
  const raw = computeCounterOffer({
    p_start: config.startPrice,
    p_limit: config.limitPrice,
    t: Math.min(elapsedHours, config.deadlineHours),
    T: config.deadlineHours,
    beta: config.beta,
  });

  return roundPrice(raw);
}

function advanceSimulation(
  simulation: SimulationState,
  seller: EngineConfig,
  buyer: EngineConfig,
  elapsedStepHours: number,
): SimulationState {
  if (simulation.status === "agreed" || simulation.status === "rejected" || simulation.status === "escalated") {
    return simulation;
  }

  const actor = simulation.activeActor;
  const config = actor === "seller" ? seller : buyer;
  const utility = computeUtility(buildContext(actor, config, simulation.currentPrice, simulation.elapsedHours));
  const decision = makeDecision(
    utility,
    { u_threshold: config.threshold, u_aspiration: config.aspiration },
    {
      rounds_no_concession: actor === "seller" ? simulation.sellerNoConcession : simulation.buyerNoConcession,
    },
  );

  const nextElapsedHours = simulation.elapsedHours + elapsedStepHours;
  const desired = computeDesiredOffer(actor, config, nextElapsedHours);
  const range = Math.max(Math.abs(config.startPrice - config.limitPrice), 1);
  const closeness = Math.abs(simulation.currentPrice - desired) / range;
  const timeline = [...simulation.timeline];
  const baseEvent = {
    id: `${actor}-${simulation.round}-${timeline.length}`,
    actor,
    round: simulation.round,
    incomingPrice: simulation.currentPrice,
    elapsedHours: simulation.elapsedHours,
    utility,
  };

  if (decision.action === "REJECT") {
    timeline.push({
      ...baseEvent,
      action: "REJECT",
      note: `${actor === "seller" ? "셀러" : "바이어"}가 ${formatCurrency(simulation.currentPrice)}에서 거절했습니다.`,
    });

    return {
      ...simulation,
      status: "rejected",
      timeline,
    };
  }

  if (decision.action === "ESCALATE") {
    timeline.push({
      ...baseEvent,
      action: "ESCALATE",
      note: `${actor === "seller" ? "셀러" : "바이어"}가 반복 정체로 인해 사람 개입을 요청합니다.`,
    });

    return {
      ...simulation,
      status: "escalated",
      timeline,
    };
  }

  if (decision.action === "ACCEPT" || (decision.action === "NEAR_DEAL" && closeness < 0.18)) {
    timeline.push({
      ...baseEvent,
      action: decision.action,
      outgoingPrice: simulation.currentPrice,
      note: `${actor === "seller" ? "셀러" : "바이어"}가 ${formatCurrency(simulation.currentPrice)}에 수락했습니다.`,
    });

    return {
      ...simulation,
      status: "agreed",
      agreedPrice: simulation.currentPrice,
      timeline,
    };
  }

  const minStep = Math.max(8, Math.round(range * 0.06));
  let outgoingPrice: number;

  if (actor === "seller") {
    outgoingPrice = roundPrice(Math.max(desired, simulation.currentPrice + minStep));
    outgoingPrice = Math.min(outgoingPrice, seller.startPrice);
    outgoingPrice = Math.max(outgoingPrice, seller.limitPrice);
  } else {
    outgoingPrice = roundPrice(Math.min(desired, simulation.currentPrice - minStep));
    outgoingPrice = Math.max(outgoingPrice, buyer.startPrice);
    outgoingPrice = Math.min(outgoingPrice, buyer.limitPrice);
  }

  const note =
    decision.action === "NEAR_DEAL"
      ? `${actor === "seller" ? "셀러" : "바이어"}가 거의 성사 상태로 보고 한 번 더 가격을 조정합니다.`
      : `${actor === "seller" ? "셀러" : "바이어"}가 ${formatCurrency(outgoingPrice)}로 카운터합니다.`;

  timeline.push({
    ...baseEvent,
    action: decision.action,
    outgoingPrice,
    note,
  });

  const sellerConcession =
    actor === "seller" && outgoingPrice < simulation.lastSellerOffer ? 0 : simulation.sellerNoConcession + (actor === "seller" ? 1 : 0);
  const buyerConcession =
    actor === "buyer" && outgoingPrice > simulation.lastBuyerOffer ? 0 : simulation.buyerNoConcession + (actor === "buyer" ? 1 : 0);

  return {
    status: "running",
    round: simulation.round + 1,
    activeActor: actor === "seller" ? "buyer" : "seller",
    currentPrice: outgoingPrice,
    elapsedHours: nextElapsedHours,
    agreedPrice: undefined,
    sellerNoConcession: sellerConcession,
    buyerNoConcession: buyerConcession,
    lastSellerOffer: actor === "seller" ? outgoingPrice : simulation.lastSellerOffer,
    lastBuyerOffer: actor === "buyer" ? outgoingPrice : simulation.lastBuyerOffer,
    timeline,
  };
}

function applyPreset(base: EngineConfig, actor: Actor, preset: PresetId): EngineConfig {
  const next = PRESETS[preset][actor];
  return {
    ...base,
    ...next,
    weights: normalizeWeights(next.weights ?? base.weights),
  };
}

function StatusBadge({ status }: { status: StageStatus }) {
  return <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>{formatStatus(status)}</span>;
}

function WeightInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className={styles.weightField}>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function EnginePanel({
  side,
  config,
  onConfigChange,
}: {
  side: Actor;
  config: EngineConfig;
  onConfigChange: (next: EngineConfig) => void;
}) {
  const update = <K extends keyof EngineConfig>(key: K, value: EngineConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  const updateWeight = (key: keyof UtilityWeights, value: number) => {
    onConfigChange({
      ...config,
      weights: normalizeWeights({
        ...config.weights,
        [key]: value,
      }),
    });
  };

  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>{side === "seller" ? "셀러 엔진" : "바이어 엔진"}</p>
          <h2>{config.label}</h2>
        </div>
        <div className={styles.presetGroup}>
          {(["balanced", "aggressive", "patient"] as PresetId[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={styles.presetButton}
              onClick={() => onConfigChange(applyPreset(config, side, preset))}
            >
              {preset === "balanced" ? "균형형" : preset === "aggressive" ? "공격형" : "인내형"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.fieldGrid}>
        <label>
          <span>{side === "seller" ? "초기 제시가" : "초기 제안가"}</span>
          <input
            type="number"
            value={config.startPrice}
            onChange={(event) => update("startPrice", Number(event.target.value))}
          />
        </label>
        <label>
          <span>{side === "seller" ? "희망 판매가" : "목표 구매가"}</span>
          <input
            type="number"
            value={config.targetPrice}
            onChange={(event) => update("targetPrice", Number(event.target.value))}
          />
        </label>
        <label>
          <span>{side === "seller" ? "최저 수용가" : "최대 구매가"}</span>
          <input
            type="number"
            value={config.limitPrice}
            onChange={(event) => update("limitPrice", Number(event.target.value))}
          />
        </label>
        <label>
          <span>마감 시간(시간)</span>
          <input
            type="number"
            min="1"
            value={config.deadlineHours}
            onChange={(event) => update("deadlineHours", Number(event.target.value))}
          />
        </label>
        <label>
          <span>유틸리티 기준선</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={config.threshold}
            onChange={(event) => update("threshold", Number(event.target.value))}
          />
        </label>
        <label>
          <span>목표 기대치</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={config.aspiration}
            onChange={(event) => update("aspiration", Number(event.target.value))}
          />
        </label>
        <label>
          <span>양보 속도(beta)</span>
          <input
            type="number"
            min="0.2"
            max="2"
            step="0.01"
            value={config.beta}
            onChange={(event) => update("beta", Number(event.target.value))}
          />
        </label>
        <label>
          <span>시간 민감도(alpha)</span>
          <input
            type="number"
            min="0.2"
            max="2"
            step="0.01"
            value={config.alpha}
            onChange={(event) => update("alpha", Number(event.target.value))}
          />
        </label>
        <label>
          <span>시간 바닥값(V_t_floor)</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={config.timeFloor}
            onChange={(event) => update("timeFloor", Number(event.target.value))}
          />
        </label>
      </div>

      <div className={styles.subSection}>
        <h3>신뢰 입력값</h3>
        <div className={styles.fieldGrid}>
          <label>
            <span>평판</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={config.reputation}
              onChange={(event) => update("reputation", Number(event.target.value))}
            />
          </label>
          <label>
            <span>정보 충실도</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={config.infoCompleteness}
              onChange={(event) => update("infoCompleteness", Number(event.target.value))}
            />
          </label>
          <label>
            <span>이전 성공 수</span>
            <input
              type="number"
              min="0"
              value={config.successCount}
              onChange={(event) => update("successCount", Number(event.target.value))}
            />
          </label>
          <label>
            <span>분쟁 손실 수</span>
            <input
              type="number"
              min="0"
              value={config.disputeLosses}
              onChange={(event) => update("disputeLosses", Number(event.target.value))}
            />
          </label>
        </div>
      </div>

      <div className={styles.subSection}>
        <h3>유틸리티 가중치</h3>
        <div className={styles.weightGrid}>
          <WeightInput label="가격" value={config.weights.w_p} onChange={(next) => updateWeight("w_p", next)} />
          <WeightInput label="시간" value={config.weights.w_t} onChange={(next) => updateWeight("w_t", next)} />
          <WeightInput label="리스크" value={config.weights.w_r} onChange={(next) => updateWeight("w_r", next)} />
          <WeightInput label="관계" value={config.weights.w_s} onChange={(next) => updateWeight("w_s", next)} />
        </div>
      </div>
    </section>
  );
}

function TimeUtilityDemo({
  seller,
  buyer,
  elapsedHours,
}: {
  seller: EngineConfig;
  buyer: EngineConfig;
  elapsedHours: number;
}) {
  const width = 420;
  const height = 150;
  const sellerSeries = useMemo(() => buildTimeSeries(seller), [seller]);
  const buyerSeries = useMemo(() => buildTimeSeries(buyer), [buyer]);
  const sellerPath = useMemo(() => buildLinePath(sellerSeries, width, height), [sellerSeries]);
  const buyerPath = useMemo(() => buildLinePath(buyerSeries, width, height), [buyerSeries]);
  const sellerPoint = pointPosition(seller, elapsedHours, width, height);
  const buyerPoint = pointPosition(buyer, elapsedHours, width, height);

  return (
    <section className={styles.timeDemoSection}>
      <div className={styles.timeDemoHeader}>
        <div>
          <p className={styles.panelEyebrow}>시간 효용 데모</p>
          <h3>시간이 지날수록 V_t가 어떻게 변하는지</h3>
        </div>
        <div className={styles.timeLegend}>
          <span className={styles.legendSeller}>셀러 V_t</span>
          <span className={styles.legendBuyer}>바이어 V_t</span>
        </div>
      </div>

      <div className={styles.timeDemoBody}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={styles.timeChart}
          role="img"
          aria-label="시간 경과에 따른 셀러와 바이어 시간 효용 변화"
        >
          <line x1="0" y1={height} x2={width} y2={height} className={styles.axisLine} />
          <line x1="0" y1="0" x2="0" y2={height} className={styles.axisLine} />
          <path d={sellerPath} className={styles.sellerLine} />
          <path d={buyerPath} className={styles.buyerLine} />
          <line
            x1={sellerPoint.x}
            y1="0"
            x2={sellerPoint.x}
            y2={height}
            className={styles.currentTimeLine}
          />
          <circle cx={sellerPoint.x} cy={sellerPoint.y} r="5" className={styles.sellerPoint} />
          <circle cx={buyerPoint.x} cy={buyerPoint.y} r="5" className={styles.buyerPoint} />
        </svg>

        <div className={styles.timeDemoStats}>
          <article className={styles.timeMiniCard}>
            <span>현재 경과 시간</span>
            <strong>{elapsedHours.toFixed(1)}시간</strong>
            <p>지금 마커가 가리키는 시점입니다.</p>
          </article>
          <article className={styles.timeMiniCard}>
            <span>셀러 V_t</span>
            <strong>{computeTimeUtilityPreview(seller, elapsedHours).toFixed(2)}</strong>
            <p>
              마감 {seller.deadlineHours}시간, 바닥값 {seller.timeFloor.toFixed(2)}
            </p>
          </article>
          <article className={styles.timeMiniCard}>
            <span>바이어 V_t</span>
            <strong>{computeTimeUtilityPreview(buyer, elapsedHours).toFixed(2)}</strong>
            <p>
              마감 {buyer.deadlineHours}시간, 바닥값 {buyer.timeFloor.toFixed(2)}
            </p>
          </article>
        </div>
      </div>

      <div className={styles.timeAxisLabels}>
        <span>0시간</span>
        <span>중간</span>
        <span>마감</span>
      </div>
    </section>
  );
}

function buildForecast(
  projection: ProjectionPoint[],
  sellerThreshold: number,
  buyerThreshold: number,
): AgreementForecast {
  const firstAgreementIndex = projection.findIndex(
    (point) =>
      point.sellerUtility.u_total >= sellerThreshold &&
      point.buyerUtility.u_total >= buyerThreshold &&
      point.sellerUtility.v_p > 0 &&
      point.buyerUtility.v_p > 0,
  );
  const intersectionIndex = projection.reduce((bestIndex, point, index) => {
    const gap = Math.abs(point.sellerUtility.u_total - point.buyerUtility.u_total);
    const bestGap = Math.abs(
      projection[bestIndex].sellerUtility.u_total - projection[bestIndex].buyerUtility.u_total,
    );
    return gap < bestGap ? index : bestIndex;
  }, 0);

  return {
    outcome: projection[projection.length - 1],
    intersectionIndex,
    closestGap: Math.abs(
      projection[intersectionIndex].sellerUtility.u_total - projection[intersectionIndex].buyerUtility.u_total,
    ),
    firstAgreementIndex: firstAgreementIndex >= 0 ? firstAgreementIndex : null,
  };
}

function buildPriceBandSeries(
  seller: EngineConfig,
  buyer: EngineConfig,
  maxHours: number,
  samples = 32,
): PriceBandPoint[] {
  const steps = Math.max(4, samples);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const hour = (maxHours / steps) * index;
    const sellerPrice = computeDesiredOffer("seller", seller, Math.min(hour, seller.deadlineHours));
    const buyerPrice = computeDesiredOffer("buyer", buyer, Math.min(hour, buyer.deadlineHours));
    return {
      hour,
      sellerPrice,
      buyerPrice,
      overlap: buyerPrice >= sellerPrice,
      gap: sellerPrice - buyerPrice,
    };
  });
}

function buildPricePath(
  points: PriceBandPoint[],
  key: "sellerPrice" | "buyerPrice",
  width: number,
  height: number,
  minPrice: number,
  maxPrice: number,
): string {
  if (points.length === 0) {
    return "";
  }

  const priceRange = Math.max(maxPrice - minPrice, 1);
  const maxHour = Math.max(points[points.length - 1]?.hour ?? 1, 1);

  return points
    .map((point, index) => {
      const x = (point.hour / maxHour) * width;
      const y = ((maxPrice - point[key]) / priceRange) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function pricePointPosition(
  hour: number,
  price: number,
  maxHours: number,
  width: number,
  height: number,
  minPrice: number,
  maxPrice: number,
) {
  const priceRange = Math.max(maxPrice - minPrice, 1);
  return {
    x: (hour / Math.max(maxHours, 1)) * width,
    y: ((maxPrice - price) / priceRange) * height,
  };
}

function TimeSlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className={styles.sliderShell}>
      <div className={styles.sliderHeader}>
        <div>
          <span>현재 경과 시간</span>
          <strong>{value.toFixed(1)}시간</strong>
        </div>
        <div>
          <span>최대 기준</span>
          <strong>{max.toFixed(1)}시간</strong>
        </div>
      </div>
      <input
        className={styles.timeSlider}
        type="range"
        min="0"
        max={max}
        step="0.5"
        value={Math.min(value, max)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className={styles.sliderTicks}>
        <span>0h</span>
        <span>{(max / 2).toFixed(0)}h</span>
        <span>{max.toFixed(0)}h</span>
      </div>
    </div>
  );
}

function ForecastChart({
  seller,
  buyer,
  projection,
  currentElapsedHours,
  maxHours,
  sellerThreshold,
  buyerThreshold,
}: {
  seller: EngineConfig;
  buyer: EngineConfig;
  projection: ProjectionPoint[];
  currentElapsedHours: number;
  maxHours: number;
  sellerThreshold: number;
  buyerThreshold: number;
}) {
  const width = 620;
  const height = 210;
  const bandSeries = buildPriceBandSeries(seller, buyer, maxHours);
  const minPrice = Math.min(...bandSeries.map((point) => Math.min(point.sellerPrice, point.buyerPrice)));
  const maxPrice = Math.max(...bandSeries.map((point) => Math.max(point.sellerPrice, point.buyerPrice)));
  const sellerPath = buildPricePath(bandSeries, "sellerPrice", width, height, minPrice, maxPrice);
  const buyerPath = buildPricePath(bandSeries, "buyerPrice", width, height, minPrice, maxPrice);
  const currentX = (Math.min(currentElapsedHours, maxHours) / Math.max(maxHours, 1)) * width;
  const forecast = buildForecast(projection, sellerThreshold, buyerThreshold);
  const overlapIndex = bandSeries.findIndex((point) => point.overlap);
  const keyBandIndex = overlapIndex >= 0 ? overlapIndex : bandSeries.reduce((bestIndex, point, index) => {
    const bestGap = Math.abs(bandSeries[bestIndex].gap);
    return Math.abs(point.gap) < bestGap ? index : bestIndex;
  }, 0);
  const crossingBand = bandSeries[keyBandIndex];
  const intersectionX = (crossingBand.hour / Math.max(maxHours, 1)) * width;
  const sellerPoint = pricePointPosition(
    crossingBand.hour,
    crossingBand.sellerPrice,
    maxHours,
    width,
    height,
    minPrice,
    maxPrice,
  );
  const buyerPoint = pricePointPosition(
    crossingBand.hour,
    crossingBand.buyerPrice,
    maxHours,
    width,
    height,
    minPrice,
    maxPrice,
  );

  return (
    <article className={styles.forecastCard}>
      <div className={styles.forecastHeader}>
        <div>
          <p className={styles.panelEyebrow}>가격 밴드 차트</p>
          <h3>셀러가 원하는 가격과 바이어가 가능한 가격이 언제 만나는지</h3>
        </div>
        <div className={styles.forecastLegend}>
          <span className={styles.legendSeller}>셀러 요구 가격</span>
          <span className={styles.legendBuyer}>바이어 가능 가격</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className={styles.forecastChart}>
        <line x1="0" y1={height} x2={width} y2={height} className={styles.axisLine} />
        <line x1="0" y1="0" x2="0" y2={height} className={styles.axisLine} />
        <path d={sellerPath} className={styles.sellerLine} />
        <path d={buyerPath} className={styles.buyerLine} />
        <line x1={currentX} y1="0" x2={currentX} y2={height} className={styles.currentTimeLine} />
        <line x1={intersectionX} y1="0" x2={intersectionX} y2={height} className={styles.intersectionLine} />
        <circle cx={sellerPoint.x} cy={sellerPoint.y} r="6" className={styles.sellerPoint} />
        <circle cx={buyerPoint.x} cy={buyerPoint.y} r="6" className={styles.buyerPoint} />
      </svg>

      <div className={styles.forecastMarkers}>
        <div className={styles.markerCard}>
          <span>현재 시점</span>
          <strong>{currentElapsedHours.toFixed(1)}시간</strong>
          <p>세로 점선이 현재 시간 위치입니다.</p>
        </div>
        <div className={styles.markerCard}>
          <span>{crossingBand.overlap ? "첫 합의 가능 구간" : "가장 가까운 가격 접근"}</span>
          <strong>
            {crossingBand.hour.toFixed(1)}시간
          </strong>
          <p>
            셀러 {formatCurrency(crossingBand.sellerPrice)} / 바이어 {formatCurrency(crossingBand.buyerPrice)}
          </p>
        </div>
        <div className={styles.markerCard}>
          <span>예상 종료</span>
          <strong>{formatStatus(forecast.outcome.status)}</strong>
          <p>
            라운드 {forecast.outcome.round} · {formatCurrency(forecast.outcome.price)}
          </p>
        </div>
      </div>
    </article>
  );
}

function UtilityMiniCards({
  point,
  seller,
  buyer,
  maxHours,
}: {
  point: ProjectionPoint;
  seller: EngineConfig;
  buyer: EngineConfig;
  maxHours: number;
}) {
  const bandSeries = buildPriceBandSeries(seller, buyer, maxHours);
  const overlap = bandSeries.find((entry) => entry.overlap) ?? bandSeries.reduce((best, current) => {
    return Math.abs(current.gap) < Math.abs(best.gap) ? current : best;
  }, bandSeries[0]);

  return (
    <div className={styles.utilityMiniGrid}>
      <article className={styles.utilityMiniCard}>
        <span>현재 셀러 가격 효용</span>
        <strong>{point.sellerUtility.v_p.toFixed(2)}</strong>
        <p>
          현재 가격 {formatCurrency(point.price)} 에서 셀러가 느끼는 가격 만족도입니다.
        </p>
      </article>
      <article className={styles.utilityMiniCard}>
        <span>현재 바이어 가격 효용</span>
        <strong>{point.buyerUtility.v_p.toFixed(2)}</strong>
        <p>
          현재 가격 {formatCurrency(point.price)} 에서 바이어가 느끼는 가격 만족도입니다.
        </p>
      </article>
      <article className={styles.utilityMiniCard}>
        <span>합의 가능 가격차</span>
        <strong>{formatCurrency(Math.abs(overlap.gap))}</strong>
        <p>0에 가까울수록 셀러와 바이어 가격 밴드가 실제로 만납니다.</p>
      </article>
    </div>
  );
}

export function NegotiationPlayground() {
  const [sellerConfig, setSellerConfig] = useState<EngineConfig>(SELLER_DEFAULT);
  const [buyerConfig, setBuyerConfig] = useState<EngineConfig>(BUYER_DEFAULT);
  const [simulation, setSimulation] = useState<SimulationState>(() =>
    makeInitialSimulation(SELLER_DEFAULT, BUYER_DEFAULT),
  );
  const [autoRun, setAutoRun] = useState(false);
  const [hoursPerTurn, setHoursPerTurn] = useState(0);

  const resetSimulation = () => {
    setAutoRun(false);
    setSimulation(makeInitialSimulation(sellerConfig, buyerConfig));
  };

  useEffect(() => {
    if (!autoRun) {
      return;
    }

    if (simulation.status === "agreed" || simulation.status === "rejected" || simulation.status === "escalated") {
      setAutoRun(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setSimulation((current) => advanceSimulation(current, sellerConfig, buyerConfig, hoursPerTurn));
    }, 900);

    return () => window.clearTimeout(timer);
  }, [autoRun, simulation, sellerConfig, buyerConfig]);

  const latestEvent = simulation.timeline[simulation.timeline.length - 1];
  const maxTimelineHours = useMemo(
    () => Math.max(sellerConfig.deadlineHours, buyerConfig.deadlineHours),
    [sellerConfig.deadlineHours, buyerConfig.deadlineHours],
  );
  const sellerTimeUtility = useMemo(
    () => computeTimeUtilityPreview(sellerConfig, simulation.elapsedHours),
    [sellerConfig, simulation.elapsedHours],
  );
  const buyerTimeUtility = useMemo(
    () => computeTimeUtilityPreview(buyerConfig, simulation.elapsedHours),
    [buyerConfig, simulation.elapsedHours],
  );
  const centerSummary = useMemo(
    () => ({
      currentPrice: simulation.status === "agreed" ? simulation.agreedPrice : simulation.currentPrice,
      nextActor: simulation.status === "agreed" || simulation.status === "rejected" || simulation.status === "escalated"
        ? null
        : simulation.activeActor,
    }),
    [simulation],
  );
  const projection = useMemo(
    () => projectNegotiation(simulation, sellerConfig, buyerConfig, hoursPerTurn),
    [simulation, sellerConfig, buyerConfig, hoursPerTurn],
  );
  const forecast = useMemo(
    () => buildForecast(projection, sellerConfig.threshold, buyerConfig.threshold),
    [projection, sellerConfig.threshold, buyerConfig.threshold],
  );

  const advanceWithCurrentPace = () => {
    setSimulation((current) => advanceSimulation(current, sellerConfig, buyerConfig, hoursPerTurn));
  };

  return (
    <main className={styles.shell}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>협상 플레이그라운드</p>
          <h1>한 화면에서 보는 셀러와 바이어 엔진의 협상 흐름</h1>
          <p className={styles.heroCopy}>
            양쪽 엔진 설정을 조정한 뒤, 가운데 타임라인에서 오퍼가 어떻게 움직이고 유틸리티가 어디서 바뀌는지,
            그리고 왜 합의·거절·사람 개입으로 끝나는지 바로 볼 수 있습니다.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <div style={{ gridColumn: "1 / -1" }}>
            <a href="/commerce" style={{ display: "inline-block", padding: "8px 16px", background: "#d87421", color: "#fff", borderRadius: "10px", textDecoration: "none", fontWeight: 700, fontSize: "0.88rem" }}>
              → Commerce Dashboard
            </a>
          </div>
          <div>
            <span>상태</span>
            <StatusBadge status={simulation.status} />
          </div>
          <div>
            <span>현재 거래 가격</span>
            <strong>{formatCurrency(centerSummary.currentPrice)}</strong>
          </div>
          <div>
            <span>다음 차례</span>
            <strong>{centerSummary.nextActor ? `${formatActor(centerSummary.nextActor)} 엔진 평가` : "세션 종료"}</strong>
          </div>
          <div>
            <span>세션 경과 시간</span>
            <strong>{simulation.elapsedHours.toFixed(1)}시간</strong>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <EnginePanel side="seller" config={sellerConfig} onConfigChange={setSellerConfig} />

        <section className={styles.centerPanel}>
          <div className={styles.controlBar}>
            <div>
              <p className={styles.panelEyebrow}>실시간 흐름</p>
              <h2>협상 타임라인</h2>
            </div>
            <div className={styles.controlActions}>
              <button type="button" className={styles.secondaryButton} onClick={resetSimulation}>
                초기화
              </button>
              <button type="button" className={styles.secondaryButton} onClick={advanceWithCurrentPace}>
                다음 라운드
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => setAutoRun((value) => !value)}>
                {autoRun ? "자동 진행 일시정지" : "자동 진행"}
              </button>
            </div>
          </div>

          <div className={styles.timeControlRow}>
            <TimeSlider
              value={simulation.elapsedHours}
              max={maxTimelineHours}
              onChange={(next) =>
                setSimulation((current) => ({
                  ...current,
                  elapsedHours: next,
                }))
              }
            />
            <label className={styles.timeControl}>
              <span>턴당 시간 증가(시간)</span>
              <input
                type="number"
                min="0"
                step="0.25"
                value={hoursPerTurn}
                onChange={(event) => setHoursPerTurn(Number(event.target.value))}
              />
            </label>
            <div className={styles.timeExplainer}>
              <span>문서 기준</span>
              <strong>시간 효용은 라운드 수가 아니라 실제 경과 시간 기반</strong>
              <p>
                라운드는 제안 왕복일 뿐입니다. 기본값에서는 라운드를 넘겨도 시간이 자동으로 흐르지 않고, 위 값이나 현재
                경과 시간을 직접 바꿀 때만 시간 효용이 변합니다.
              </p>
            </div>
          </div>

          <TimeUtilityDemo seller={sellerConfig} buyer={buyerConfig} elapsedHours={simulation.elapsedHours} />

          <section className={styles.projectionSection}>
            <div className={styles.timeDemoHeader}>
              <div>
                <p className={styles.panelEyebrow}>효용 변화와 합의 예측</p>
                <h3>지금 설정대로 가면 언제 거래가 성사되는지</h3>
              </div>
              <div className={styles.projectionOutcome}>
                <span>예상 결과</span>
                <strong>{formatStatus(forecast.outcome.status)}</strong>
                <p>
                  라운드 {forecast.outcome.round}, {forecast.outcome.elapsedHours.toFixed(1)}시간,{" "}
                  {formatCurrency(forecast.outcome.price)}
                </p>
              </div>
            </div>

            <ForecastChart
              projection={projection}
              currentElapsedHours={simulation.elapsedHours}
              maxHours={maxTimelineHours}
              seller={sellerConfig}
              buyer={buyerConfig}
              sellerThreshold={sellerConfig.threshold}
              buyerThreshold={buyerConfig.threshold}
            />
            <UtilityMiniCards
              point={projection[Math.min(forecast.firstAgreementIndex ?? forecast.intersectionIndex, projection.length - 1)]}
              seller={sellerConfig}
              buyer={buyerConfig}
              maxHours={maxTimelineHours}
            />
          </section>

          <div className={styles.snapshotRow}>
            <article className={styles.snapshotCard}>
              <span>라운드</span>
              <strong>{simulation.round}</strong>
            </article>
            <article className={styles.snapshotCard}>
              <span>경과 시간</span>
              <strong>{simulation.elapsedHours.toFixed(1)}h</strong>
            </article>
            <article className={styles.snapshotCard}>
              <span>최근 액션</span>
              <strong>{formatAction(latestEvent.action)}</strong>
            </article>
            <article className={styles.snapshotCard}>
              <span>셀러 시간 효용 V_t</span>
              <strong>{sellerTimeUtility.toFixed(2)}</strong>
            </article>
            <article className={styles.snapshotCard}>
              <span>바이어 시간 효용 V_t</span>
              <strong>{buyerTimeUtility.toFixed(2)}</strong>
            </article>
          </div>

          <div className={styles.progressRail}>
            <div className={styles.progressLine} />
            {simulation.timeline.map((entry) => (
              <article key={entry.id} className={`${styles.eventCard} ${styles[`actor_${entry.actor}`]}`}>
                <div className={styles.eventHeader}>
                  <span>{entry.actor === "seller" ? "셀러" : "바이어"}</span>
                  <strong>{formatAction(entry.action)}</strong>
                </div>
                <p className={styles.eventPrice}>
                  {formatCurrency(entry.incomingPrice)}
                  {entry.outgoingPrice != null ? ` → ${formatCurrency(entry.outgoingPrice)}` : ""}
                </p>
                <p className={styles.eventNote}>{entry.note}</p>
                {entry.utility ? (
                  <div className={styles.utilityGrid}>
                    <div>
                      <span>U</span>
                      <strong>{entry.utility.u_total.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Price</span>
                      <span>가격</span>
                      <strong>{entry.utility.v_p.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>시간</span>
                      <strong>{entry.utility.v_t.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>리스크</span>
                      <strong>{entry.utility.v_r.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>관계</span>
                      <strong>{entry.utility.v_s.toFixed(2)}</strong>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <EnginePanel side="buyer" config={buyerConfig} onConfigChange={setBuyerConfig} />
      </div>
    </main>
  );
}
