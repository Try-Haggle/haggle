"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  type LastRunResponse,
  type PromotionRule,
  type PromotionRulesResponse,
} from "@/lib/admin-api";

type EditableFields = {
  candidateMinUse: number;
  emergingMinUse: number;
  candidateMinAgeDays: number;
  emergingMinAgeDays: number;
  suggestionAutoPromoteCount: number;
  enabled: boolean;
};

const FIELDS: {
  key: keyof EditableFields;
  label: string;
  type: "number" | "boolean";
}[] = [
  { key: "candidateMinUse", label: "Cand. Min Use", type: "number" },
  { key: "emergingMinUse", label: "Emerg. Min Use", type: "number" },
  { key: "candidateMinAgeDays", label: "Cand. Min Age (d)", type: "number" },
  { key: "emergingMinAgeDays", label: "Emerg. Min Age (d)", type: "number" },
  {
    key: "suggestionAutoPromoteCount",
    label: "Auto-promote #",
    type: "number",
  },
  { key: "enabled", label: "Enabled", type: "boolean" },
];

interface Props {
  fetchRules?: () => Promise<PromotionRulesResponse>;
  updateRule?: (
    category: string,
    body: EditableFields,
  ) => Promise<{ rule: PromotionRule }>;
  deleteRule?: (category: string) => Promise<unknown>;
  runJob?: () => Promise<{ report: Record<string, unknown> }>;
  fetchLastRun?: () => Promise<LastRunResponse>;
}

export function PromotionRulesTable({
  fetchRules,
  updateRule,
  deleteRule,
  runJob,
  fetchLastRun,
}: Props = {}) {
  const [rules, setRules] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastRun, setLastRun] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const fetchR = fetchRules ?? (() => adminApi.promotionRules.list());
  const putR =
    updateRule ??
    ((category: string, body: EditableFields) =>
      adminApi.promotionRules.put(category, body));
  const delR = deleteRule ?? ((c: string) => adminApi.promotionRules.delete(c));
  const doRun = runJob ?? (() => adminApi.jobs.runTagPromote());
  const lastR = fetchLastRun ?? (() => adminApi.jobs.lastTagPromote());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchR()
      .then((res) => {
        if (!cancelled) {
          setRules(res.rules ?? []);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load rules");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  useEffect(() => {
    let cancelled = false;
    lastR()
      .then((res) => {
        if (!cancelled) setLastRun(res.lastRun);
      })
      .catch(() => {
        /* non-blocking */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  function startEdit(rule: PromotionRule) {
    setEditing(rule.category);
    setDraft({
      candidateMinUse: rule.candidateMinUse,
      emergingMinUse: rule.emergingMinUse,
      candidateMinAgeDays: rule.candidateMinAgeDays,
      emergingMinAgeDays: rule.emergingMinAgeDays,
      suggestionAutoPromoteCount: rule.suggestionAutoPromoteCount,
      enabled: rule.enabled,
    });
  }

  function cancelEdit() {
    setEditing(null);
    setDraft(null);
  }

  async function saveEdit(category: string) {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { rule } = await putR(category, draft);
      setRules((prev) => prev.map((r) => (r.category === category ? rule : r)));
      setEditing(null);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(category: string) {
    if (category === "default") return;
    setError(null);
    try {
      await delR(category);
      setRules((prev) => prev.filter((r) => r.category !== category));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleRunJob() {
    setRunning(true);
    setError(null);
    try {
      await doRun();
      setRefreshTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const lastRunAt =
    (lastRun?.createdAt as string | undefined) ??
    (lastRun?.created_at as string | undefined) ??
    null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-600">
          {lastRun ? (
            <span>
              Last run:{" "}
              <span data-testid="last-run-at">
                {lastRunAt ? new Date(lastRunAt).toLocaleString() : "unknown"}
              </span>
            </span>
          ) : (
            <span className="text-neutral-400">No runs yet</span>
          )}
        </div>
        <button
          type="button"
          data-testid="run-tag-promote"
          disabled={running}
          onClick={handleRunJob}
          className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {running ? "Running…" : "Run Promotion Job Now"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2">Category</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="px-4 py-2">
                  {f.label}
                </th>
              ))}
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading && (
              <tr>
                <td
                  colSpan={FIELDS.length + 2}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              rules.map((rule) => {
                const isEditing = editing === rule.category;
                return (
                  <tr
                    key={rule.category}
                    data-testid={`rule-row-${rule.category}`}
                  >
                    <td className="px-4 py-2 font-mono text-xs text-neutral-700">
                      {rule.category}
                    </td>
                    {FIELDS.map((f) => {
                      if (isEditing && draft) {
                        if (f.type === "number") {
                          return (
                            <td key={f.key} className="px-2 py-1">
                              <input
                                type="number"
                                value={draft[f.key] as number}
                                data-testid={`rule-input-${rule.category}-${f.key}`}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    [f.key]: Number(e.target.value),
                                  })
                                }
                                className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs"
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={f.key} className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              data-testid={`rule-input-${rule.category}-enabled`}
                              onChange={(e) =>
                                setDraft({ ...draft, enabled: e.target.checked })
                              }
                            />
                          </td>
                        );
                      }
                      if (f.type === "boolean") {
                        return (
                          <td key={f.key} className="px-4 py-2 text-neutral-700">
                            {rule.enabled ? "yes" : "no"}
                          </td>
                        );
                      }
                      return (
                        <td key={f.key} className="px-4 py-2 text-neutral-800">
                          {String(rule[f.key] ?? "")}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              data-testid={`rule-save-${rule.category}`}
                              disabled={saving}
                              onClick={() => saveEdit(rule.category)}
                              className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              data-testid={`rule-edit-${rule.category}`}
                              onClick={() => startEdit(rule)}
                              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              data-testid={`rule-delete-${rule.category}`}
                              disabled={rule.category === "default"}
                              onClick={() => handleDelete(rule.category)}
                              className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            {!loading && rules.length === 0 && (
              <tr>
                <td
                  colSpan={FIELDS.length + 2}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  No rules configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
