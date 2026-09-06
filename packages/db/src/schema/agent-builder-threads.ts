import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The verbatim Agent Studio conversation, one row per thread.
 *
 * The builder chat used to live only in the browser, so the transcript was
 * lost on another device, in another browser, after clearing site data, and
 * after two days. The distilled result (budget, deal-breakers, style) was
 * always in `negotiation_agents.negotiation_agent_config`; this is the record
 * of what was actually said, which a user has to be able to come back to.
 *
 * Keyed by `threadKey`, not by an agent id, because a conversation starts
 * before any agent row exists — you talk to a preset first and Save turns it
 * into an agent. The key is the studio's own thread name
 * (`agent-studio:{role}:{preset:closer | saved:<uuid>}`), and Save re-keys the
 * row rather than moving rows between tables.
 *
 * One row per thread with the messages in a jsonb array, rather than a row per
 * message: a builder conversation is tens of turns, always read whole, and
 * never queried across. Should that stop being true, the array is the thing to
 * split out.
 */
export const agentBuilderThreads = pgTable(
  "agent_builder_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Owner. Guests are not stored — there is nobody to return the thread to. */
    userId: uuid("user_id").notNull(),
    /** The studio's thread name. Unique per user; re-keyed in place on Save. */
    threadKey: text("thread_key").notNull(),
    /** Preset the thread was started from, for display before an agent exists. */
    presetId: text("preset_id"),
    /** Saved agent this thread became, once Save has run. */
    agentId: uuid("agent_id"),
    /** The conversation, verbatim and in order. */
    messages: jsonb("messages")
      .$type<Array<{ id: string; role: "user" | "agent"; text: string; timestamp: number }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The upsert target: a turn writes by (user, thread) without reading first.
    uniqueIndex("agent_builder_threads_user_key_idx").on(table.userId, table.threadKey),
    // "My threads, most recent first" — the only listing this table serves.
    index("agent_builder_threads_user_updated_idx").on(table.userId, table.updatedAt),
    index("agent_builder_threads_agent_idx").on(table.agentId),
  ],
);
