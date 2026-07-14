"use client";

import { useEffect, useMemo, useState } from "react";
import {
  compilePresetTuningDraft,
  getNegotiationAgentPresets,
  type NegotiationAgentPresetId,
  type NegotiationAgentPresetSummary,
  type PresetLeverageDraft,
  type PresetTermDraft,
  type PresetTuningDraft,
  type PresetWalkAwayDraft,
  type StoredMemoryCard,
  savePresetTuningCandidate,
} from "@/lib/intelligence-demo-api";
import type {
  AdvisorListing,
  NegotiationAgentBuilderMemory,
} from "@/lib/negotiation-agent-builder-types";

type Props = {
  userId: string;
  agentId?: string;
  listing: AdvisorListing | null;
  memory: NegotiationAgentBuilderMemory;
  storedCards?: StoredMemoryCard[];
  onDraftChange?: (draft: PresetTuningDraft | null) => void;
  onCandidateSaved?: (cards: StoredMemoryCard[], summary: string) => void;
};

type TunedPresetCandidate = {
  key: string;
  memoryKey: string;
  summary: string;
  score: number;
  strength: number;
  reason: string;
  presetId: NegotiationAgentPresetId;
  priceCapMinor?: number;
  openingOfferMinor?: number;
  checkedTermIds: Set<string>;
  confirmedTermValues: Map<string, PresetTermDraft["confirmedValue"]>;
  enabledLeverageTermIds: Set<string>;
  enabledWalkAwayIds: Set<string>;
};

type EngineNextAction = NonNullable<PresetTuningDraft["engineReview"]>["nextActions"][number];
type EngineActionValue = string | number | boolean;

const AUTO_APPLY_CANDIDATE_SCORE = 88;

function formatMinor(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}

function dollarsToMinor(value: number): number {
  return Math.round(value * 100);
}

function minorToDollars(value: number): number {
  return Math.round(value / 100);
}

function sourceClass(source: string): string {
  // Categorical source palette kept distinct per PRESERVE rule:
  // memory -> success, tag -> info, preset -> kept violet literal to stay
  // visually distinct from tag (info). default -> neutral surface tokens.
  switch (source) {
    case "memory":
      return "border-success/20 bg-success/10 text-success";
    case "tag":
      return "border-info/20 bg-info/10 text-info";
    case "preset":
      return "border-violet-500/20 bg-violet-500/10 text-violet-100";
    default:
      return "border-line bg-surface-sunken text-ink-secondary";
  }
}

function enforcementClass(enforcement: string): string {
  switch (enforcement) {
    case "deal_breaker":
      return "border-error/25 bg-error/10 text-error";
    case "hard":
      return "border-warning/25 bg-warning/10 text-warning";
    default:
      return "border-line bg-surface-sunken text-ink-secondary";
  }
}

function engineReviewClass(status: string): string {
  switch (status) {
    case "ready":
      return "border-success/20 bg-success/10 text-success";
    case "blocked":
      return "border-error/20 bg-error/10 text-error";
    default:
      return "border-warning/20 bg-warning/10 text-warning";
  }
}

function engineActionKey(action: EngineNextAction): string {
  return `${action.termId ?? action.label}:${action.control}`;
}

function defaultEngineActionValue(action: EngineNextAction): EngineActionValue {
  const value = action.controlConfig?.defaultValue;
  if (value !== undefined) return value;
  if (action.control === "toggle") return true;
  if (action.control === "slider") return action.controlConfig?.min ?? 0;
  if (action.control === "select") return action.controlConfig?.options?.[0]?.value ?? "";
  return "";
}

function engineActionValueText(action: EngineNextAction, value: EngineActionValue): string {
  if (action.control === "toggle") {
    return value ? "confirmed" : "not confirmed";
  }
  const option = action.controlConfig?.options?.find((item) => item.value === String(value));
  const label = option?.label ?? String(value);
  return action.controlConfig?.unit && !label.includes(action.controlConfig.unit)
    ? `${label}${action.controlConfig.unit}`
    : label;
}

function confirmedValueFromAction(
  action: EngineNextAction,
  value: EngineActionValue,
): PresetTermDraft["confirmedValue"] {
  return {
    value,
    label: engineActionValueText(action, value),
    unit: action.controlConfig?.unit,
    source: "user",
  };
}

function applyConfirmedValueFromCandidate(
  term: PresetTermDraft,
  candidateValue: PresetTermDraft["confirmedValue"],
): PresetTermDraft["confirmedValue"] {
  if (!candidateValue) return term.confirmedValue;
  if (
    term.confirmedValue?.source === "listing" &&
    String(term.confirmedValue.value) !== String(candidateValue.value)
  ) {
    return term.confirmedValue;
  }
  return candidateValue;
}

