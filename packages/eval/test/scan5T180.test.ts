/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context and the engine's points are fakes */
/**
 * scan5/t180's two inventories (`ignoredHealCdById`, `selfOnlyRowsHealCd`)
 * count ruled behaviour — another teammate's self-only healing CD, ignored
 * (R75) — and never reach a check's total (assembly review
 * 80-PIPE-169b-B155: two correctly ignored Dark Pacts read as two failures).
 * Read through the runner's own rule: a kind is in the total unless the
 * module lists `${check}|${kind}` in `OUT_OF_TOTAL`.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

const points = vi.hoisted(() => ({ value: [] as any[] }));
vi.mock(
  "@gladlog/analysis/src/analysis/burstWindowDecisionPoints",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    burstWindowDecisionPoints: () => points.value,
  }),
);

import { OUT_OF_TOTAL, run } from "../scripts/scan5/t180";

beforeAll(async () => {
  await ensureAnalysisData();
});

const press = (over: object) => ({
  category: "healCd",
  casterId: "F2",
  casterName: "Mate",
  tSec: 12,
  latencySec: 1,
  ...over,
});
const window = (responseCasts: any[], over: object = {}) => ({
  tSec: 11,
  tMs: 1_011_000,
  durationSec: 8,
  feasible: true,
  triaged: true,
  responded: false,
  responses: { kite: false, attackerMoved: false },
  leadCd: { spellId: "360194", spellName: "Deathmark" },
  pressured: { unitId: "F1", name: "Pressed", minHpPct: 30, minHpSec: 15 },
  responseCasts,
  ...over,
});

function scan(pts: any[]) {
  points.value = pts;
  const seen: string[] = [];
  run({
    roundKey: "r",
    start: 1_000_000,
    owner: { reaction: 1, spec: CombatUnitSpec.Priest_Holy },
    legacy: {},
    bump: () => {},
    violate: (c: string, k: string) => {
      seen.push(`${c}|${k}`);
    },
  } as any);
  return { seen, failures: seen.filter((k) => !OUT_OF_TOTAL.has(k)) };
}

describe("scan5 t180 inventories", () => {
  it("two Dark Pacts by another unit, both ignored: counted, 0 failures", () => {
    const pact = (tSec: number) =>
      press({ spellId: "108416", spellName: "Dark Pact", tSec });
    const r = scan([window([pact(12)]), window([pact(59)], { tSec: 58 })]);
    expect(r.seen).toEqual([
      "ignoredHealCdById|108416",
      "ignoredHealCdById|108416",
    ]);
    expect(r.failures).toEqual([]);
  });

  it("a heal whose rows are on its caster alone with no self-only verdict: counted, 0 failures", () => {
    const communion = press({
      spellId: "370960",
      spellName: "Emerald Communion",
      selfOnlyEffect: true,
    });
    const r = scan([window([communion], { responded: true })]);
    // the window is also inventoried as answered by a press the credit
    // line refuses — likewise out of the total
    expect(r.seen).toEqual([
      "selfOnlyRowsHealCd|370960 | counts for the candidate, no creditable answer in the window",
      "respondedOnRefusedPress|other",
    ]);
    expect(r.failures).toEqual([]);
  });

  it("the total still holds a real failure: a window answered by the ignored press alone", () => {
    const pact = press({ spellId: "108416", spellName: "Dark Pact" });
    const r = scan([window([pact], { responded: true })]);
    expect(r.failures).toEqual([
      "respondedOnElsewherePress|only ignored presses",
    ]);
  });
});
