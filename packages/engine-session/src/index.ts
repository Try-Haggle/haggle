// Protocol types
export type { HnpMessageType, HnpRole, HnpMessage } from './protocol/types.js';

// Strategy types + assembler
export type { MasterStrategy, RoundData } from './strategy/types.js';
export { assembleContext } from './strategy/assembler.js';

// Session types + state machine
export type {
  SessionStatus,
  NegotiationRound,
  NegotiationSession,
} from './session/types.js';
export { transition } from './session/state-machine.js';
export type { SessionEvent } from './session/state-machine.js';

// Round types + executor + concession
export type { RoundResult, EscalationRequest } from './round/types.js';
export { executeRound } from './round/executor.js';
export { trackConcession } from './round/concession.js';
