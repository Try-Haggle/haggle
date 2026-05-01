"use client";

import type { DemoRoundResponse } from "@/lib/demo-types";

type CoachTone = "cyan" | "emerald" | "amber" | "red" | "violet";
export type Expression =
  | "curious"
  | "thinking"
  | "alert"
  | "success"
  | "calm"
  | "surprised"
  | "frustrated"
  | "confident"
  | "nearDeal";

export type AncientBeingId =
  | "fab"
  | "vel"
  | "judge"
  | "hark"
  | "mia"
  | "vault"
  | "dealer_kai"
  | "dealer_hana"
  | "dealer_ethan"
  | "dealer_claire"
  | "buddy_fizz"
  | "buddy_echo";

export type AncientBeing = {
  id: AncientBeingId;
  name: string;
  role: string;
  kind: "고대 존재" | "딜러" | "버디";
  image: string;
  selectionImage?: string;
  voice: string;
  expressions?: Partial<Record<Expression, string>>;
};

type Situation = {
  expression: Expression;
  mood: string;
  tone: CoachTone;
  title: string;
  line: string;
};

export const ANCIENT_BEINGS: AncientBeing[] = [
  {
    id: "fab",
    name: "팹",
    role: "만드는 흐름",
    kind: "고대 존재",
    image: "/lumen/fab.png",
    selectionImage: "/lumen/selection/fab.png",
    voice: "실용적이고 무심한 제작자 말투. 거래를 고치고 맞추는 물건처럼 다룹니다.",
  },
  {
    id: "vel",
    name: "벨",
    role: "의도와 욕망",
    kind: "고대 존재",
    image: "/lumen/vel/default.png",
    selectionImage: "/lumen/selection/vel.png",
    voice: "따뜻하고 직관적이며 부드럽게 설득합니다. 서로 원하는 지점을 읽고 거래 흐름을 밀어줍니다.",
    expressions: {
      curious: "/lumen/vel/curious.png",
      thinking: "/lumen/vel/thinking.png",
      alert: "/lumen/vel/alert.png",
      success: "/lumen/vel/success.png",
      calm: "/lumen/vel/calm.png",
      surprised: "/lumen/vel/surprised.png",
      frustrated: "/lumen/vel/frustrated.png",
      confident: "/lumen/vel/confident.png",
      nearDeal: "/lumen/vel/near-deal.png",
    },
  },
  {
    id: "judge",
    name: "저지",
    role: "공정 범위",
    kind: "고대 존재",
    image: "/lumen/judge/default.png",
    selectionImage: "/lumen/selection/judge.png",
    voice: "정확하고 중립적이며 기준 중심입니다. 감정 과장 없이 공정 범위를 제시합니다.",
    expressions: {
      curious: "/lumen/judge/curious.png",
      thinking: "/lumen/judge/thinking.png",
      alert: "/lumen/judge/alert.png",
      success: "/lumen/judge/success.png",
      calm: "/lumen/judge/default.png",
      surprised: "/lumen/judge/surprised.png",
      frustrated: "/lumen/judge/frustrated.png",
      confident: "/lumen/judge/confident.png",
      nearDeal: "/lumen/judge/near-deal.png",
    },
  },
  {
    id: "hark",
    name: "하크",
    role: "규칙 감시",
    kind: "고대 존재",
    image: "/lumen/hark.png",
    selectionImage: "/lumen/selection/hark.png",
    voice: "직접적이고 신중합니다. 진행 전 확인해야 할 위험과 경계를 먼저 짚습니다.",
  },
  {
    id: "mia",
    name: "미아",
    role: "회복 판단",
    kind: "고대 존재",
    image: "/lumen/mia/default.png",
    selectionImage: "/lumen/selection/mia.png",
    voice: "차분하고 공감적이며 관계 회복을 중시합니다. 마찰을 줄이면서도 거래 기준은 지킵니다.",
    expressions: {
      curious: "/lumen/mia/curious.png",
      thinking: "/lumen/mia/thinking.png",
      alert: "/lumen/mia/alert.png",
      success: "/lumen/mia/success.png",
      calm: "/lumen/mia/default.png",
      surprised: "/lumen/mia/surprised.png",
      frustrated: "/lumen/mia/frustrated.png",
      confident: "/lumen/mia/confident.png",
      nearDeal: "/lumen/mia/near-deal.png",
    },
  },
  {
    id: "vault",
    name: "볼트",
    role: "거래 보호",
    kind: "고대 존재",
    image: "/lumen/vault.png",
    voice: "보호적이고 안정적이며 절차 중심입니다. 안전한 다음 단계를 차분히 안내합니다.",
  },
  {
    id: "dealer_kai",
    name: "카이",
    role: "정직한 초보 딜러",
    kind: "딜러",
    image: "/lumen/kai.png",
    selectionImage: "/lumen/selection/dealer-kai.png",
    voice: "생각을 입 밖으로 흘리고 질문이 많습니다. 거래를 배터리, 신호, 리셋 같은 전자기기 비유로 이해합니다.",
  },
  {
    id: "dealer_hana",
    name: "하나",
    role: "일상의 거래자",
    kind: "딜러",
    image: "/lumen/dealers/hana.png",
    selectionImage: "/lumen/selection/dealer-hana.png",
    voice: "밝고 편안합니다. 거래가 무겁지 않고 쉽게 이어지도록 말합니다.",
  },
  {
    id: "dealer_ethan",
    name: "에단",
    role: "시스템 분석가",
    kind: "딜러",
    image: "/lumen/judge.png",
    voice: "분석적이고 날카롭습니다. 가치와 근거를 짧게 정리합니다.",
  },
  {
    id: "dealer_claire",
    name: "클레어",
    role: "돌봄의 중심",
    kind: "딜러",
    image: "/lumen/mia.png",
    voice: "신중하고 안정적입니다. 상대가 편하게 진행할 수 있는지를 챙깁니다.",
  },
  {
    id: "buddy_fizz",
    name: "피즈",
    role: "Spark 버디",
    kind: "버디",
    image: "/lumen/fizz/default.png",
    selectionImage: "/lumen/fizz/default.png",
    voice: "짧고 밝은 신호처럼 반응합니다. 사용자의 판단을 대신하지 않고 옆에서 힘을 줍니다.",
    expressions: {
      curious: "/lumen/fizz/curious.png",
      thinking: "/lumen/fizz/thinking.png",
      confident: "/lumen/fizz/confident.png",
    },
  },
  {
    id: "buddy_echo",
    name: "에코",
    role: "욕망 반사 버디",
    kind: "버디",
    image: "/lumen/vel.png",
    voice: "상대와 나의 원함을 조용히 비춥니다. 말투는 부드럽고 암시는 짧습니다.",
  },
];

