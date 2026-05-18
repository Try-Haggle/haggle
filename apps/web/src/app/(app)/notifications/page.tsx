"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { notificationApi, type Notification } from "@/lib/api-client";
import { useNotificationContext } from "../_components/notification-provider";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { decrementCount, resetCount } = useNotificationContext();
  const router = useRouter();

  useEffect(() => {
    notificationApi.list()
      .then(({ notifications: items, nextCursor: cursor }) => {
        setNotifications(items);
        setNextCursor(cursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Infinite scroll
  useEffect(() => {
    if (!nextCursor) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loadingMore || !nextCursor) return;
        setLoadingMore(true);
        notificationApi.list(nextCursor)
          .then(({ notifications: more, nextCursor: cursor }) => {
            setNotifications((prev) => [...prev, ...more]);
            setNextCursor(cursor);
          })
          .catch(() => {})
          .finally(() => setLoadingMore(false));
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextCursor, loadingMore]);

  async function handleClick(n: Notification) {
    if (!n.readAt) {
      await notificationApi.markRead(n.id).catch(() => {});
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x));
      decrementCount();
    }
    if (n.payload.displayLink) router.push(n.payload.displayLink as string);
  }

  async function handleMarkAll() {
    await notificationApi.markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    resetCount();
  }

  return (
    <main className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Notifications</h1>
        {notifications.some((n) => !n.readAt) && (
          <button
            onClick={handleMarkAll}
            className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
            <Bell className="h-7 w-7 text-slate-500" />
          </div>
          <p className="text-slate-400">No notifications yet</p>
          <p className="mt-1 text-sm text-slate-600">You&apos;ll see updates about your negotiations and listings here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors cursor-pointer
                ${n.readAt
                  ? "border-slate-800 bg-bg-card hover:bg-slate-800/50"
                  : "border-cyan-400/20 bg-cyan-400/5 hover:bg-cyan-400/10"
                }`}
            >
              <div className="flex items-start gap-3">
                {!n.readAt && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
                )}
                <div className={n.readAt ? "" : ""}>
                  <p className={`text-sm leading-snug ${n.readAt ? "text-slate-400" : "text-slate-200"}`}>
                    {n.payload.displayTitle ?? n.eventType}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </button>
          ))}

          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            </div>
          )}
          {nextCursor && <div ref={sentinelRef} className="h-10" />}
        </div>
      )}
    </main>
  );
}
