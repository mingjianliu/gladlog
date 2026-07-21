import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  RESPONSE_PRESERVING,
  measureJudgeVariance,
} from "../src/judge/judgeVariance";

type Item = { accuracy: number; errors: number };

/** Build a calibration dir where source N's three response-preserving cases got
 * the scores in `triplets[N]`, plus one `removed-deaths` case that must be
 * ignored (it deletes prompt lines, so it is not the same material). */
function makeSuite(triplets: Item[][], scoresDir = "scores"): string {
  const base = mkdtempSync(join(tmpdir(), "gl-var-"));
  const suite = join(base, "judge-calibration");
  mkdirSync(join(suite, scoresDir), { recursive: true });

  const cases: {
    caseId: string;
    sourceOrdinal: number;
    perturbation: string;
  }[] = [];
  let n = 0;
  triplets.forEach((items, i) => {
    const sourceOrdinal = i + 1;
    // Deliberately register the perturbations out of order: the module must key
    // off the perturbation name, not manifest or caseId order.
    [...RESPONSE_PRESERVING].reverse().forEach((perturbation, slotFromEnd) => {
      const caseId = `case-${String(++n).padStart(2, "0")}`;
      cases.push({ caseId, sourceOrdinal, perturbation });
      const item = items[RESPONSE_PRESERVING.length - 1 - slotFromEnd];
      writeFileSync(
        join(suite, scoresDir, `${caseId}.json`),
        JSON.stringify({
          factAudit: Array.from({ length: 5 }, (_, k) => ({
            claim: `c${k}`,
            verdict: k < item.errors ? "refuted" : "verified",
          })),
          prompt: { sufficiency: 5 },
          response: { accuracy: item.accuracy },
        }),
      );
    });
    // Decoy: must not be counted.
    const decoy = `case-${String(++n).padStart(2, "0")}`;
    cases.push({
      caseId: decoy,
      sourceOrdinal,
      perturbation: "removed-deaths",
    });
    writeFileSync(
      join(suite, scoresDir, `${decoy}.json`),
      JSON.stringify({ factAudit: [], response: { accuracy: 1 } }),
    );
  });

  writeFileSync(
    join(suite, "calibration-manifest.json"),
    JSON.stringify({ seed: 42, cases }),
  );
  return base;
}

describe("measureJudgeVariance", () => {
  it("measures spread across the response-preserving triplet only", async () => {
    const base = makeSuite([
      [
        { accuracy: 3, errors: 0 },
        { accuracy: 5, errors: 0 },
        { accuracy: 4, errors: 0 },
      ], // accRange 2, errRange 0
      [
        { accuracy: 4, errors: 1 },
        { accuracy: 4, errors: 3 },
        { accuracy: 4, errors: 2 },
      ], // accRange 0, errRange 2
    ]);
    const r = await measureJudgeVariance(base, "scores");

    expect(r.complete).toBe(2);
    expect(r.incomplete).toBe(0);
    expect(r.accuracyRangeMean).toBe(1);
    expect(r.accuracyRangeMax).toBe(2);
    expect(r.accuracyRangeGe2).toBe(1);
    expect(r.errorCountRangeMean).toBe(1);
    expect(r.errorCountRangeMax).toBe(2);
    expect(r.errorCountRangeGe2).toBe(1);
    expect(r.unanimous).toBe(1);
  });

  it("orders each row by perturbation, not by manifest or caseId order", async () => {
    const base = makeSuite([
      [
        { accuracy: 1, errors: 1 },
        { accuracy: 2, errors: 2 },
        { accuracy: 3, errors: 3 },
      ],
    ]);
    const r = await measureJudgeVariance(base, "scores");
    // Written reversed in the manifest; must come back in RESPONSE_PRESERVING order.
    expect(r.sources[0].accuracy).toEqual([1, 2, 3]);
    expect(r.sources[0].errorCounts).toEqual([1, 2, 3]);
  });

  it("excludes a source with an incomplete triplet instead of scoring it short", async () => {
    const base = makeSuite([
      [
        { accuracy: 3, errors: 0 },
        { accuracy: 5, errors: 0 },
        { accuracy: 4, errors: 0 },
      ],
      [
        { accuracy: 1, errors: 9 },
        { accuracy: 5, errors: 0 },
        { accuracy: 3, errors: 4 },
      ],
    ]);
    // Drop one file from source 2 — a partial triplet must not contribute a
    // (smaller, flattering) range.
    const { unlinkSync } = await import("fs");
    unlinkSync(join(base, "judge-calibration", "scores", "case-05.json"));

    const r = await measureJudgeVariance(base, "scores");
    expect(r.complete).toBe(1);
    expect(r.incomplete).toBe(1);
    expect(r.accuracyRangeMax).toBe(2);
    expect(r.errorCountRangeMax).toBe(0);
  });

  it("hashes the exact bytes consumed so a mid-write read is detectable", async () => {
    const base = makeSuite([
      [
        { accuracy: 3, errors: 1 },
        { accuracy: 3, errors: 1 },
        { accuracy: 3, errors: 1 },
      ],
    ]);
    const first = await measureJudgeVariance(base, "scores");
    expect((await measureJudgeVariance(base, "scores")).inputHash).toBe(
      first.inputHash,
    );

    writeFileSync(
      join(base, "judge-calibration", "scores", "case-01.json"),
      JSON.stringify({ factAudit: [], response: { accuracy: 3 } }),
    );
    expect((await measureJudgeVariance(base, "scores")).inputHash).not.toBe(
      first.inputHash,
    );
  });
});