function confirmedValueConflictNotes(
  draft: PresetTuningDraft,
  candidate: TunedPresetCandidate,
): string[] {
  return draft.mustVerify.flatMap((term) => {
    const candidateValue = candidate.confirmedTermValues.get(term.termId);
    if (
      !candidateValue ||
      term.confirmedValue?.source !== "listing" ||
      String(term.confirmedValue.value) === String(candidateValue.value)
    ) {
      return [];
    }
    return [
      `Saved preset value skipped: ${term.label} saved ${candidateValue.label ?? candidateValue.value}, listing says ${term.confirmedValue.label ?? term.confirmedValue.value}.`,
    ];
  });
}

function patchDraft(
  draft: PresetTuningDraft,
  patch: Partial<PresetTuningDraft>,
): PresetTuningDraft {
  const mustVerify = patch.mustVerify ?? draft.mustVerify;
  const engineReview = patch.engineReview ?? reconcileEngineReview(draft, mustVerify);
  return {
    ...draft,
    ...patch,
    maxAgreementMinor: patch.priceCapMinor ?? draft.priceCapMinor,
    mustVerify,
    engineReview,
    negotiationStartPayload: {
      ...draft.negotiationStartPayload,
      price_cap_minor: patch.priceCapMinor ?? draft.priceCapMinor,
      opening_offer_minor: patch.openingOfferMinor ?? draft.openingOfferMinor,
      applied_tuned_candidate: patch.appliedTunedCandidate ?? draft.appliedTunedCandidate,
      tuning_draft: {
        ...(draft.negotiationStartPayload.tuning_draft as Record<string, unknown>),
        must_verify: mustVerify,
        leverage: patch.leverage ?? draft.leverage,
        walk_away: patch.walkAway ?? draft.walkAway,
        engine_review: engineReview,
      },
    },
  };
}

function reconcileEngineReview(
  draft: PresetTuningDraft,
  mustVerify: PresetTermDraft[],
): PresetTuningDraft["engineReview"] {
  if (!draft.engineReview) return undefined;
  const checkedHardTermIds = new Set(
    mustVerify
      .filter((term) => term.checked && term.enforcement !== "soft")
      .map((term) => term.termId),
  );
  const blockers = draft.engineReview.blockers.filter((blocker) => {
    if (!blocker.id.startsWith("missing_")) return true;
    return !checkedHardTermIds.has(blocker.id.replace(/^missing_/, ""));
  });
  const nextActions = draft.engineReview.nextActions.filter(
    (action) => !action.termId || !checkedHardTermIds.has(action.termId),
  );
  const status = blockers.some((blocker) => blocker.id === "product_scope_conflict")
    ? "blocked"
    : blockers.length > 0
      ? "needs_user_input"
      : "ready";
  return {
    ...draft.engineReview,
    status,
    blockers,
    nextActions,
    branches: draft.engineReview.branches.map((branch) =>
      branch.id === "required_terms"
        ? {
            ...branch,
            outcome: blockers.some((blocker) => blocker.id.startsWith("missing_"))
              ? "ask_user"
              : "continue",
            reason: blockers.some((blocker) => blocker.id.startsWith("missing_"))
              ? branch.reason
              : "Hard terms have usable listing evidence or user confirmation.",
          }
        : branch,
    ),
  };
}

function resolveScopeConflict(
  draft: PresetTuningDraft,
  applyCurrentListing = true,
): PresetTuningDraft {
  if (!draft.engineReview) return draft;
  const engineReview = draft.engineReview;
  const blockers = engineReview.blockers.filter(
    (blocker) => blocker.id !== "product_scope_conflict",
  );
  const nextActions = engineReview.nextActions.filter(
    (action) => action.label !== "Confirm product scope",
  );
  const hasMissingHardTerms = blockers.some((blocker) => blocker.id.startsWith("missing_"));
  const status = blockers.length > 0 ? "needs_user_input" : "ready";

  return patchDraft(draft, {
    engineReview: {
      ...engineReview,
      status,
      blockers,
      nextActions,
      branches: engineReview.branches.map((branch) => {
        if (branch.id === "context_scope") {
          return {
            ...branch,
            outcome: "continue",
            reason: applyCurrentListing
              ? "User explicitly applied the saved preference to the current listing scope."
              : "User kept the saved preference separate from this listing scope.",
          };
        }
        if (branch.id === "payment_permission") {
          return {
            ...branch,
            outcome: hasMissingHardTerms ? "ask_user" : "continue",
            reason: hasMissingHardTerms
              ? "Required terms still need confirmation before payment permission."
              : "Draft can be converted into an AgentPaymentGrant after user confirmation.",
          };
        }
        return branch;
      }),
    },
  });
}

