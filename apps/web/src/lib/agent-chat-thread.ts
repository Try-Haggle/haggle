/**
 * Which conversation an agent's briefing chat is.
 *
 * Every surface that briefs an agent — the Agents tab, the listing wizard's
 * drawer, the listing page's drawer — asks this one function, so a saved agent
 * opens the same conversation wherever it is opened. Before, each surface keyed
 * its chat its own way (the tab per agent, the wizard per draft, the listing
 * page per listing), so an agent's history existed only on the tab it was
 * written in.
 *
 *   - A saved agent has one thread: kept in the browser for speed and in the
 *     database as the record, so it follows the agent across surfaces and
 *     devices.
 *   - A preset is a template, not an agent: its chat is scoped to this visit,
 *     so picking one always starts from the opening line.
 *
 * The key strings are the ones the Agents tab has always written, so threads
 * saved before this existed are found under the same names.
 */

export type AgentChatRole = "buyer" | "seller";

export interface AgentChatSelection {
  kind: "preset" | "saved";
  id: string;
}

export interface AgentChatThread {
  /** The chat's local storage namespace. Also a good React key for the chat. */
  storageId: string;
  /** Present only for saved agents: the database thread to restore and mirror. */
  serverThreadKey?: string;
}

export function agentChatThread(
  role: AgentChatRole,
  selection: AgentChatSelection,
  visitId: string,
): AgentChatThread {
  const base = `agent-studio:${role}:${selection.kind}:${selection.id}`;
  return selection.kind === "saved"
    ? { storageId: base, serverThreadKey: base }
    : { storageId: `${base}:${visitId}` };
}

/** A fresh visit id — generate once per mount of a surface, never per render. */
export function newChatVisitId(): string {
  return Math.random().toString(36).slice(2, 10);
}
