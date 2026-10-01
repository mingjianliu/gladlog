import { describe, expect, it } from "vitest";

import model3v3 from "../src/data/archetypes/archetype_model_3v3.json";
import modelSolo from "../src/data/archetypes/archetype_model_solo_shuffle.json";
import prompts3v3 from "../src/data/archetypes/archetype_prompts_3v3.json";
import promptsSolo from "../src/data/archetypes/archetype_prompts_solo_shuffle.json";
import {
  type IArchetypeModel,
  type IMatchDynamicFeatures,
  normalize,
  toFeatureVector,
} from "../src/utils/archetypeInference";
import {
  ARCHETYPE_LABELS_MATCH_MODEL,
  buildArchetypeInjectionHeader,
} from "../src/utils/archetypeInjection";

/**
 * Triage 2026-09-29, other F-O1 (user ruling 2026-09-30, A59 = C then A): the
 * missing shared predicate between `archetype_model_*.json` (the centroids the
 * classifier runs) and `archetype_prompts_*.json` (the label printed for
 * `cluster_<i>`). The two are joined only by the index, so they must come from
 * the same clustering run: each published cluster's `dynamics` must sit
 * nearest to its OWN model centroid, and the noise cluster must be the
 * shortest / lowest-burst one.
 *
 * Today they do not (prompts 2026-05-20, model 2026-05-27), so
 * `ARCHETYPE_LABELS_MATCH_MODEL` is false and `[MATCH PATTERN]` is not
 * printed. This test fails whenever the flag and the data disagree — a flag
 * flipped without regenerated labels, or regenerated labels with the flag
 * left off.
 */

interface PublishedCluster {
  label: string;
  isNoise: boolean;
  dynamics: {
    burstWindowCount: number;
    ccEventsPerMinute: number;
    tunnelScore: number;
    peakBurstScore: number;
    durationSeconds: number;
  };
}

/** burstWindowCount, ccEventsPerMinute, tunnelScore, log1p(peakBurstScore),
 * log1p(durationSeconds) — the five features both files carry. */
const SHARED_FEATURES = [0, 1, 2, 3, 5];

function alignment(
  model: IArchetypeModel,
  prompts: Record<string, PublishedCluster>,
) {
  const keys = Object.keys(prompts).sort();
  const published = keys.map((k) =>
    normalize(
      toFeatureVector({
        ...prompts[k]!.dynamics,
        criticalOrExposedBurstWindows: 0,
        ownTeamCCPerMin: 0,
      } as unknown as IMatchDynamicFeatures),
      model.normParams,
    ),
  );
  const dist = (i: number, j: number) =>
    Math.sqrt(
      SHARED_FEATURES.reduce(
        (s, f) => s + (model.centroids[i]![f]! - published[j]![f]!) ** 2,
        0,
      ),
    );
  const nearestIsOwn = model.centroids.map((_, i) => {
    let best = 0;
    for (let j = 1; j < published.length; j++)
      if (dist(i, j) < dist(i, best)) best = j;
    return keys[best] === `cluster_${i}`;
  });
  // the noise cluster: one-sided fast wins — the shortest and lowest-burst
  // centroid of the model, de-normalized
  const raw = (i: number, f: number) =>
    model.centroids[i]![f]! * (model.normParams.std[f] || 1) +
    model.normParams.mean[f]!;
  const noise = keys
    .map((k, j) => (prompts[k]!.isNoise ? j : -1))
    .filter((j) => j >= 0);
  const idx = model.centroids.map((_, i) => i);
  const shortest = idx.reduce((a, b) => (raw(b, 5) < raw(a, 5) ? b : a));
  const lowestBurst = idx.reduce((a, b) => (raw(b, 0) < raw(a, 0) ? b : a));
  const noiseOk =
    noise.length === 1 && noise[0] === shortest && noise[0] === lowestBurst;
  return {
    own: nearestIsOwn.filter(Boolean).length,
    of: nearestIsOwn.length,
    noiseOk,
    aligned: nearestIsOwn.every(Boolean) && noiseOk,
  };
}

const brackets = [
  ["3v3", model3v3, prompts3v3],
  ["solo_shuffle", modelSolo, promptsSolo],
] as const;

describe("archetype labels describe the model's own clusters", () => {
  it("the flag equals what the two files say, in every bracket", () => {
    const results = brackets.map(([name, model, prompts]) => ({
      name,
      ...alignment(
        model as unknown as IArchetypeModel,
        prompts as unknown as Record<string, PublishedCluster>,
      ),
    }));
    expect(results.every((r) => r.aligned)).toBe(ARCHETYPE_LABELS_MATCH_MODEL);
  });

  it("today's files: the printed label is the nearest published cluster for 1 of 8 centroids per bracket", () => {
    // pinned so a silent regeneration shows up here (and flips the test above)
    for (const [, model, prompts] of brackets) {
      const r = alignment(
        model as unknown as IArchetypeModel,
        prompts as unknown as Record<string, PublishedCluster>,
      );
      expect(r.of).toBe(8);
      expect(r.own).toBe(1);
    }
  });

  it("no header while the labels do not match the model", () => {
    const dynamics = {
      durationSeconds: 180,
      burstWindowCount: 3,
      peakBurstScore: 12,
      burstWindowQuality: { low: 0, moderate: 1, high: 1, critical: 1 },
      ccEventsPerMinute: 9,
      tunnelScore: 0.55,
      criticalOrExposedBurstWindows: 1,
      enemyMeleeCount: 1,
      enemyRangedCount: 1,
      setupStyle: "unknown",
      ownTeamCCPerMin: 6,
      enemyTeamCCPerMin: 6,
      ownTeamSpecs: [],
      enemyTeamSpecs: [],
    } as IMatchDynamicFeatures;
    for (const bracket of ["3v3", "Rated Solo Shuffle"])
      expect(buildArchetypeInjectionHeader(bracket, dynamics)).toBe(
        ARCHETYPE_LABELS_MATCH_MODEL
          ? expect.stringContaining("[MATCH PATTERN")
          : "",
      );
  });
});
