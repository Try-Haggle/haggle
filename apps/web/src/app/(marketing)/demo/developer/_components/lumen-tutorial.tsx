"use client";

import { useMemo, useState } from "react";

type TutorialStep = {
  id: string;
  label: string;
  flow: string;
  guide: string;
  role: string;
  product: string;
  line: string;
  image: string;
  imageAlt: string;
  scene: string;
  signal: string;
  output: string;
};

const tutorialSteps: TutorialStep[] = [
  {
    id: "browse",
    label: "검색",
    flow: "찾고 비교한다",
    guide: "카이 / 피즈",
    role: "초보 딜러의 시선",
    product: "첫 화면은 에그가 아니라 리스팅과 검색이다. 유저는 당근마켓처럼 사고팔 수 있고, 피즈는 선택을 방해하지 않는 작은 반응만 남긴다.",
    line: "거래는 먼저 물건을 보는 일이다. 빛은 거래가 끝난 뒤에 남는다.",
    image: "/lumen/kai.png",
    imageAlt: "카이 캐릭터 바이블 이미지",
    scene: "상단에는 검색, 필터, 추천 리스팅이 먼저 보인다. 루멘 요소는 도움말 배지나 미세한 반응으로만 존재한다.",
    signal: "피즈는 과하게 말하지 않고, 가격 비교나 안전 거래 힌트가 필요할 때만 옆에서 깜빡인다.",
    output: "리스팅 탐색, 검색 필터, 거래 시작",
  },
  {
    id: "make",
    label: "리스팅",
    flow: "물건에 형태를 준다",
    guide: "팹 / 포르자",
    role: "만드는 흐름",
    product: "판매자는 사진, 상태, 설명, 카테고리를 입력한다. 세계관 설명보다 정확한 상품 정보와 신뢰 신호가 우선이다.",
    line: "만든 것에는 형태가 필요하다. 설명하지 않으면 아무도 제대로 원할 수 없다.",
    image: "/lumen/fab.png",
    imageAlt: "팹 캐릭터 이미지",
    scene: "상품 등록 폼은 일반 마켓 UI로 유지한다. 상태 설명이 좋아질 때 카드의 신뢰도가 조금 선명해진다.",
    signal: "누락된 정보가 있으면 버디가 경고하는 대신 체크리스트가 먼저 보인다.",
    output: "상품 등록, 컨디션 명시, 카테고리 선택",
  },
  {
    id: "want",
    label: "의도",
    flow: "원하는 사람을 찾는다",
    guide: "벨 / 볼라",
    role: "원하는 흐름",
    product: "구매자 의도와 판매자 조건이 만나는 지점을 보여준다. 버디가 거래를 대신하지 않고, 사용자의 오퍼 판단을 돕는다.",
    line: "원하는 건 나쁜 게 아니다. 붙잡는 순간 흐려질 뿐이다.",
    image: "/lumen/vel.png",
    imageAlt: "벨 캐릭터 이미지",
    scene: "오퍼가 들어오면 희미한 잔상이 겹치고, 서로의 조건이 가까워질수록 잔상이 하나로 모인다.",
    signal: "관심은 밝아지지만 무리한 압박은 차가운 색으로 바뀐다.",
    output: "오퍼 확인, 구매 의도, 협상 시작",
  },
  {
    id: "measure",
    label: "측정",
    flow: "공정한 범위를 잰다",
    guide: "저지 / 리브라",
    role: "재는 흐름",
    product: "시세, 비교 거래, 최대 지불가, floor price를 투명하게 보여준다. 정답 가격이 아니라 공정 범위를 제시해서 협상을 가르친다.",
    line: "측정은 판결이 아니다. 양쪽이 같은 조건을 보는 일이다.",
    image: "/lumen/judge.png",
    imageAlt: "저지 캐릭터 이미지",
    scene: "가격 슬라이더 주변에 얇은 기준선이 생기고, 공개 데이터와 벗어난 제안은 즉시 표시된다.",
    signal: "노움의 정육면체가 안정되면 조건이 충분히 명확하다는 뜻이다.",
    output: "시세 힌트, 가격 범위, LLM 협상 전략",
  },
  {
    id: "protect",
    label: "보호",
    flow: "약속을 잠근다",
    guide: "볼트 / 테소르",
    role: "지키는 흐름",
    product: "에스크로, 결제, 배송, 자동 정산이 왜 필요한지 서사와 기능이 같이 전달된다.",
    line: "지킨다는 건 가두는 것과 다르다. 약속이 끝나면 놓아줘야 한다.",
    image: "/lumen/vault.png",
    imageAlt: "볼트 캐릭터 이미지",
    scene: "합의 가격이 잠기면 금고형 UI가 닫히고, 배송 확인 뒤에는 잠금이 천천히 풀린다.",
    signal: "크러스트가 움직이지 않으면 안전 보관 중, 일어나면 정산 준비 완료다.",
    output: "에스크로 결제, 배송 상태, 정산 release",
  },
  {
    id: "complete",
    label: "완료",
    flow: "거래를 끝낸다",
    guide: "하크와 미아",
    role: "정산과 회복",
    product: "배송 확인, 정산, 리뷰가 먼저 끝난다. 문제가 있으면 분쟁 UX로 가고, 문제가 없으면 거래 완료가 명확하게 보인다.",
    line: "규칙만으로는 아픈 사람이 남고, 이해만으로는 책임이 사라진다.",
    image: "/lumen/mia/default.png",
    imageAlt: "미아 캐릭터 이미지",
    scene: "거래 완료 화면은 지급 완료, 배송 확인, 리뷰 상태를 먼저 보여준다. 루멘 보상은 그 아래 선택 카드로만 등장한다.",
    signal: "분쟁이 없으면 피즈가 짧게 반응하고, 분쟁이 있으면 증거 타임라인과 조정 UI가 먼저 열린다.",
    output: "거래 완료, 리뷰, 정산 상태, 분쟁 진입",
  },
  {
    id: "egg",
    label: "선택 보상",
    flow: "거래가 남긴 것을 본다",
    guide: "피즈와 첫 버디",
    role: "공명의 시작",
    product: "첫 거래 완료 후에만 에그를 소개한다. 관심 없는 유저는 닫고 다음 거래로 가며, 관심 있는 유저만 열어서 버디 레이어에 들어간다.",
    line: "버디는 거래를 시작하게 만드는 이유가 아니라, 좋은 거래가 남긴 흔적이다.",
    image: "/lumen/fizz.png",
    imageAlt: "피즈 버디 이미지",
    scene: "상호 평가 뒤 '축하해요, 에그가 떨어졌어요' 카드가 나타난다. 기본 CTA는 다음 거래이고, 보조 CTA가 에그 열기다.",
    signal: "만족 거래는 따뜻한 빛으로, 무리한 거래는 불규칙한 깜빡임으로 기록된다.",
    output: "에그 드롭, 나중에 보기, 열어보기, 버디 장착",
  },
];

