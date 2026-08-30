"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useUserEvent } from "@/app/(app)/_components/user-events-provider";
import type { Notification } from "@/lib/api-client";

interface UseNotificationWsOptions {
  onNewNotification: (notification: Notification) => void;
}

/**
 * Toasts incoming notifications.
 *
 * The socket itself lives in UserEventsProvider — notifications and messaging
 * share one connection per user rather than opening one each.
 */
export function useNotificationWs({ onNewNotification }: UseNotificationWsOptions) {
  const router = useRouter();

  useUserEvent("notification.new", (event) => {
    const notification = (event as { notification?: Notification }).notification;
    if (!notification) return;

    const title = (notification.payload.displayTitle as string | undefined) ?? "New notification";
    const link = notification.payload.displayLink as string | undefined;

    toast(title, {
      id: notification.id,
      duration: 5000,
      ...(link
        ? {
            action: {
              label: "View",
              onClick: () => router.push(link),
            },
          }
        : {}),
    });

    onNewNotification(notification);
  });
}
