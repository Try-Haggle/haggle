"use client";

import { useEffect, useState } from "react";
import {
  fetchProfileCard,
  fetchProfileCardsBatch,
  type TrustCardData,
  type TrustCardRole,
} from "@/lib/profile-card-api";

interface UseTrustCardOptions {
  role?: TrustCardRole;
  enabled?: boolean;
}

export function useTrustCard(
  actorId: string | null | undefined,
  options: UseTrustCardOptions = {},
) {
  const { role = "seller", enabled = true } = options;
  const [data, setData] = useState<TrustCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!actorId || !enabled) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProfileCard(actorId, role)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, role, enabled]);

  return { data, loading, error };
}

export function useTrustCardsBatch(
  actorIds: string[],
  options: UseTrustCardOptions = {},
) {
  const { role = "seller", enabled = true } = options;
  const [cards, setCards] = useState<Record<string, TrustCardData>>({});
  const [loading, setLoading] = useState(false);

  // Stable key — re-fetch only when actorIds set actually changes.
  const key = actorIds.slice().sort().join(",");

  useEffect(() => {
    if (!enabled || actorIds.length === 0) {
      setCards({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProfileCardsBatch(actorIds, role)
      .then((c) => {
        if (!cancelled) setCards(c);
      })
      .catch(() => {
        if (!cancelled) setCards({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, role, enabled]);

  return { cards, loading };
}
