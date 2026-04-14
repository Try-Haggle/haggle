"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

type SortField = "level" | "volume" | "savings" | "deals";

interface LeaderboardEntry {
  userId: string;
  level: number;
  totalDeals: number;
  totalVolume: string;
  totalSaved: string;
  avgSavingPct: string;
}

const TABS: { key: SortField; label: string }[] = [
  { key: "level", label: "Level" },
  { key: "deals", label: "Deals" },
  { key: "volume", label: "Volume" },
  { key: "savings", label: "Savings" },
];

export default function LeaderboardPage() {
  const [sortBy, setSortBy] = useState<SortField>("level");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<{ leaderboard: LeaderboardEntry[]; total: number }>(
        `/leaderboard?sort=${sortBy}&limit=50`,
      )
      .then((data) => {
        setEntries(data.leaderboard);
        setTotal(data.total);
      })
      .catch(() => {
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [sortBy]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <Link
          href="/profile/level"
          className="text-sm text-emerald-400 hover:underline"
        >
          My Level &rarr;
        </Link>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-zinc-800 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSortBy(tab.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              sortBy === tab.key
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-zinc-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center text-zinc-500">
          No agents on the leaderboard yet.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-zinc-700">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-700 bg-zinc-900 text-left text-xs text-zinc-400">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3 text-right">Level</th>
                  <th className="px-4 py-3 text-right">Deals</th>
                  <th className="px-4 py-3 text-right">Volume</th>
                  <th className="px-4 py-3 text-right">Saved</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr
                    key={entry.userId}
                    className="border-b border-zinc-800 last:border-0"
                  >
                    <td className="px-4 py-3 text-sm">
                      {i < 3 ? (
                        <span className="text-lg">
                          {["🥇", "🥈", "🥉"][i]}
                        </span>
                      ) : (
                        <span className="text-zinc-500">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-zinc-200">
                      {entry.userId.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-emerald-400">
                      {entry.level}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-zinc-300">
                      {entry.totalDeals}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-zinc-300">
                      ${(Number(entry.totalVolume) / 100).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-amber-400">
                      ${(Number(entry.totalSaved) / 100).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-right text-xs text-zinc-600">
            {total} total agents
          </div>
        </>
      )}
    </div>
  );
}
