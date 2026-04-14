// HNP Profile & Discovery Types
// Agent profiles, transport entries, auth, and /.well-known/hnp structure.

import type { HnpCoreRevision, HnpTransport } from './core.js';
import { HNP_CORE_CAPABILITY, HNP_CORE_REVISIONS } from './core.js';

export interface HnpCapabilitySupport {
  versions: string[];
  required: boolean;
  description?: string;
}

export interface HnpTransportEntry {
  name: HnpTransport;
  endpoint: string;
}

export interface HnpAuthProfile {
  schemes: string[];
  jwks_uri?: string;
}

export interface HnpAgentProfile {
  agent_id: string;
  display_name: string;
  roles: ('BUYER' | 'SELLER' | 'MEDIATOR')[];
  transports: HnpTransport[];
  supports_async_sessions?: boolean;
  supports_streaming?: boolean;
  supports_human_approval?: boolean;
  resources?: string[];
}

export interface HnpWellKnownProfile {
  hnp: {
    core_revisions: HnpCoreRevision[];
    preferred_core_revision: HnpCoreRevision;
    transports: HnpTransportEntry[];
    capabilities: Record<string, HnpCapabilitySupport>;
    auth?: HnpAuthProfile;
    agent_profile?: HnpAgentProfile;
  };
}

/** Factory to create a well-known HNP profile with sensible defaults. */
export function createHnpProfile(input: {
  endpoint: string;
  transports: HnpTransportEntry[];
  capabilities?: Record<string, HnpCapabilitySupport>;
  auth?: HnpAuthProfile;
  agent_profile?: HnpAgentProfile;
  core_revisions?: HnpCoreRevision[];
  preferred_core_revision?: HnpCoreRevision;
}): HnpWellKnownProfile {
  const coreRevisions = input.core_revisions ?? [...HNP_CORE_REVISIONS];
  const preferredCoreRevision = input.preferred_core_revision ?? coreRevisions[0];

  return {
    hnp: {
      core_revisions: coreRevisions,
      preferred_core_revision: preferredCoreRevision,
      transports: input.transports.map((transport) => ({
        ...transport,
        endpoint: transport.endpoint || input.endpoint,
      })),
      capabilities: {
        [HNP_CORE_CAPABILITY]: { versions: ['1.0.0'], required: true },
        ...input.capabilities,
      },
      ...(input.auth ? { auth: input.auth } : {}),
      ...(input.agent_profile ? { agent_profile: input.agent_profile } : {}),
    },
  };
}