const HIDDEN_DEMO_SELECTOR_AGENT_IDS: AncientBeingId[] = [
  "vault",
  "dealer_ethan",
  "dealer_claire",
  "buddy_echo",
];

const SELECTABLE_DEMO_AGENTS = ANCIENT_BEINGS.filter(
  (being) => !HIDDEN_DEMO_SELECTOR_AGENT_IDS.includes(being.id),
);

const toneClass: Record<CoachTone, { shell: string; badge: string; ring: string; glow: string; orb: string }> = {
  cyan: {
    shell: "border-cyan-500/25 bg-cyan-500/5",
    badge: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",
    ring: "border-cyan-300/60",
    glow: "shadow-cyan-950/40",
    orb: "rgba(34,211,238,0.22)",
  },
  emerald: {
    shell: "border-emerald-500/25 bg-emerald-500/5",
    badge: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    ring: "border-emerald-300/60",
    glow: "shadow-emerald-950/40",
    orb: "rgba(52,211,153,0.22)",
  },
  amber: {
    shell: "border-amber-500/25 bg-amber-500/5",
    badge: "bg-amber-500/15 text-amber-200 border-amber-400/30",
    ring: "border-amber-300/60",
    glow: "shadow-amber-950/40",
    orb: "rgba(251,191,36,0.24)",
  },
  red: {
    shell: "border-red-500/25 bg-red-500/5",
    badge: "bg-red-500/15 text-red-200 border-red-400/30",
    ring: "border-red-300/60",
    glow: "shadow-red-950/40",
    orb: "rgba(248,113,113,0.26)",
  },
  violet: {
    shell: "border-violet-500/25 bg-violet-500/5",
    badge: "bg-violet-500/15 text-violet-200 border-violet-400/30",
    ring: "border-violet-300/60",
    glow: "shadow-violet-950/40",
    orb: "rgba(167,139,250,0.24)",
  },
};

