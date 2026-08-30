import type { Message } from "@/lib/messaging-api";

/**
 * Timestamp grouping for the message thread.
 *
 * The Django original computed this server-side from a timezone cookie and then
 * recomputed it in the browser because that cookie was often wrong or missing.
 * Here it is computed once, in the browser, from the ISO timestamps — the two
 * implementations (and the whole class of bug) go away.
 */

export interface GroupedMessage {
  message: Message;
  /** First message of a calendar day → render a date divider above it. */
  showDate: boolean;
  dateLabel: string | null;
  /** Minute or sender changed → show the timestamp line. */
  showTimestamp: boolean;
  /** First message of a run from the same sender → show their name/avatar. */
  startsRun: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localMinuteKey(date: Date): string {
  return `${localDateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return localDateKey(a) === localDateKey(b);
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameLocalDay(date, now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return "Yesterday";

  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Conversation-list stamp: time today, date otherwise. */
export function formatConversationTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameLocalDay(date, now)) return formatMessageTime(iso);
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

export function groupMessages(messages: Message[], now: Date = new Date()): GroupedMessage[] {
  let previousDateKey: string | null = null;
  let previousMinuteKey: string | null = null;
  let previousSenderId: string | null = null;

  return messages.map((message) => {
    const date = new Date(message.createdAt);
    const dateKey = localDateKey(date);
    const minuteKey = localMinuteKey(date);
    const senderChanged = message.senderId !== previousSenderId;

    const showDate = dateKey !== previousDateKey;
    const grouped: GroupedMessage = {
      message,
      showDate,
      dateLabel: showDate ? formatDateLabel(message.createdAt, now) : null,
      showTimestamp: minuteKey !== previousMinuteKey || senderChanged,
      // A date divider always breaks the run, otherwise a day boundary would
      // hide the sender's name on the first message of the new day.
      startsRun: senderChanged || showDate,
    };

    previousDateKey = dateKey;
    previousMinuteKey = minuteKey;
    previousSenderId = message.senderId;
    return grouped;
  });
}

/** Newest-first de-duplicating merge used when realtime and refetch overlap. */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of [...existing, ...incoming]) {
    // An optimistic bubble carries the same clientMessageId as the stored
    // message, so keying on it prevents the message showing up twice.
    const key = message.clientMessageId ? `c:${message.clientMessageId}` : `m:${message.id}`;
    byId.set(key, message);
  }
  return [...byId.values()].sort((a, b) => {
    const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}
