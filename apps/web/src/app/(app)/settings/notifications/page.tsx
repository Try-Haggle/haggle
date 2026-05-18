"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { notificationApi, type NotificationPreferences } from "@/lib/api-client";

const CATEGORIES = ["negotiation", "account", "listing"] as const;
const CHANNELS = ["in_app", "email"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  negotiation: "Negotiation",
  account: "Account",
  listing: "Listing",
};
const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In-App",
  email: "Email",
};

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPreferences>({});
  const [saving, setSaving] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    const { preferences } = await notificationApi.getPreferences().catch(() => ({ preferences: {} }));
    setPrefs(preferences);
  }, []);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);

  async function handleToggle(category: string, channel: string, current: boolean) {
    const key = `${category}.${channel}`;
    setSaving(key);
    const newValue = !current;
    setPrefs((prev) => ({
      ...prev,
      [category]: { ...prev[category], [channel]: newValue },
    }));
    await notificationApi.updatePreference(category, channel, newValue).catch(() => {
      setPrefs((prev) => ({
        ...prev,
        [category]: { ...prev[category], [channel]: current },
      }));
    });
    setSaving(null);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header — matches Settings page style */}
      <div className="mb-8">
        {/* Mobile only: back button */}
        <button
          onClick={() => router.back()}
          className="mb-4 flex md:hidden items-center gap-1 text-sm text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-white">Notification Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your notification preferences</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-bg-card p-4 sm:p-6 space-y-5">
        {CATEGORIES.map((category) => (
          <div key={category}>
            <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
              {CATEGORY_LABELS[category]}
            </p>
            <div className="space-y-3">
              {CHANNELS.map((channel) => {
                const enabled = prefs[category]?.[channel] ?? true;
                const key = `${category}.${channel}`;
                return (
                  <div key={channel} className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">{CHANNEL_LABELS[channel]}</span>
                    <button
                      onClick={() => handleToggle(category, channel, enabled)}
                      disabled={saving === key}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none
                        ${enabled ? "bg-cyan-500" : "bg-slate-700"}
                        ${saving === key ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform transition duration-200 ease-in-out
                          ${enabled ? "translate-x-4" : "translate-x-0"}`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
