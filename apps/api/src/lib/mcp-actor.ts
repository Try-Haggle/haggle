import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "../middleware/auth.js";

const mcpActorStorage = new AsyncLocalStorage<AuthUser | undefined>();

export function runWithMcpActor<T>(actor: AuthUser | undefined, fn: () => T): T {
  return mcpActorStorage.run(actor, fn);
}

export function getMcpActor(): AuthUser | undefined {
  return mcpActorStorage.getStore();
}
