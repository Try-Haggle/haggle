import type { NegotiationSession, MasterStrategy } from '@haggle/engine-session';

export interface StoredSession {
  session: NegotiationSession;
  strategy: MasterStrategy;
}

export interface SessionStore {
  save(entry: StoredSession): Promise<void>;
  get(sessionId: string): Promise<StoredSession | null>;
  delete(sessionId: string): Promise<boolean>;
  listIds(): Promise<string[]>;
}

export class InMemorySessionStore implements SessionStore {
  private store = new Map<string, StoredSession>();

  async save(entry: StoredSession): Promise<void> {
    this.store.set(entry.session.session_id, entry);
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    return this.store.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }

  async listIds(): Promise<string[]> {
    return [...this.store.keys()];
  }

  /** Test-only: clear all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Test-only: current entry count. */
  get size(): number {
    return this.store.size;
  }
}
