"use client";

import { useState } from "react";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文" },
] as const;

type PresetName = "lowest_price" | "balanced" | "safe_first" | "custom";

const PRESETS: { key: PresetName; label: string; icon: string; desc: string }[] = [
  { key: "lowest_price", label: "최저가", icon: "\u26A1", desc: "공격적 협상으로 최대 할인" },
  { key: "balanced", label: "균형", icon: "\u2696\uFE0F", desc: "가격과 조건의 균형 추구" },
  {
    key: "safe_first",
    label: "안전",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "보수적 접근, 리스크 최소화",
  },
];

const AVAILABLE_ADVISORS = [{ id: "faratin-coaching-v1", label: "Faratin Coaching v1" }];

function dollarsToMinor(value: number): number {
  return Math.round(value * 100);
}

interface SessionInitPanelProps {
  onInitialize: (params: {
    item: { title: string; condition: string; swappa_median_minor: number };
    seller: { ask_price_minor: number; floor_price_minor: number };
    buyer_budget: { max_budget_minor: number };
    language: string;
    preset?: PresetName;
    custom_skills?: { advisor: string; negotiation_agent_config?: Record<string, unknown> };
  }) => void;
  loading: boolean;
}

export function SessionInitPanel({ onInitialize, loading }: SessionInitPanelProps) {
  const [title, setTitle] = useState("iPhone 15 Pro 256GB Natural Titanium");
  const [condition, setCondition] = useState("battery 92%, screen mint, T-Mobile unlocked");
  const [swappaMedian, setSwappaMedian] = useState(920);
  const [askPrice, setAskPrice] = useState(920);
  const [maxBudget, setMaxBudget] = useState(950);
  const [language, setLanguage] = useState("ko");
  const [preset, setPreset] = useState<PresetName>("balanced");
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customAdvisor, setCustomAdvisor] = useState("faratin-coaching-v1");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const activePreset = customEnabled ? ("custom" as const) : preset;
    onInitialize({
      item: { title, condition, swappa_median_minor: dollarsToMinor(swappaMedian) },
      seller: {
        ask_price_minor: dollarsToMinor(askPrice),
        floor_price_minor: dollarsToMinor(Math.round(askPrice * 0.85)),
      },
      buyer_budget: { max_budget_minor: dollarsToMinor(maxBudget) },
      language,
      preset: activePreset,
      ...(activePreset === "custom"
        ? {
            custom_skills: { advisor: customAdvisor },
          }
        : {}),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-surface-raised p-6"
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <h2 className="text-lg font-semibold text-ink mb-1">협상 세션 초기화</h2>
      <p className="text-sm text-ink-secondary mb-5">
        아이템 정보와 가격 파라미터를 설정하세요. Initialize 시 LLM이 구매 전략과 조건 분석을
        생성합니다.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Item Name */}
        <div className="sm:col-span-2">
          <label
            htmlFor="init-title"
            className="block text-xs font-medium text-ink-secondary mb-1.5"
          >
            아이템명
          </label>
          <input
            id="init-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>

        {/* Condition */}
        <div className="sm:col-span-2">
          <label
            htmlFor="init-condition"
            className="block text-xs font-medium text-ink-secondary mb-1.5"
          >
            상태 설명
          </label>
          <input
            id="init-condition"
            type="text"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>

        {/* Swappa Median */}
        <div>
          <label
            htmlFor="init-swappa"
            className="block text-xs font-medium text-ink-secondary mb-1.5"
          >
            Swappa 시장가 ($)
          </label>
          <input
            id="init-swappa"
            type="number"
            value={swappaMedian}
            onChange={(e) => setSwappaMedian(Number(e.target.value))}
            disabled={loading}
            min={1}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink font-mono placeholder-ink-muted focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>

        {/* Seller Ask Price */}
        <div>
          <label htmlFor="init-ask" className="block text-xs font-medium text-ink-secondary mb-1.5">
            판매자 희망가 ($)
          </label>
          <input
            id="init-ask"
            type="number"
            value={askPrice}
            onChange={(e) => setAskPrice(Number(e.target.value))}
            disabled={loading}
            min={1}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink font-mono placeholder-ink-muted focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>

        {/* Buyer Max Budget */}
        <div>
          <label
            htmlFor="init-budget"
            className="block text-xs font-medium text-ink-secondary mb-1.5"
          >
            구매자 최대 예산 ($)
          </label>
          <input
            id="init-budget"
            type="number"
            value={maxBudget}
            onChange={(e) => setMaxBudget(Number(e.target.value))}
            disabled={loading}
            min={1}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink font-mono placeholder-ink-muted focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          />
        </div>

        {/* Floor Price (computed) */}
        <div>
          <label
            htmlFor="init-floor"
            className="block text-xs font-medium text-ink-secondary mb-1.5"
          >
            Seller Floor (auto: 85% of ask)
          </label>
          <div
            id="init-floor"
            className="rounded-lg border border-line-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted font-mono"
          >
            ${Math.round(askPrice * 0.85)}
          </div>
        </div>

        {/* Language */}
        <div>
          <label
            htmlFor="init-language"
            className="block text-xs font-medium text-ink-secondary mb-1.5"
          >
            Response Language
          </label>
          <select
            id="init-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preset Selection */}
      <div className="mb-5">
        <span className="block text-xs font-medium text-ink-secondary mb-2">협상 프리셋</span>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={loading || customEnabled}
              onClick={() => setPreset(p.key)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                !customEnabled && preset === p.key
                  ? "border-action-primary bg-action-primary/10 ring-1 ring-action-primary/30"
                  : "border-line bg-surface-overlay hover:border-line-strong"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className="text-sm font-medium text-ink mb-0.5">
                {p.icon} {p.label}
              </div>
              <div className="text-xs text-ink-secondary">{p.desc}</div>
            </button>
          ))}
        </div>

        {/* Custom toggle */}
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => setCustomEnabled(!customEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              customEnabled ? "bg-action-primary" : "bg-surface-sunken"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            role="switch"
            aria-checked={customEnabled}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                customEnabled ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-xs text-ink-secondary">직접 구성 (Custom)</span>
        </div>

        {/* Custom advisor dropdown */}
        {customEnabled && (
          <div>
            <label
              htmlFor="init-advisor"
              className="block text-xs font-medium text-ink-secondary mb-1.5"
            >
              Advisor Skill
            </label>
            <select
              id="init-advisor"
              value={customAdvisor}
              onChange={(e) => setCustomAdvisor(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm text-ink focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus/30 disabled:opacity-50"
            >
              {AVAILABLE_ADVISORS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-cta px-6 py-3 text-sm font-semibold text-on-cta hover:bg-cta-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <svg
              className="animate-spin h-4 w-4 text-on-accent"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            파이프라인 초기화 중... (LLM 호출 2회)
          </>
        ) : (
          "세션 초기화 (Stage 0a + 0b 실행)"
        )}
      </button>
    </form>
  );
}
