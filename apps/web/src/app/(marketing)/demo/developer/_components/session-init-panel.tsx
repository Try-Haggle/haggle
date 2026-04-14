"use client";

import { useState } from "react";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文" },
] as const;

type PresetName = 'lowest_price' | 'balanced' | 'safe_first' | 'custom';

const PRESETS: { key: PresetName; label: string; icon: string; desc: string }[] = [
  { key: 'lowest_price', label: '최저가', icon: '\u26A1', desc: '공격적 협상으로 최대 할인' },
  { key: 'balanced', label: '균형', icon: '\u2696\uFE0F', desc: '가격과 조건의 균형 추구' },
  { key: 'safe_first', label: '안전', icon: '\uD83D\uDEE1\uFE0F', desc: '보수적 접근, 리스크 최소화' },
];

const AVAILABLE_ADVISORS = [
  { id: 'faratin-coaching-v1', label: 'Faratin Coaching v1' },
];

interface SessionInitPanelProps {
  onInitialize: (params: {
    item: { title: string; condition: string; swappa_median: number };
    seller: { ask_price: number; floor_price: number };
    buyer_budget: { max_budget: number };
    language: string;
    preset?: string;
    custom_skills?: { advisor: string; advisor_config?: Record<string, unknown> };
  }) => void;
  loading: boolean;
}

export function SessionInitPanel({ onInitialize, loading }: SessionInitPanelProps) {
  const [title, setTitle] = useState("iPhone 15 Pro 256GB Natural Titanium");
  const [condition, setCondition] = useState("battery 92%, screen mint, T-Mobile unlocked");
  const [swappaMedian, setSwappaMedian] = useState(920);
  const [askPrice, setAskPrice] = useState(920);
  const [maxBudget, setMaxBudget] = useState(950);
  const [language, setLanguage] = useState("en");
  const [preset, setPreset] = useState<PresetName>("balanced");
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customAdvisor, setCustomAdvisor] = useState("faratin-coaching-v1");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const activePreset = customEnabled ? 'custom' as const : preset;
    onInitialize({
      item: { title, condition, swappa_median: swappaMedian },
      seller: { ask_price: askPrice, floor_price: Math.round(askPrice * 0.85) },
      buyer_budget: { max_budget: maxBudget },
      language,
      preset: activePreset,
      ...(activePreset === 'custom' ? {
        custom_skills: { advisor: customAdvisor },
      } : {}),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-700 bg-slate-800/50 p-6"
      style={{ animation: "fadeInUp 0.3s ease-out" }}
    >
      <h2 className="text-lg font-semibold text-white mb-1">
        협상 세션 초기화
      </h2>
      <p className="text-sm text-slate-400 mb-5">
        아이템 정보와 가격 파라미터를 설정하세요. Initialize 시 LLM이 구매 전략과 조건 분석을 생성합니다.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Item Name */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            아이템명
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>

        {/* Condition */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            상태 설명
          </label>
          <input
            type="text"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>

        {/* Swappa Median */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            Swappa 시장가 ($)
          </label>
          <input
            type="number"
            value={swappaMedian}
            onChange={(e) => setSwappaMedian(Number(e.target.value))}
            disabled={loading}
            min={1}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>

        {/* Seller Ask Price */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            판매자 희망가 ($)
          </label>
          <input
            type="number"
            value={askPrice}
            onChange={(e) => setAskPrice(Number(e.target.value))}
            disabled={loading}
            min={1}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>

        {/* Buyer Max Budget */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            구매자 최대 예산 ($)
          </label>
          <input
            type="number"
            value={maxBudget}
            onChange={(e) => setMaxBudget(Number(e.target.value))}
            disabled={loading}
            min={1}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
        </div>

        {/* Floor Price (computed) */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            Seller Floor (auto: 85% of ask)
          </label>
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/30 px-3 py-2 text-sm text-slate-500 font-mono">
            ${Math.round(askPrice * 0.85)}
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            Response Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
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
        <label className="block text-xs font-medium text-slate-400 mb-2">
          협상 프리셋
        </label>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={loading || customEnabled}
              onClick={() => setPreset(p.key)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                !customEnabled && preset === p.key
                  ? "border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/30"
                  : "border-slate-700 bg-slate-900/60 hover:border-slate-600"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className="text-sm font-medium text-white mb-0.5">
                {p.icon} {p.label}
              </div>
              <div className="text-xs text-slate-400">{p.desc}</div>
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
              customEnabled ? "bg-cyan-600" : "bg-slate-700"
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
          <span className="text-xs text-slate-400">
            직접 구성 (Custom)
          </span>
        </div>

        {/* Custom advisor dropdown */}
        {customEnabled && (
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Advisor Skill
            </label>
            <select
              value={customAdvisor}
              onChange={(e) => setCustomAdvisor(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
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
        className="w-full rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