const flowLabels = ["검색", "리스팅", "오퍼", "측정", "결제", "완료"];

export function LumenTutorial() {
  const [activeId, setActiveId] = useState(tutorialSteps[0].id);
  const activeStep = useMemo(
    () => tutorialSteps.find((step) => step.id === activeId) ?? tutorialSteps[0],
    [activeId],
  );

  return (
    <div className="mb-10 overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-950/80 shadow-2xl shadow-cyan-950/20">
      <div className="relative min-h-[520px]">
        <img
          src="/lumen/voltland.png"
          alt="볼트랜드 루멘 배경"
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950/92 to-slate-900/82" />

        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:p-7">
          <div className="space-y-5">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                Trade-first Lumen layer
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                거래가 먼저, 루멘은 거래 뒤에 남는 레이어
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                튜토리얼의 목적은 사용자가 검색, 리스팅, 오퍼, 결제, 정산 흐름을 이해하게 만드는 것입니다.
                버디와 에그는 첫 거래가 끝난 뒤 관심 있는 유저가 더 들어가는 선택형 레이어로만 등장합니다.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {flowLabels.map((label, index) => (
                <div
                  key={label}
                  className="rounded-lg border border-slate-700/80 bg-slate-900/70 px-3 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Stage {index + 1}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tutorialSteps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveId(step.id)}
                  className={`min-h-16 rounded-xl border px-3 py-2 text-left transition-colors ${
                    step.id === activeStep.id
                      ? "border-cyan-300/70 bg-cyan-400/15 text-white"
                      : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-slate-100"
                  }`}
                >
                  <span className="block text-xs font-semibold">{step.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 opacity-80">{step.guide}</span>
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/75 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">
                  {activeStep.role}
                </span>
                <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                  {activeStep.flow}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-200">{activeStep.product}</p>
              <p className="mt-3 border-l-2 border-cyan-300/60 pl-3 text-sm italic leading-6 text-cyan-100">
                {activeStep.line}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
            <div className="grid min-h-[360px] overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/70 sm:grid-cols-[0.72fr_1fr]">
              <div className="relative min-h-[240px] border-b border-slate-800 sm:border-b-0 sm:border-r">
                <img
                  src={activeStep.image}
                  alt={activeStep.imageAlt}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                    Guide
                  </div>
                  <div className="mt-1 text-xl font-bold text-white">{activeStep.guide}</div>
                </div>
              </div>

              <div className="flex flex-col justify-between p-4 sm:p-5">
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Screen direction
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-200">{activeStep.scene}</p>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Buddy signal
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{activeStep.signal}</p>
                  </div>
                </div>

                <div className="mt-5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Product output
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{activeStep.output}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Principle
                </div>
                <div className="mt-1 text-sm font-semibold text-white">거래 우선</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">첫 화면은 에그가 아니라 리스팅과 검색이다.</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Reward
                </div>
                <div className="mt-1 text-sm font-semibold text-white">옵트인 보상</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">거래 완료 뒤에만 에그를 소개하고 열기는 선택이다.</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Rule
                </div>
                <div className="mt-1 text-sm font-semibold text-white">무관심해도 OK</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">버디를 안 써도 검색, 구매, 판매는 모두 가능하다.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
