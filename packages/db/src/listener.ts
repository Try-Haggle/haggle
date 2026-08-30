import postgres from "postgres";

/**
 * Dedicated LISTEN connection.
 *
 * `LISTEN` is bound to a session, so it does NOT work through Supabase's
 * transaction-mode pooler (port 6543) — which is what DATABASE_URL points at in
 * deployed environments. Callers must pass a session-mode / direct connection
 * string (port 5432) for this to do anything; `NOTIFY` itself runs inside a
 * transaction and is fine on the pooled connection.
 */
export interface PgListener {
  /** Subscribe to a NOTIFY channel. Resolves once the LISTEN is established. */
  listen(channel: string, handler: (payload: string) => void): Promise<void>;
  close(): Promise<void>;
}

export function createPgListener(connectionString: string): PgListener {
  // One long-lived connection; postgres.js keeps it dedicated to the listener
  // and re-issues LISTEN automatically after a reconnect.
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    max_lifetime: null,
  });

  return {
    async listen(channel, handler) {
      await client.listen(channel, handler);
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