const expressionClass: Record<Expression, string> = {
  curious: "saturate-125 brightness-105",
  thinking: "saturate-100 brightness-95 contrast-110",
  alert: "saturate-150 brightness-110 contrast-125",
  success: "saturate-125 brightness-125",
  calm: "saturate-90 brightness-100",
  surprised: "saturate-140 brightness-115 contrast-110",
  frustrated: "saturate-115 brightness-90 contrast-125",
  confident: "saturate-130 brightness-110 contrast-115",
  nearDeal: "saturate-125 brightness-115",
};

function parseGapPercent(value: string): number {
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSituation(round: DemoRoundResponse, previousRound?: DemoRoundResponse): Situation {
  const { decision, validation } = round.final;
  const gapPct = parseGapPercent(round.state.gap_pct);
  const tactic = decision.tactic_used.toLowerCase();
  const previousGap = previousRound?.state.gap;
  const gapClosed = previousGap !== undefined ? previousGap - round.state.gap : 0;
  const gapWidened = previousGap !== undefined ? round.state.gap - previousGap : 0;
  const progressPct = previousGap && previousGap > 0 ? gapClosed / previousGap : 0;
  const noProgress = previousGap !== undefined && Math.abs(gapClosed) < 100;
  const nearDeal = gapPct <= 4 || round.state.gap <= 4000;

  if (!validation.hard_passed) {
    return {
      expression: "alert",
      mood: "긴장",
      tone: "red",
      title: "이 제안은 안전하게 진행하기 어려워요",
      line: "가격이나 조건이 거래 보호 범위를 벗어났습니다. 무리하게 진행하지 말고 조건을 다시 확인하세요.",
    };
  }

  if (decision.action === "ACCEPT") {
    return {
      expression: "success",
      mood: "거래 성사",
      tone: "emerald",
      title: "거래가 성사됐어요",
      line: "양쪽 조건이 맞았습니다. 이제 결제와 보호 흐름을 안내하는 단계입니다.",
    };
  }

  if (round.final.phase_transition?.transitioned && round.final.phase_transition.to === "CLOSING") {
    return {
      expression: "nearDeal",
      mood: "합의 직전",
      tone: "emerald",
      title: "거의 합의에 도달했어요",
      line: "조건이 충분히 가까워졌습니다. 마지막 가격이나 보호 조건만 정리하면 됩니다.",
    };
  }

  if (validation.auto_fix_applied || validation.violations.some((v) => v.severity === "HARD")) {
    return {
      expression: "alert",
      mood: "주의",
      tone: "amber",
      title: "제안이 안전한 거래 범위 안으로 정리됐어요",
      line: "거래는 계속 진행할 수 있습니다. 다만 사용자가 보기 전에 가격이나 조건 표현을 더 안전한 범위로 다듬었습니다.",
    };
  }

  if (decision.action === "REJECT") {
    return {
      expression: "frustrated",
      mood: "불만",
      tone: "red",
      title: "멈추는 것도 좋은 거래 판단입니다",
      line: "거래가 맞지 않을 때는 억지로 성사시키지 않는 것이 신뢰를 지키는 선택입니다.",
    };
  }

  if (decision.action === "CONFIRM" || nearDeal) {
    return {
      expression: "nearDeal",
      mood: "합의 직전",
      tone: "emerald",
      title: "마지막 확인만 남았어요",
      line: "가격 차이가 거의 닫혔습니다. 이제 결제, 배송, 보호 조건을 짧게 확인하세요.",
    };
  }

  if (decision.action === "DISCOVER" || decision.action === "HOLD" || tactic.includes("relationship")) {
    return {
      expression: "curious",
      mood: "탐색",
      tone: "violet",
      title: "상대가 무엇을 원하는지 더 봐야 해요",
      line: "가격만 밀기보다 배송, 상태, 신뢰 조건을 물으면 다음 오퍼가 더 자연스러워집니다.",
    };
  }

  if (tactic.includes("time_pressure") || tactic.includes("deadline")) {
    return {
      expression: "surprised",
      mood: "놀람",
      tone: "amber",
      title: "시간 압박이 협상에 영향을 주고 있어요",
      line: "상대가 빠른 결정을 원합니다. 너무 오래 끌기보다 조건을 명확히 제시하는 편이 좋습니다.",
    };
  }

  if (progressPct >= 0.35 || gapClosed >= 7000) {
    return {
      expression: "confident",
      mood: "자신감",
      tone: "cyan",
      title: "협상이 뚜렷하게 앞으로 움직였어요",
      line: "가격 차이가 크게 줄었습니다. 지금은 합리적인 근거를 유지하면서 마무리로 밀어도 됩니다.",
    };
  }

  if (gapWidened >= 3000 || (round.round >= 3 && noProgress)) {
    return {
      expression: "frustrated",
      mood: "불만",
      tone: "red",
      title: "협상이 제자리이거나 멀어지고 있어요",
      line: "같은 가격을 반복하기보다 배송, 상태, 결제 보호 같은 다른 조건으로 돌파구를 찾아보세요.",
    };
  }

  if (gapPct >= 12 || round.state.gap > 12000) {
    return {
      expression: "thinking",
      mood: "분석",
      tone: "amber",
      title: "아직 가격 간격이 큽니다",
      line: "지금은 승부보다 기준선을 맞추는 단계입니다. 시세와 최대 지불가 사이에서 반박 근거를 보여주세요.",
    };
  }

  return {
    expression: "thinking",
    mood: "측정",
    tone: "cyan",
    title: "좋은 역제안 흐름입니다",
    line: "가격 차이가 줄고 있습니다. 사용자는 왜 이 가격이 합리적인지 짧게 이해하면 됩니다.",
  };
}

function getBeing(id: AncientBeingId): AncientBeing {
  return ANCIENT_BEINGS.find((being) => being.id === id) ?? ANCIENT_BEINGS[0];
}

function getBeingImage(being: AncientBeing, expression: Expression): string {
  return being.expressions?.[expression] ?? being.image;
}

function getSelectionImage(being: AncientBeing): string {
  return being.selectionImage ?? being.expressions?.curious ?? being.image;
}

export function AncientBeingSelector({
  selectedId,
  onSelect,
  title = "보유 에이전트",
  description = "보유한 고대 존재, 딜러, 버디 중 하나를 선택합니다.",
  defaultLabel = "기본: 벨",
  testId,
}: {
  selectedId: AncientBeingId;
  onSelect: (id: AncientBeingId) => void;
  title?: string;
  description?: string;
  defaultLabel?: string;
  testId?: string;
}) {
  const selectedBeing = getBeing(selectedId);
  const selectedImage = getSelectionImage(selectedBeing);

  return (
    <div data-testid={testId} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {description}
          </p>
        </div>
        <span className="hidden rounded-md bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-200 sm:inline-flex">
          {defaultLabel}
        </span>
      </div>
      <div className="mb-3 flex gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-slate-950 sm:h-32 sm:w-32">
          <img src={selectedImage} alt="" className="h-full w-full object-cover object-top" />
        </div>
        <div className="min-w-0 self-center">
          <span className="rounded bg-violet-500/15 px-2 py-1 text-[10px] font-semibold text-violet-100">
            선택됨
          </span>
          <p className="mt-2 text-base font-bold text-white">{selectedBeing.name}</p>
          <p className="text-xs font-semibold text-cyan-200/80">{selectedBeing.kind}</p>
          <p className="mt-1 text-sm text-slate-400">{selectedBeing.role}</p>
        </div>
      </div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        에이전트 선택
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-2">
        {SELECTABLE_DEMO_AGENTS.map((being) => {
          const selected = being.id === selectedId;
          const selectionImage = getSelectionImage(being);

          return (
            <button
              key={being.id}
              type="button"
              data-testid={testId ? `${testId}-${being.id}` : undefined}
              onClick={() => onSelect(being.id)}
              className={`min-h-24 rounded-xl border p-2.5 text-left transition-colors ${
                selected
                  ? "border-violet-300/70 bg-violet-500/15 text-white"
                  : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-white"
              }`}
              aria-pressed={selected}
            >
              <div className="flex items-center gap-3">
                <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
                  <img src={selectionImage} alt="" className="h-full w-full object-cover object-top" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold text-cyan-200/80">{being.kind}</span>
                  <span className="block truncate text-sm font-semibold">{being.name}</span>
                  <span className="block truncate text-[11px] leading-4 opacity-75">{being.role}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NegotiationAvatarCoach({
  round,
  previousRound,
  selectedId,
}: {
  round: DemoRoundResponse;
  previousRound?: DemoRoundResponse;
  selectedId: AncientBeingId;
}) {
  const being = getBeing(selectedId);
  const situation = getSituation(round, previousRound);
  const classes = toneClass[situation.tone];
  const image = getBeingImage(being, situation.expression);

  return (
    <div
      className={`overflow-hidden rounded-2xl border ${classes.shell} shadow-xl ${classes.glow}`}
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <div className="grid gap-0 md:grid-cols-[176px_1fr]">
        <div className="relative min-h-[190px] border-b border-white/10 bg-slate-950/60 md:border-b-0 md:border-r">
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 20%, ${classes.orb}, transparent 58%)`,
            }}
          />
          <img
            src={image}
            alt={`${being.name} ${situation.mood} avatar`}
            className={`absolute inset-0 h-full w-full object-contain transition-all duration-500 ${expressionClass[situation.expression]}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/10 to-transparent" />
          <div className="absolute bottom-3 left-3 right-3">
            <div className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${classes.badge}`}>
              {situation.mood}
            </div>
            <div className="mt-1 text-lg font-bold text-white">{being.name}</div>
            <div className="text-[11px] text-slate-300">{being.role}</div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${classes.badge}`}>
              My ancient
            </span>
            <span className="rounded-md bg-slate-900/70 px-2 py-1 text-[10px] font-mono text-slate-400">
              {round.final.decision.action} · {round.final.decision.tactic_used}
            </span>
          </div>

          <div className={`mb-4 border-l-2 pl-3 ${classes.ring}`}>
            <h3 className="text-sm font-semibold text-white">{situation.title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-300">{situation.line}</p>
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-slate-950/65 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold text-cyan-300">AI 구매자 메시지</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                  round.final.decision.action === "ACCEPT"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : round.final.decision.action === "REJECT"
                      ? "bg-red-500/20 text-red-300"
                      : "bg-cyan-500/20 text-cyan-300"
                }`}
              >
                {round.final.decision.action}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-white">{round.final.rendered_message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
