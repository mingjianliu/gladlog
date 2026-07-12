// packages/analysis/src/compare/buildExemplarLedPrompt.test.ts
import { describe, expect, it } from "vitest";
import { buildExemplarLedPrompt } from "./buildExemplarLedPrompt";
import type { VerifiedComparison } from "./verifiedComparison";
import type { ReferenceCell } from "./corpusTypes";

const vc: VerifiedComparison = {
  dims: [
    {
      key: "offensiveIndex",
      value: 0.31,
      p10: 0.2,
      p50: 0.49,
      p90: 0.7,
      percentile: 30,
      verdict: "bottom quartile of your cohort",
    },
  ],
  facts: {
    offensiveIndex: "0.31",
    "offensiveIndex.cohortMedian": "0.49",
    "offensiveIndex.verdict": "bottom quartile of your cohort",
  },
};
const cell = {
  spec: "Discipline Priest",
  bracket: "3v3",
  archetype: "hybrid",
  buildGroup: "offensive",
  sampleN: 40,
  insufficient: false,
  metrics: {},
  exemplarCrises: [
    [
      "At 33.8s (Teammate Havoc Demon Hunter HP: 39%): Pain Suppression -> Flash Heal",
    ],
  ],
} as ReferenceCell;

describe("buildExemplarLedPrompt", () => {
  it("instructs placeholder-only output, lists the allowed keys, and includes exemplars", () => {
    const p = buildExemplarLedPrompt(vc, cell, "Discipline Priest");
    expect(p).toMatch(/\{\{offensiveIndex\}\}/); // shows the available placeholders
    expect(p).toMatch(/placeholder/i);
    expect(p).toMatch(/Pain Suppression/); // exemplar crisis included
    expect(p).toMatch(/Discipline Priest/);
  });
});
