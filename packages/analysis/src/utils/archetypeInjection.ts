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

import { bracketKey } from "./bracketKey";
import model3v3 from "../data/archetypes/archetype_model_3v3.json";
import modelSoloShuffle from "../data/archetypes/archetype_model_solo_shuffle.json";
import prompts3v3 from "../data/archetypes/archetype_prompts_3v3.json";
import promptsSoloShuffle from "../data/archetypes/archetype_prompts_solo_shuffle.json";
import {
  classifyCluster,
  IArchetypeModel,
  IMatchDynamicFeatures,
} from "./archetypeInference";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IArchetypeClusterPrompt {
  label: string;
  isNoise: boolean;
  promptText: string;
  matchCount: number;
}

interface IArchetypeClassification {
  clusterKey: string;
  label: string;
  isNoise: boolean;
  promptText: string;
  distance: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Below this duration, archetype injection is suppressed — too little signal.
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 1,127 rounds: duration [0,30)
 * 34 · [30,60) 69 · [60,90) 90 · [90,120) 140 · [120,180) 400 · [180,300) 363
 * · ≥ 300 30 — the 30 s floor suppresses 3.1 % of rounds. Editorial; measured,
 * not official. */
const MIN_DURATION_SECONDS_FOR_INJECTION = 30;

/**
 * Distance threshold in Z-Score (SD) space.
 * Matches further than this from their nearest centroid are considered anomalous
 * (outliers) and archetype injection is suppressed to avoid hallucinated narratives.
 *
 * GH #34 batch 4 (2026-08-28), same corpus, 1,114 classified rounds (73 in
 * the noise cluster): distance [0,1) 62 · [1,2) 759 · [2,3) 273 · [3,4) 19 ·
 * [4,4.5) 0 · [4.5,6) 1 · ≥ 6 0 (p50 1.66, p90 2.35, p99 3.17). Share
 * suppressed: > 3 1.8 % · **> 4.5 0.1 %** (one round) · > 6 0 %. So the outlier
 * gate is effectively never exercised on the live model; it only bites on a
 * genuinely broken feature vector. Measured against extractMatchDynamics's
 * features (buildMatchContext assembles the same fields from matchArchetype).
 */
const MAX_DISTANCE_SD = 4.5;

/**
 * Do the published cluster LABELS (`archetype_prompts_*.json`, generated
 * 2026-05-20) describe the clusters of the MODEL the classifier runs
 * (`archetype_model_*.json`, generated 2026-05-27)? They do not: the two files
 * come from different clustering runs and are joined only by the index in
 * `cluster_<i>`, so the label printed is the name of whatever the 05-20 run
 * called its i-th cluster. Triage 2026-09-29, other F-O1: on the model's own
 * centroids the printed label is not the nearest published cluster for 7 of 8
 * clusters per bracket (identity vs best assignment distance 15.18 vs 5.68 in
 * 3v3, 15.45 vs 5.48 in Solo Shuffle); all 7 flagged rounds were `cluster_5`
 * labelled against a `dampening_burst_cycle`-shaped centroid.
 *
 * User ruling 2026-09-30 (A59 = C then A): stop printing the header until the
 * upstream `finalize_prompts.py` re-labels the 05-27 centroids. Flip this to
 * true ONLY together with regenerated prompt files —
 * `test/archetypeLabelAlignment.test.ts` computes the alignment from the two
 * files and fails whenever this flag and the data disagree, in either
 * direction.
 */
export const ARCHETYPE_LABELS_MATCH_MODEL = false;

// ── Bracket detection ─────────────────────────────────────────────────────────

type ArchetypeBracket = "3v3" | "solo_shuffle";

/**
 * Maps the raw bracket string from combat metadata to the archetype slug.
 * Returns null for brackets we don't have a model for (2v2, BG Blitz, etc.).
 */
function bracketToArchetypeSlug(
  bracket: string | undefined | null,
): ArchetypeBracket | null {
  // Shared bracket predicate (utils/bracketKey.ts, 2026-08-30) — 2v2 and
  // unknown brackets have no archetype model.
  const key = bracketKey(bracket);
  if (key === "solo") return "solo_shuffle";
  if (key === "3v3") return "3v3";
  return null;
}

// ── Data accessors ────────────────────────────────────────────────────────────

function getModel(slug: ArchetypeBracket): IArchetypeModel {
  return (
    slug === "solo_shuffle" ? modelSoloShuffle : model3v3
  ) as IArchetypeModel;
}

function getPrompts(
  slug: ArchetypeBracket,
): Record<string, IArchetypeClusterPrompt> {
  return (slug === "solo_shuffle" ? promptsSoloShuffle : prompts3v3) as Record<
    string,
    IArchetypeClusterPrompt
  >;
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
function classifyMatchArchetype(
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
 *   - The published labels do not describe the model's clusters
 *     (`ARCHETYPE_LABELS_MATCH_MODEL`)
 *   - Bracket unsupported
 *   - Duration below the minimum (too little signal in short rounds)
 *   - Classification landed in a noise cluster (one-sided fast wins, no coaching value)
 *   - Match is too anomalous (outlier — distance too high)
 */
export function buildArchetypeInjectionHeader(
  bracket: string | undefined | null,
  dynamics: IMatchDynamicFeatures,
): string {
  if (!ARCHETYPE_LABELS_MATCH_MODEL) return "";
  if (dynamics.durationSeconds < MIN_DURATION_SECONDS_FOR_INJECTION) return "";

  const result = classifyMatchArchetype(bracket, dynamics);
  if (!result) return "";
  if (result.isNoise) return "";
  if (result.distance > MAX_DISTANCE_SD) return "";

  // labelBias fix (2026-07-15): the bare "[MATCH TYPE: x]" header read as a
  // verdict planted before any data — blind judges docked it (2-3s) and
  // responses demonstrably absorbed it as a conclusion. Keep the routing
  // value but state what it is: a statistical cluster tag to be verified
  // against the timeline, not a judgement.
  return `[MATCH PATTERN: ${result.label} — statistical cluster tag, verify against the timeline; not a verdict]`;
}
