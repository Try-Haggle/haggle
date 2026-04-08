"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  adminApi,
  type InboxItemByType,
  type InboxListResponse,
  type InboxType,
} from "@/lib/admin-api";

export interface ColumnDef<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

interface Props<K extends InboxType> {
  type: K;
  columns: ColumnDef<InboxItemByType[K]>[];
  onSelect?: (item: InboxItemByType[K]) => void;
  /** Optional injected fetcher for tests. */
  fetchList?: (
    type: K,
    params: { limit: number; offset: number },
  ) => Promise<InboxListResponse<InboxItemByType[K]>>;
  pageSize?: number;
  /** Incremented by parent to force a refetch (e.g. after a mutation). */
  refreshKey?: number;
}

const PAGE_DEFAULT = 20;

export function InboxTable<K extends InboxType>({
  type,
  columns,
  onSelect,
  fetchList,
  pageSize = PAGE_DEFAULT,
  refreshKey = 0,
}: Props<K>) {
  const [items, setItems] = useState<InboxItemByType[K][]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load =
      fetchList ??
      ((t: K, p: { limit: number; offset: number }) =>
        adminApi.inbox.list(t, p));

    setLoading(true);
    load(type, { limit: pageSize, offset })
      .then((res) => {
        if (!cancelled) {
          setItems(res.items ?? []);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [type, offset, pageSize, fetchList, retryTick, refreshKey]);

  // Reset offset when tab (type) changes
  useEffect(() => {
    setOffset(0);
  }, [type]);

  const canPrev = offset > 0;
  const canNext = !error && items.length === pageSize;
  const colSpan = columns.length;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <table className="min-w-full divide-y divide-neutral-200 text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {loading && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-neutral-500">
                Loading…
              </td>
            </tr>
          )}
          {!loading && error && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-red-600">
                <div className="flex flex-col items-center gap-2">
                  <span>{error}</span>
                  <button
                    type="button"
                    data-testid="inbox-retry"
                    onClick={() => setRetryTick((t) => t + 1)}
                    className="rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Retry
                  </button>
                </div>
              </td>
            </tr>
          )}
          {!loading && !error && items.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-neutral-500">
                Nothing to review.
              </td>
            </tr>
          )}
          {!loading &&
            !error &&
            items.map((item) => (
              <tr
                key={item.id}
                data-testid={`inbox-row-${item.id}`}
                onClick={() => onSelect?.(item)}
                className="cursor-pointer hover:bg-neutral-50"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-4 py-2 text-neutral-800 align-top"
                  >
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">
        <span>
          Showing {items.length === 0 ? 0 : offset + 1}–{offset + items.length}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - pageSize))}
            disabled={!canPrev}
            className="rounded border border-neutral-300 bg-white px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + pageSize)}
            disabled={!canNext}
            className="rounded border border-neutral-300 bg-white px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
