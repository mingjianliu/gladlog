/**
 * scan5 `healingBlockOffHealer` (T121, codex 85-tk-L-T121-2): the press is
 * read whatever its target / HP part.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t121";

function scan(cdLine: string, spec: CombatUnitSpec): number {
  let n = 0;
  run({
    owner: { id: "o", spec },
    lines: [cdLine, "      [HEALING]    0–5s: 18.8k HPS | Overheal: 7%"],
    start: 0,
    bump: () => {},
    violate: () => n++,
  } as never);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 healingBlockOffHealer", () => {
  const forms = [
    "0:27  [YOU] [CD]   Power Infusion (self: 80% HP, +1%/s, 109k DPS)",
    "0:27  [YOU] [CD]   Power Infusion → 2(AWarrior) (80% HP, 0k DPS)",
    "0:27  [YOU] [CD]   Power Infusion",
  ];
  it("flags each form under a Shadow Priest", () => {
    for (const l of forms)
      expect(scan(l, CombatUnitSpec.Priest_Shadow), l).toBe(1);
  });
  it("passes each form under a Holy Priest", () => {
    for (const l of forms)
      expect(scan(l, CombatUnitSpec.Priest_Holy), l).toBe(0);
  });
});
