/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t110 `healerLockOmitted` / `healerLockUnbacked` (T110, batch review
 * 80-PIPE-80-B75): the kill-window line is read in both rendered forms — the
 * DPS view's `[KILL WINDOW] 0:10–0:20 on …` and the healer view's
 * `[VULNERABLE] 0:10–0:20 (10s) on …` (`healerOffenseAnalysis.ts`), whose
 * span length sits between the range and "on".
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { KW_RE, run } from "../scripts/scan5/t110";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;

/** Sin and Punishment on the enemy healer 12–15 s, from our side */
const horror = (event: string, s: number) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  spellId: "87204",
  spellName: "Sin and Punishment",
  srcUnitId: "f1",
  srcUnitName: "f1",
  destUnitId: "e1",
  destUnitName: "e1",
});

function scan(line: string, locked: boolean) {
  const counts: Record<string, { checked: number; violations: number }> = {};
  const c = (k: string) => (counts[k] ??= { checked: 0, violations: 0 });
  const f1 = { id: "f1", name: "f1", reaction: 1, auraEvents: [] };
  const e1 = {
    id: "e1",
    name: "e1",
    reaction: 2,
    spec: CombatUnitSpec.Priest_Discipline,
    auraEvents: locked
      ? [
          horror(LogEvent.SPELL_AURA_APPLIED, 12),
          horror(LogEvent.SPELL_AURA_REMOVED, 15),
        ]
      : [],
  };
  const units = [f1, e1];
  run({
    lines: [line],
    menu: "",
    start: START,
    owner: f1,
    players: units,
    units,
    legacy: {
      startTime: START,
      endTime: at(300),
      units: { f1, e1 },
    },
    bump: (k: string) => c(k).checked++,
    violate: (k: string) => c(k).violations++,
  } as any);
  return counts;
}

const TAIL =
  "team offensive CDs ready at 0:10: Avatar; enemy healer hard-CC'd in window; you cast no CC.";
const DPS = `  [KILL WINDOW] 0:10–0:20 on Discipline Priest (e1): team burst 300k; ${TAIL}`;
const HEALER = `  [VULNERABLE] 0:10–0:20 (10s) on Discipline Priest (e1): no major defensives, never punished; ${TAIL}`;
const omit = (l: string) => l.replace(" enemy healer hard-CC'd in window;", "");

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t110 kill-window healer lock (T110)", () => {
  it("KW_RE reads both forms", () => {
    expect(KW_RE.exec(DPS)?.slice(1, 4)).toEqual([
      "KILL WINDOW",
      "0:10",
      "0:20",
    ]);
    expect(KW_RE.exec(HEALER)?.slice(1, 4)).toEqual([
      "VULNERABLE",
      "0:10",
      "0:20",
    ]);
  });

  for (const [form, line] of [
    ["DPS", DPS],
    ["healer", HEALER],
  ] as const) {
    it(`${form} form: the clause with no lock near is unbacked`, () => {
      expect(scan(line, false)["healerLockUnbacked"]).toEqual({
        checked: 1,
        violations: 1,
      });
    });
    it(`${form} form: no clause while a lock overlaps is omitted`, () => {
      expect(scan(omit(line), true)["healerLockOmitted"]).toEqual({
        checked: 1,
        violations: 1,
      });
    });
    it(`${form} form: the clause backed by the lock passes`, () => {
      expect(scan(line, true)["healerLockUnbacked"]).toEqual({
        checked: 1,
        violations: 0,
      });
    });
  }
});
