/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `immuneHitPetFold` (T51, codex 85-tk-H-T51-1b): which aura run an
 * `[ENEMY DEF] … | during it:` line's `N hits immune` is counted over.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitType, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t51";

const START = 1_000_000;
const at = (ms: number): number => START + ms;
const IRONBARK = "102342";
let ix = 0;
const aura = (event: string, ms: number, srcUnitId: string) => ({
  timestamp: at(ms),
  logLine: { event, timestamp: at(ms), lineIndex: ix++ },
  spellId: IRONBARK,
  spellName: "Ironbark",
  srcUnitId,
});
const immune = (ms: number) => ({
  timestamp: at(ms),
  logLine: {
    event: LogEvent.SWING_MISSED,
    timestamp: at(ms),
    lineIndex: ix++,
  },
  spellId: "0",
  missType: "IMMUNE",
  destUnitId: "Target",
});

function scan(
  casterPid: string,
  stamp: string,
  printed: number,
  auraEvents: any[],
  petRows: any[],
): { checked: number; details: string[] } {
  const ally = {
    id: "Ally",
    pid: "1",
    type: CombatUnitType.Player,
    missesOut: [],
  };
  const units = [
    ally,
    { id: "Target", pid: "2", auraEvents },
    { id: "A", pid: "3" },
    { id: "B", pid: "4" },
    {
      id: "Pet",
      type: CombatUnitType.Pet,
      ownerId: "Ally",
      missesOut: petRows,
    },
  ];
  let checked = 0;
  const details: string[] = [];
  run({
    lines: [
      `${stamp}  [ENEMY DEF]   ${casterPid}(Druid) (druid): Ironbark → 2(Target) (5.0s) | during it: 1(Ally) 10k on target · ${printed} hits immune · 100% of their enemy-player damage`,
    ],
    start: START,
    roundEndAt: at(600_000),
    units,
    unitOfPid: (pid: string | undefined) =>
      units.find((u: any) => u.pid === pid),
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("immuneHitPetFold — the wall's own run", () => {
  it("reads the line's caster's aura, not another caster's of the same name", () => {
    const auras = [
      aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "A"),
      aura(LogEvent.SPELL_AURA_APPLIED, 10_800, "B"),
      aura(LogEvent.SPELL_AURA_REMOVED, 12_000, "A"),
      aura(LogEvent.SPELL_AURA_REMOVED, 16_000, "B"),
    ];
    const hit = [immune(14_000)];
    // B's line: the hit is inside B's run
    expect(scan("4", "0:10", 0, auras, hit).details).toHaveLength(1);
    expect(scan("4", "0:10", 1, auras, hit).details).toEqual([]);
    // A's line: its run ended at 12 s
    expect(scan("3", "0:10", 0, auras, hit)).toEqual({
      checked: 0,
      details: [],
    });
  });

  it("a wall put back 100 ms after its REMOVED is another line's run", () => {
    const auras = [
      aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "A"),
      aura(LogEvent.SPELL_AURA_REMOVED, 15_000, "A"),
      aura(LogEvent.SPELL_AURA_APPLIED, 15_100, "A"),
      aura(LogEvent.SPELL_AURA_REMOVED, 20_000, "A"),
    ];
    expect(scan("3", "0:10", 0, auras, [immune(17_000)])).toEqual({
      checked: 0,
      details: [],
    });
  });

  it("a wall re-stated in its REMOVED's own millisecond goes on", () => {
    const auras = [
      aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "A"),
      aura(LogEvent.SPELL_AURA_REMOVED, 15_000, "A"),
      aura(LogEvent.SPELL_AURA_APPLIED, 15_000, "A"),
      aura(LogEvent.SPELL_AURA_REMOVED, 20_000, "A"),
    ];
    expect(scan("3", "0:10", 0, auras, [immune(17_000)]).details).toHaveLength(
      1,
    );
  });

  it("a hit in the APPLIED row's millisecond, logged after it, is inside", () => {
    const auras = [aura(LogEvent.SPELL_AURA_APPLIED, 11_200, "A")];
    const hit = [immune(11_200)];
    auras.push(aura(LogEvent.SPELL_AURA_REMOVED, 16_200, "A"));
    expect(scan("3", "0:10", 0, auras, hit).details).toHaveLength(1);
  });

  it("a hit in the REMOVED row's millisecond counts only when logged before it", () => {
    const applied = aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "A");
    const before = immune(15_000);
    const removed = aura(LogEvent.SPELL_AURA_REMOVED, 15_000, "A");
    const after = immune(15_000);
    expect(
      scan("3", "0:10", 0, [applied, removed], [before]).details,
    ).toHaveLength(1);
    expect(scan("3", "0:10", 0, [applied, removed], [after])).toEqual({
      checked: 0,
      details: [],
    });
  });
});
