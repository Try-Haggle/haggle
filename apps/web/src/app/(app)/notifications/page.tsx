"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState, NotificationItem, Skeleton, Spinner } from "@/components/ui";
import { type Notification, notificationApi } from "@/lib/api-client";
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
    notificationApi
      .list()
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
        notificationApi
          .list(nextCursor)
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
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
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
    // Same frame as every other page in the app (browse, dashboards, orders):
    // this one was centred at max-w-2xl, which read as a different product.
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 py-6 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-ink">Notifications</h1>
        {notifications.some((n) => !n.readAt) && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="text-sm text-action-primary hover:text-action-primary-hover transition-colors cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {["s1", "s2", "s3", "s4", "s5"].map((key) => (
            <Skeleton key={key} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          padding="lg"
          bordered={false}
          icon={<Bell className="size-7 text-ink-muted" />}
          title="No notifications yet"
          description="You'll see updates about your negotiations and listings here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              read={!!n.readAt}
              title={n.payload.displayTitle ?? n.eventType}
              time={new Date(n.createdAt).toLocaleString()}
              onClick={() => handleClick(n)}
            />
          ))}

          {loadingMore && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}
          {nextCursor && <div ref={sentinelRef} className="h-10" />}
        </div>
      )}
    </main>
  );
}
