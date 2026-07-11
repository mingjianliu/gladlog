/**
 * archetypeInjection.ts — Match archetype classification for prompt injection.
 *
 * Classifies a match into one of the bracket-specific game-situation archetypes
 * and returns a one-line `[MATCH TYPE: label]` header to prepend to the analysis prompt.
 *
 * Archetypes describe what the enemy team is doing, not the healer's spec.
 * Globally clustered (K=8 per bracket) — see cluster-eval-report.md for validation.
 *
 * The classification follows the same 7-dimension feature vector and log transforms
 * used by buildArchetypePrompts.ts. Any change to that vector must be mirrored here.
 */

import model3v3 from '../data/archetypes/archetype_model_3v3.json';
import modelSoloShuffle from '../data/archetypes/archetype_model_solo_shuffle.json';
import prompts3v3 from '../data/archetypes/archetype_prompts_3v3.json';
import promptsSoloShuffle from '../data/archetypes/archetype_prompts_solo_shuffle.json';
import { classifyCluster, IArchetypeModel, IMatchDynamicFeatures } from './archetypeInference';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IArchetypeClusterPrompt {
  label: string;
  isNoise: boolean;
  promptText: string;
  matchCount: number;
}

export interface IArchetypeClassification {
  clusterKey: string;
  label: string;
  isNoise: boolean;
  promptText: string;
  distance: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Below this duration, archetype injection is suppressed — too little signal. */
const MIN_DURATION_SECONDS_FOR_INJECTION = 30;

/**
 * Distance threshold in Z-Score (SD) space.
 * Matches further than this from their nearest centroid are considered anomalous
 * (outliers) and archetype injection is suppressed to avoid hallucinated narratives.
 */
const MAX_DISTANCE_SD = 4.5;

// ── Bracket detection ─────────────────────────────────────────────────────────

export type ArchetypeBracket = '3v3' | 'solo_shuffle';

/**
 * Maps the raw bracket string from combat metadata to the archetype slug.
 * Returns null for brackets we don't have a model for (2v2, BG Blitz, etc.).
 */
export function bracketToArchetypeSlug(bracket: string | undefined | null): ArchetypeBracket | null {
  if (!bracket) return null;
  const lower = bracket.toLowerCase();
  if (lower.includes('solo')) return 'solo_shuffle';
  if (lower.includes('3v3')) return '3v3';
  return null;
}

// ── Data accessors ────────────────────────────────────────────────────────────

function getModel(slug: ArchetypeBracket): IArchetypeModel {
  return (slug === 'solo_shuffle' ? modelSoloShuffle : model3v3) as IArchetypeModel;
}

function getPrompts(slug: ArchetypeBracket): Record<string, IArchetypeClusterPrompt> {
  return (slug === 'solo_shuffle' ? promptsSoloShuffle : prompts3v3) as Record<string, IArchetypeClusterPrompt>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a match into its archetype. Returns the cluster, label, and narrative —
 * including for noise clusters (callers decide whether to inject).
 *
 * Returns null if:
 *   - Bracket is unsupported (e.g., 2v2)
 *   - The classified cluster has no prompt entry (shouldn't happen for valid models)
 */
export function classifyMatchArchetype(
  bracket: string | undefined | null,
  dynamics: IMatchDynamicFeatures,
): IArchetypeClassification | null {
  const slug = bracketToArchetypeSlug(bracket);
  if (!slug) return null;

  const model = getModel(slug);
  const prompts = getPrompts(slug);

  const { clusterKey, distance } = classifyCluster(dynamics, model);

  const cluster = prompts[clusterKey];
  if (!cluster) return null;

  return {
    clusterKey,
    label: cluster.label,
    isNoise: cluster.isNoise,
    promptText: cluster.promptText,
    distance,
  };
}

/**
 * Build the [MATCH TYPE: label] header line for prompt injection.
 *
 * Returns empty string when injection should be skipped:
 *   - Bracket unsupported
 *   - Duration below the minimum (too little signal in short rounds)
 *   - Classification landed in a noise cluster (one-sided fast wins, no coaching value)
 *   - Match is too anomalous (outlier — distance too high)
 */
export function buildArchetypeInjectionHeader(
  bracket: string | undefined | null,
  dynamics: IMatchDynamicFeatures,
): string {
  if (dynamics.durationSeconds < MIN_DURATION_SECONDS_FOR_INJECTION) return '';

  const result = classifyMatchArchetype(bracket, dynamics);
  if (!result) return '';
  if (result.isNoise) return '';
  if (result.distance > MAX_DISTANCE_SD) return '';

  return `[MATCH TYPE: ${result.label}]`;
}
