/**
 * config/pipeline-presets.ts
 *
 * Amount-based pipeline configuration presets.
 * Step 67-C — different negotiation intensity by price tier.
 */

import type { NegotiationPhase } from '../types.js';

export interface PipelinePreset {
  name: string;
  min_amount: number; // minor units (cents)
  max_amount: number;
  max_rounds: number;
  phases: NegotiationPhase[]; // active phases
  reasoning_enabled: boolean; // Stage 3 reasoning mode
  respond_mode: 'template' | 'llm';
  description: string;
}

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    name: 'quick',
    min_amount: 0,
    max_amount: 10_000, // < $100
    max_rounds: 3,
    phases: ['OPENING', 'BARGAINING', 'SETTLEMENT'],
    reasoning_enabled: false,
    respond_mode: 'template',
    description: 'Low-value quick mode (1-3 rounds)',
  },
  {
    name: 'standard',
    min_amount: 10_000,
    max_amount: 50_000, // $100-$500
    max_rounds: 10,
    phases: ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT'],
    reasoning_enabled: false,
    respond_mode: 'template',
    description: 'Standard 5-phase mode',
  },
  {
    name: 'premium',
    min_amount: 50_000,
    max_amount: 500_000, // $500-$5,000
    max_rounds: 15,
    phases: ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT'],
    reasoning_enabled: true,
    respond_mode: 'llm',
    description: 'High-value full pipeline + reasoning',
  },
  {
    name: 'enterprise',
    min_amount: 500_000,
    max_amount: Infinity, // > $5,000
    max_rounds: 20,
    phases: ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT'],
    reasoning_enabled: true,
    respond_mode: 'llm',
    description: 'Enterprise tier + extended rounds',
  },
];

/** Look up preset by amount in minor units (cents) */
export function getPresetForAmount(amountMinor: number): PipelinePreset {
  for (const preset of PIPELINE_PRESETS) {
    if (amountMinor >= preset.min_amount && amountMinor < preset.max_amount) {
      return preset;
    }
  }
  // Fallback: standard
  return PIPELINE_PRESETS[1]!;
}

/** Look up preset by name */
export function getPresetByName(name: string): PipelinePreset | undefined {
  return PIPELINE_PRESETS.find((p) => p.name === name);
}