export function PresetTuningPanel({
  userId,
  agentId,
  listing,
  memory,
  storedCards = [],
  onDraftChange,
  onCandidateSaved,
}: Props) {
  const [presets, setPresets] = useState<NegotiationAgentPresetSummary[]>([]);
  const [presetId, setPresetId] = useState<NegotiationAgentPresetId | undefined>(undefined);
  const [priceCapInput, setPriceCapInput] = useState("");
  const [manualPreset, setManualPreset] = useState(false);
  const [manualPriceCap, setManualPriceCap] = useState(false);
  const [userEditedDraft, setUserEditedDraft] = useState(false);
  const [pendingCandidate, setPendingCandidate] = useState<TunedPresetCandidate | null>(null);
  const [appliedCandidateKey, setAppliedCandidateKey] = useState<string | null>(null);
  const [autoAppliedCandidateKey, setAutoAppliedCandidateKey] = useState<string | null>(null);
  const [actionValues, setActionValues] = useState<Record<string, EngineActionValue>>({});
  const [draft, setDraft] = useState<PresetTuningDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNegotiationAgentPresets()
      .then((response) => {
        if (!cancelled) setPresets(response.presets);
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tunedCandidates = useMemo(
    () => (listing ? extractTunedPresetCandidates(storedCards, listing).slice(0, 3) : []),
    [listing, storedCards],
  );
  const bestTunedCandidate = tunedCandidates[0] ?? null;

  useEffect(() => {
    if (!listing) {
      setDraft(null);
      setStatus("idle");
      setAppliedCandidateKey(null);
      setAutoAppliedCandidateKey(null);
      setPendingCandidate(null);
      setActionValues({});
      setManualPreset(false);
      setManualPriceCap(false);
      setUserEditedDraft(false);
      onDraftChange?.(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);
    setSavedSummary(null);

    const priceCapMinor = priceCapInput.trim() ? dollarsToMinor(Number(priceCapInput)) : undefined;
    const validPriceCapMinor =
      priceCapMinor && Number.isFinite(priceCapMinor) && priceCapMinor > 0
        ? priceCapMinor
        : undefined;

    compilePresetTuningDraft({
      listing,
      memory,
      presetId,
      priceCapMinor: validPriceCapMinor,
    })
      .then((response) => {
        if (cancelled) return;
        const autoCandidate =
          bestTunedCandidate &&
          shouldAutoApplyCandidate(bestTunedCandidate, {
            manualPreset,
            manualPriceCap,
            userEditedDraft,
            appliedCandidateKey,
            autoAppliedCandidateKey,
          })
            ? bestTunedCandidate
            : null;
        const retainedAutoCandidate =
          bestTunedCandidate &&
          autoAppliedCandidateKey === bestTunedCandidate.key &&
          !manualPreset &&
          !manualPriceCap &&
          !userEditedDraft
            ? bestTunedCandidate
            : null;
        const candidateForDraft = autoCandidate ?? retainedAutoCandidate;

        if (autoCandidate && autoCandidate.presetId !== response.draft.presetId) {
          setPresetId(autoCandidate.presetId);
          if (autoCandidate.priceCapMinor) {
            setPriceCapInput(String(minorToDollars(autoCandidate.priceCapMinor)));
          }
          setPendingCandidate(autoCandidate);
          setAutoAppliedCandidateKey(autoCandidate.key);
          setStatus("ready");
          return;
        }

        const nextDraft = candidateForDraft
          ? applyCandidateToDraft(response.draft, candidateForDraft, "auto")
          : response.draft;
        setDraft(nextDraft);
        setPresetId((current) => current ?? nextDraft.presetId);
        if (candidateForDraft?.priceCapMinor) {
          setPriceCapInput(String(minorToDollars(candidateForDraft.priceCapMinor)));
        }
        if (!manualPriceCap && !priceCapInput.trim()) {
          setPriceCapInput(String(minorToDollars(nextDraft.priceCapMinor)));
        }
        if (candidateForDraft) {
          setAppliedCandidateKey(candidateForDraft.key);
          setAutoAppliedCandidateKey(candidateForDraft.key);
        }
        setStatus("ready");
        onDraftChange?.(nextDraft);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Preset draft를 만들지 못했습니다.");
        setDraft(null);
        onDraftChange?.(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    appliedCandidateKey,
    autoAppliedCandidateKey,
    bestTunedCandidate,
    listing,
    manualPreset,
    manualPriceCap,
    memory,
    onDraftChange,
    presetId,
    priceCapInput,
    userEditedDraft,
  ]);

  useEffect(() => {
    if (!draft || !pendingCandidate) return;
    if (draft.presetId !== pendingCandidate.presetId) return;
    if (pendingCandidate.priceCapMinor && draft.priceCapMinor !== pendingCandidate.priceCapMinor)
      return;
    const next = applyCandidateToDraft(draft, pendingCandidate);
    setDraft(next);
    setAppliedCandidateKey(pendingCandidate.key);
    setPendingCandidate(null);
    onDraftChange?.(next);
  }, [draft, onDraftChange, pendingCandidate]);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === (presetId ?? draft?.presetId)),
    [draft?.presetId, presetId, presets],
  );

  function applyLocal(next: PresetTuningDraft) {
    setDraft(next);
    setUserEditedDraft(true);
    setAutoAppliedCandidateKey(null);
    setSavedSummary(null);
    onDraftChange?.(next);
  }

  function applyTunedCandidate(candidate: TunedPresetCandidate) {
    setManualPreset(true);
    setAutoAppliedCandidateKey(null);
    setPresetId(candidate.presetId);
    if (candidate.priceCapMinor) {
      setManualPriceCap(true);
      setPriceCapInput(String(minorToDollars(candidate.priceCapMinor)));
    }
    setPendingCandidate(candidate);
    setSavedSummary(null);
  }

  async function saveCandidate() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await savePresetTuningCandidate({
        userId,
        agentId,
        draft,
      });
      setSavedSummary(response.candidate.summary);
      onCandidateSaved?.(response.memory_cards, response.candidate.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "User-tuned preset 후보 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function toggleTerm(term: PresetTermDraft) {
    if (!draft) return;
    applyLocal(
      patchDraft(draft, {
        mustVerify: draft.mustVerify.map((item) =>
          item.termId === term.termId ? { ...item, checked: !item.checked } : item,
        ),
      }),
    );
  }

  function toggleLeverage(leverage: PresetLeverageDraft) {
    if (!draft) return;
    applyLocal(
      patchDraft(draft, {
        leverage: draft.leverage.map((item) =>
          item.termId === leverage.termId && item.label === leverage.label
            ? { ...item, enabled: !item.enabled }
            : item,
        ),
      }),
    );
  }

  function toggleWalkAway(rule: PresetWalkAwayDraft) {
    if (!draft) return;
    applyLocal(
      patchDraft(draft, {
        walkAway: draft.walkAway.map((item) =>
          item.id === rule.id ? { ...item, enabled: !item.enabled } : item,
        ),
      }),
    );
  }

  function handleResolveNextAction(
    action: NonNullable<PresetTuningDraft["engineReview"]>["nextActions"][number],
  ) {
    if (!draft) return;
    const value = actionValues[engineActionKey(action)] ?? defaultEngineActionValue(action);
    if (action.label === "Confirm product scope") {
      applyLocal(resolveScopeConflict(draft, value !== "keep_saved_only"));
      return;
    }
    if (!action.termId) return;
    const hasMatchingTerm = draft.mustVerify.some((term) => term.termId === action.termId);
    if (!hasMatchingTerm) return;
    const answer = engineActionValueText(action, value);
    applyLocal(
      patchDraft(draft, {
        mustVerify: draft.mustVerify.map((term) =>
          term.termId === action.termId
            ? {
                ...term,
                checked: true,
                rationale: `${term.rationale} User confirmed: ${answer}.`,
                confirmedValue: confirmedValueFromAction(action, value),
              }
            : term,
        ),
      }),
    );
  }

  function setEngineActionValue(action: EngineNextAction, value: EngineActionValue) {
    setActionValues((current) => ({
      ...current,
      [engineActionKey(action)]: value,
    }));
  }

  if (!listing) {
    return (
      <div className="rounded-xl border border-line bg-surface-sunken p-3 text-xs leading-5 text-ink-muted">
        상품을 선택하면 프리셋 모델과 tag term 기반 협상 초안이 여기에 표시됩니다.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-info/20 bg-info-soft p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-info">
            Preset Tuning Draft
          </p>
          <p className="mt-1 text-xs text-ink-secondary">
            상품, 메모리, 가격 cap, tag term을 합쳐 협상 시작 payload를 만듭니다.
          </p>
        </div>
        <span className="font-mono text-[10px] text-ink-muted">{status}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-ink-secondary">
          Preset
          <select
            value={presetId ?? draft?.presetId ?? ""}
            onChange={(event) => {
              setManualPreset(true);
              setAutoAppliedCandidateKey(null);
              setPresetId(event.target.value as NegotiationAgentPresetId);
            }}
            className="rounded-lg border border-line bg-surface-overlay px-2 py-2 text-xs text-ink outline-none focus:border-focus"
          >
            {draft && !presetId && <option value={draft.presetId}>{draft.presetLabel}</option>}
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-ink-secondary">
          Price cap
          <input
            value={priceCapInput}
            inputMode="numeric"
            onChange={(event) => {
              setManualPriceCap(true);
              setAutoAppliedCandidateKey(null);
              setPriceCapInput(event.target.value.replace(/[^\d.]/g, ""));
            }}
            className="rounded-lg border border-line bg-surface-overlay px-2 py-2 text-xs text-ink outline-none focus:border-focus"
            placeholder="450"
          />
        </label>
      </div>

      {bestTunedCandidate && (
        <div className="mt-3 rounded-lg border border-success/20 bg-success/10 p-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-success">추천 user-tuned preset</p>
              <p className="mt-1 text-[11px] leading-5 text-success/80">
                {bestTunedCandidate.summary}
              </p>
              <p className="mt-1 text-[10px] text-success/70">
                score {bestTunedCandidate.score} · {bestTunedCandidate.reason}
              </p>
              {autoAppliedCandidateKey === bestTunedCandidate.key && (
                <p className="mt-1 text-[10px] font-semibold text-success">
                  높은 신뢰도로 기본 draft에 자동 적용되었습니다. 직접 수정하면 이후 자동 덮어쓰기는
                  멈춥니다.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => applyTunedCandidate(bestTunedCandidate)}
              className="shrink-0 rounded-md bg-success px-2 py-1.5 text-[11px] font-semibold text-on-accent transition-colors hover:bg-success/90"
            >
              {autoAppliedCandidateKey === bestTunedCandidate.key
                ? "자동 적용됨"
                : appliedCandidateKey === bestTunedCandidate.key
                  ? "적용됨"
                  : "적용"}
            </button>
          </div>
          {tunedCandidates.length > 1 && (
            <p className="mt-2 text-[10px] text-success/60">
              다른 후보 {tunedCandidates.length - 1}개도 저장되어 있습니다. 현재 상품과 가장 가까운
              후보를 먼저 보여줍니다.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-error/20 bg-error/10 p-2 text-xs text-error">
          {error}
        </p>
      )}

      {draft && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-surface-sunken p-2">
              <span className="text-ink-muted">opening</span>
              <input
                value={minorToDollars(draft.openingOfferMinor)}
                inputMode="numeric"
                onChange={(event) => {
                  const next = dollarsToMinor(Number(event.target.value));
                  if (Number.isFinite(next))
                    applyLocal(patchDraft(draft, { openingOfferMinor: next }));
                }}
                className="mt-1 w-full rounded border border-line bg-surface-overlay px-2 py-1 font-mono font-semibold text-action-primary outline-none focus:border-focus"
              />
            </div>
            <div className="rounded-lg bg-surface-sunken p-2">
              <span className="text-ink-muted">cap</span>
              <p className="font-mono font-semibold text-warning">
                {formatMinor(draft.priceCapMinor)}
              </p>
            </div>
            <div className="rounded-lg bg-surface-sunken p-2">
              <span className="text-ink-muted">style</span>
              <p className="font-semibold text-ink">
                {draft.concessionSpeed} · {draft.riskTolerance}
              </p>
            </div>
          </div>

          {selectedPreset && (
            <div className="rounded-lg border border-info/20 bg-surface-sunken p-2">
              <p className="text-xs font-semibold text-info">{selectedPreset.label}</p>
              <ul className="mt-1 space-y-1 text-[11px] leading-5 text-ink-secondary">
                {selectedPreset.notes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.appliedTunedCandidate && (
            <div className="rounded-lg border border-action-primary/20 bg-action-primary/10 p-2">
              <p className="text-xs font-semibold text-action-primary">
                Applied tuned preset · {draft.appliedTunedCandidate.applicationMode}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-action-primary/75">
                {draft.appliedTunedCandidate.reason}
              </p>
              {draft.strategyNotes.filter((note) => note.startsWith("Saved preset value skipped:"))
                .length > 0 && (
                <ul className="mt-1 space-y-1 text-[10px] leading-4 text-action-primary/80">
                  {draft.strategyNotes
                    .filter((note) => note.startsWith("Saved preset value skipped:"))
                    .map((note) => (
                      <li key={note}>• {note.replace("Saved preset value skipped: ", "")}</li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {draft.engineReview && (
            <div
              className={`rounded-lg border p-2 ${engineReviewClass(draft.engineReview.status)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Engine cycle review</p>
                  <p className="mt-1 text-[11px] leading-5 opacity-80">
                    디자인 → 설계 → 구현 → 리뷰 사이클 기준으로 현재 draft 상태를 검사합니다.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 font-mono text-[10px]">
                  {draft.engineReview.status}
                </span>
              </div>
              {draft.engineReview.branches.length > 0 && (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                  {draft.engineReview.branches.map((branch) => (
                    <div
                      key={branch.id}
                      className="rounded-md border border-current/15 bg-surface-sunken p-2"
                    >
                      <p className="text-[11px] font-semibold">
                        {branch.label} · {branch.outcome}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 opacity-75">{branch.reason}</p>
                    </div>
                  ))}
                </div>
              )}
              {draft.engineReview.nextActions.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">
                    Next controls
                  </p>
                  {draft.engineReview.nextActions.slice(0, 4).map((action) => {
                    const actionKey = engineActionKey(action);
                    const value = actionValues[actionKey] ?? defaultEngineActionValue(action);
                    return (
                      <div
                        key={actionKey}
                        className="rounded-md bg-surface-sunken px-2 py-1.5 text-[11px] leading-4"
                      >
                        <span className="font-semibold">{action.control}</span> · {action.question}
                        {action.control === "slider" && (
                          <label className="mt-2 grid gap-1">
                            <div className="flex items-center justify-between font-mono text-[10px] opacity-80">
                              <span>
                                {action.controlConfig?.min ?? 0}
                                {action.controlConfig?.unit ?? ""}
                              </span>
                              <span>{engineActionValueText(action, value)}</span>
                              <span>
                                {action.controlConfig?.max ?? 100}
                                {action.controlConfig?.unit ?? ""}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={action.controlConfig?.min ?? 0}
                              max={action.controlConfig?.max ?? 100}
                              step={action.controlConfig?.step ?? 1}
                              value={Number(value)}
                              onChange={(event) =>
                                setEngineActionValue(action, Number(event.target.value))
                              }
                              className="w-full accent-action-primary"
                            />
                          </label>
                        )}
                        {action.control === "toggle" && (
                          <label className="mt-2 flex items-center gap-2 text-[10px] font-semibold">
                            <input
                              type="checkbox"
                              checked={Boolean(value)}
                              onChange={(event) =>
                                setEngineActionValue(action, event.target.checked)
                              }
                              className="size-3 accent-action-primary"
                            />
                            {value ? "확인됨" : "아직 확인 안 됨"}
                          </label>
                        )}
                        {action.control === "select" && action.controlConfig?.options?.length && (
                          <select
                            value={String(value)}
                            onChange={(event) => setEngineActionValue(action, event.target.value)}
                            className="mt-2 w-full rounded-md border border-current/20 bg-surface-overlay px-2 py-1 text-[10px] outline-none"
                          >
                            {action.controlConfig.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {action.control === "text" && (
                          <input
                            value={String(value)}
                            onChange={(event) => setEngineActionValue(action, event.target.value)}
                            className="mt-2 w-full rounded-md border border-current/20 bg-surface-overlay px-2 py-1 text-[10px] outline-none"
                            placeholder={action.controlConfig?.placeholder ?? "값 입력"}
                          />
                        )}
                        {(action.label === "Confirm product scope" || action.termId) && (
                          <button
                            type="button"
                            onClick={() => handleResolveNextAction(action)}
                            className="mt-1.5 block rounded-md border border-current/25 px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-white/10"
                          >
                            {action.label === "Confirm product scope"
                              ? "현재 상품에 적용"
                              : "값 적용하고 재리뷰"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-secondary">
              Required checks
            </p>
            {draft.mustVerify.map((term) => (
              <button
                key={term.termId}
                type="button"
                onClick={() => toggleTerm(term)}
                className="w-full rounded-lg border border-line bg-surface-sunken p-2 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-ink">
                      <span className={term.checked ? "text-success" : "text-ink-muted"}>
                        {term.checked ? "✓" : "□"}
                      </span>{" "}
                      {term.label}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-ink-muted">{term.rationale}</p>
                    {term.confirmedValue && (
                      <p className="mt-1 inline-flex rounded border border-success/20 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] text-success">
                        {term.confirmedValue.label ?? String(term.confirmedValue.value)}
                        {term.confirmedValue.unit &&
                        !String(term.confirmedValue.label ?? term.confirmedValue.value).includes(
                          term.confirmedValue.unit,
                        )
                          ? term.confirmedValue.unit
                          : ""}{" "}
                        · {term.confirmedValue.source}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${enforcementClass(term.enforcement)}`}
                  >
                    {term.enforcement}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {draft.leverage.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-secondary">
                Leverage chips
              </p>
              {draft.leverage.map((item) => (
                <button
                  key={`${item.termId}-${item.label}`}
                  type="button"
                  onClick={() => toggleLeverage(item)}
                  className={`w-full rounded-lg border p-2 text-left text-xs ${
                    item.enabled
                      ? "border-success/20 bg-success/10 text-success"
                      : "border-line bg-surface-sunken text-ink-secondary"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {item.enabled ? "✓" : "□"} {item.label}
                    </span>
                    <span className="font-mono">-{formatMinor(item.priceImpactMinor)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 opacity-80">{item.reason}</p>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-secondary">
              Walk-away rules
            </p>
            {draft.walkAway.map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => toggleWalkAway(rule)}
                className={`w-full rounded-lg border p-2 text-left text-xs ${
                  rule.enabled
                    ? "border-error/20 bg-error/10 text-error"
                    : "border-line bg-surface-sunken text-ink-secondary"
                }`}
              >
                <p className="font-semibold">
                  {rule.enabled ? "✓" : "□"} {rule.label}
                </p>
                <p className="mt-1 text-[11px] leading-5 opacity-80">{rule.reason}</p>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {draft.sourceBadges.map((source) => (
              <span
                key={source}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${sourceClass(source)}`}
              >
                {source}
              </span>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void saveCandidate()}
            disabled={saving}
            className="w-full rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info transition-colors hover:border-info hover:bg-info/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "user-tuned preset 저장 중" : "이 조정을 user-tuned preset 후보로 저장"}
          </button>
          {savedSummary && (
            <p className="rounded-lg border border-success/20 bg-success/10 p-2 text-xs leading-5 text-success">
              저장됨: {savedSummary}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function extractTunedPresetCandidates(
  cards: StoredMemoryCard[],
  listing: AdvisorListing,
): TunedPresetCandidate[] {
  return cards
    .map((card) => candidateFromCard(card, listing))
    .filter((candidate): candidate is TunedPresetCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || a.summary.localeCompare(b.summary));
}

function candidateFromCard(
  card: StoredMemoryCard,
  listing: AdvisorListing,
): TunedPresetCandidate | null {
  if (!card.memory_key.startsWith("advisor:preset_tuning:")) return null;
  const memory = card.memory ?? {};
  const presetId = presetIdFromUnknown(memory.presetId);
  if (!presetId) return null;

  const strength = strengthFromCard(card);
  const scoreResult = scorePresetCandidate(memory, listing, strength);
  if (scoreResult.score <= 0) return null;

  return {
    key: `${card.id}:${card.version}:${card.updated_at}`,
    memoryKey: card.memory_key,
    summary: card.summary,
    score: scoreResult.score,
    strength,
    reason: scoreResult.reason,
    presetId,
    priceCapMinor: numberFromUnknown(memory.priceCapMinor),
    openingOfferMinor: numberFromUnknown(memory.openingOfferMinor),
    checkedTermIds: new Set(
      arrayFromUnknown(memory.checkedTerms)
        .map((item) => stringProp(item, "termId"))
        .filter(Boolean),
    ),
    confirmedTermValues: confirmedTermValuesFromUnknown(memory.checkedTerms),
    enabledLeverageTermIds: new Set(
      arrayFromUnknown(memory.leverage)
        .map((item) => stringProp(item, "termId"))
        .filter(Boolean),
    ),
    enabledWalkAwayIds: new Set(
      arrayFromUnknown(memory.walkAway)
        .map((item) => stringProp(item, "id"))
        .filter(Boolean),
    ),
  };
}

function shouldAutoApplyCandidate(
  candidate: TunedPresetCandidate,
  state: {
    manualPreset: boolean;
    manualPriceCap: boolean;
    userEditedDraft: boolean;
    appliedCandidateKey: string | null;
    autoAppliedCandidateKey: string | null;
  },
): boolean {
  if (candidate.score < AUTO_APPLY_CANDIDATE_SCORE) return false;
  if (state.manualPreset || state.manualPriceCap || state.userEditedDraft) return false;
  if (
    state.appliedCandidateKey === candidate.key ||
    state.autoAppliedCandidateKey === candidate.key
  )
    return false;
  return true;
}

function scorePresetCandidate(
  memory: Record<string, unknown>,
  listing: AdvisorListing,
  strength: number,
): { score: number; reason: string } {
  const candidateListing = objectFromUnknown(memory.listing);
  const productScope =
    typeof memory.productScope === "string" ? memory.productScope.toLowerCase() : "";
  const candidateTitle =
    typeof candidateListing.title === "string" ? candidateListing.title.toLowerCase() : "";
  const listingTitle = listing.title.toLowerCase();
  const candidateTags = arrayFromUnknown(candidateListing.tags).map((item) =>
    String(item).toLowerCase(),
  );
  const listingTags = listing.tags.map((item) => item.toLowerCase());

  let score = 0;
  const reasons: string[] = [];

  if (candidateListing.id === listing.id) {
    score += 80;
    reasons.push("same listing");
  }
  if (candidateTitle && listingTitle.includes(candidateTitle)) {
    score += 40;
    reasons.push("same title");
  } else if (
    candidateTitle?.split(/\s+/).some((part) => part.length >= 4 && listingTitle.includes(part))
  ) {
    score += 20;
    reasons.push("similar title");
  }
  const sharedTags = candidateTags.filter(
    (tag) => listingTags.includes(tag) || listingTitle.includes(tag),
  );
  if (sharedTags.length > 0) {
    score += Math.min(30, sharedTags.length * 10);
    reasons.push(`tag ${sharedTags[0]}`);
  }
  if (productScope && (listingTags.includes(productScope) || listingTitle.includes(productScope))) {
    score += 25;
    reasons.push(`scope ${productScope}`);
  }
  if (typeof listing.category === "string" && candidateListing.category === listing.category) {
    score += 8;
  }
  if (score > 0) {
    const strengthBonus = Math.round(Math.max(0, Math.min(0.95, strength)) * 20);
    score += strengthBonus;
    if (strengthBonus >= 15) reasons.push(`strength ${Math.round(strength * 100)}%`);
  }

  const lastFeedback = objectFromUnknown(memory.lastFeedback);
  const lastOutcome = typeof lastFeedback.outcome === "string" ? lastFeedback.outcome : "";
  if (lastOutcome === "accepted") {
    score += 6;
    reasons.push("accepted before");
  } else if (lastOutcome === "rejected" || lastOutcome === "abandoned") {
    score -= 6;
    reasons.push(lastOutcome);
  } else if (lastOutcome === "cap_blocked") {
    score -= 4;
    reasons.push("cap blocked");
  }

  return {
    score,
    reason: reasons.slice(0, 2).join(", ") || "saved preference",
  };
}

function applyCandidateToDraft(
  draft: PresetTuningDraft,
  candidate: TunedPresetCandidate,
  applicationMode: "auto" | "manual" = "manual",
): PresetTuningDraft {
  const conflictNotes = confirmedValueConflictNotes(draft, candidate);
  const strategyNotes = [
    ...draft.strategyNotes.filter((note) => !note.startsWith("Saved preset value skipped:")),
    ...conflictNotes,
  ];

  return patchDraft(draft, {
    appliedTunedCandidate: {
      key: candidate.key,
      memoryKey: candidate.memoryKey,
      score: candidate.score,
      reason:
        conflictNotes.length > 0
          ? `${candidate.reason}; ${conflictNotes.length} saved value skipped`
          : candidate.reason,
      applicationMode,
    },
    strategyNotes,
    openingOfferMinor: candidate.openingOfferMinor ?? draft.openingOfferMinor,
    priceCapMinor: candidate.priceCapMinor ?? draft.priceCapMinor,
    mustVerify: draft.mustVerify.map((term) => ({
      ...term,
      checked:
        candidate.checkedTermIds.size > 0
          ? candidate.checkedTermIds.has(term.termId)
          : term.checked,
      confirmedValue: applyConfirmedValueFromCandidate(
        term,
        candidate.confirmedTermValues.get(term.termId),
      ),
    })),
    leverage: draft.leverage.map((item) => ({
      ...item,
      enabled:
        candidate.enabledLeverageTermIds.size > 0
          ? candidate.enabledLeverageTermIds.has(item.termId)
          : item.enabled,
    })),
    walkAway: draft.walkAway.map((item) => ({
      ...item,
      enabled:
        candidate.enabledWalkAwayIds.size > 0
          ? candidate.enabledWalkAwayIds.has(item.id)
          : item.enabled,
    })),
  });
}

function presetIdFromUnknown(value: unknown): NegotiationAgentPresetId | null {
  return value === "safe_buyer" ||
    value === "balanced_closer" ||
    value === "lowest_price" ||
    value === "fast_close"
    ? value
    : null;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function strengthFromCard(card: StoredMemoryCard): number {
  const parsed = Number(card.strength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringProp(value: unknown, key: string): string {
  const record = objectFromUnknown(value);
  return typeof record[key] === "string" ? record[key] : "";
}

function confirmedTermValuesFromUnknown(
  value: unknown,
): Map<string, PresetTermDraft["confirmedValue"]> {
  const values = new Map<string, PresetTermDraft["confirmedValue"]>();
  for (const item of arrayFromUnknown(value)) {
    const record = objectFromUnknown(item);
    const termId = stringProp(record, "termId");
    const confirmedValue = confirmedValueFromUnknown(record.confirmedValue);
    if (termId && confirmedValue) values.set(termId, confirmedValue);
  }
  return values;
}

function confirmedValueFromUnknown(value: unknown): PresetTermDraft["confirmedValue"] {
  const record = objectFromUnknown(value);
  const rawValue = record.value;
  const source = stringProp(record, "source");
  if (
    rawValue === undefined ||
    (typeof rawValue !== "string" &&
      typeof rawValue !== "number" &&
      typeof rawValue !== "boolean") ||
    (source !== "listing" && source !== "memory" && source !== "user" && source !== "seller_reply")
  ) {
    return undefined;
  }
  const label = stringProp(record, "label");
  const unit = stringProp(record, "unit");
  return {
    value: rawValue,
    source,
    ...(label ? { label } : {}),
    ...(unit ? { unit } : {}),
  };
}
