// packages/analysis/src/compare/buildExemplarLedPrompt.test.ts
import { describe, expect, it } from "vitest";

import {
  buildExemplarLedPrompt,
  buildRetryPrompt,
} from "./buildExemplarLedPrompt";
import type { ReferenceCell } from "./corpusTypes";
import type { VerifiedComparison } from "./verifiedComparison";

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
  it("v2:范例被洗数字(时间戳/HP% 不再出现),门规谓词自证", () => {
    const p = buildExemplarLedPrompt(vc, cell, "Discipline Priest");
    expect(p).not.toMatch(/33\.8s/);
    expect(p).not.toMatch(/39%/);
    expect(p).toMatch(/HP low/);
  });
  it("v2:逐维 verdict 值直接可见 + 禁自创示意数字条款", () => {
    const p = buildExemplarLedPrompt(vc, cell, "Discipline Priest");
    expect(p).toMatch(/offensiveIndex: bottom quartile of your cohort/);
    expect(p).toMatch(/illustrative numbers/i);
  });
  it("buildRetryPrompt:带回原 prompt、违规清单与被拒草稿", () => {
    const rp = buildRetryPrompt("PROMPT", "DRAFT 36%", ["raw percentage: 36%"]);
    expect(rp).toMatch(/PROMPT/);
    expect(rp).toMatch(/REJECTED/);
    expect(rp).toMatch(/raw percentage: 36%/);
    expect(rp).toMatch(/DRAFT 36%/);
  });
});
