/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `answerTimedBeforeItsCast` (T43, codex 85-tk-H-T43-1): which cast row
 * the check holds a `[BURST ANSWERED] … in Z.Zs` line to when the answer's
 * SUCCESS row is logged just after its aura.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t43";

const START = 1_000_000;
const at = (ms: number): number => START + ms;
const row = (event: string, ms: number, extra: Record<string, unknown>) => ({
  timestamp: at(ms),
  logLine: { event, timestamp: at(ms) },
  ...extra,
});
const cast = (ms: number, spellId: string, destUnitId?: string) =>
  row(LogEvent.SPELL_CAST_SUCCESS, ms, { spellId, destUnitId });
const applied = (ms: number, spellId: string) =>
  row(LogEvent.SPELL_AURA_APPLIED, ms, { spellId, srcUnitId: "F1" });

const SHADOW_DANCE = "185313";
const RAKE = "1822";
const RAKE_STUN = "163505";
const HUNT_PRESS = "1246167";
const HUNT_IMPACT = "1246169";
const HUNT_ROOT = "370970";

function scan(
  answer: string,
  printed: string,
  answers: any[],
  auraId: string,
): { checked: number; details: string[] } {
  const players = [
    {
      id: "E1",
      pid: "1",
      spellCastEvents: [cast(12_326, SHADOW_DANCE)],
      auraEvents: [applied(13_454, auraId)],
    },
    { id: "E2", pid: "2", spellCastEvents: [], auraEvents: [] },
    { id: "F1", pid: "4", spellCastEvents: answers, auraEvents: [] },
  ];
  let checked = 0;
  const details: string[] = [];
  run({
    lines: [
      `0:12 [BURST ANSWERED] enemy opened Shadow Dance (1(Rogue)): 4(Druid) answered with ${answer} on 1(Rogue) (stun) in ${printed}s; nothing else`,
    ],
    start: START,
    unitOfPid: (pid: string | undefined) => players.find((p) => p.pid === pid),
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("answerTimedBeforeItsCast", () => {
  it("reads a line timed from the cast row logged just after the aura", () => {
    const r = scan("Rake", "1.1", [cast(13_456, RAKE, "E1")], RAKE_STUN);
    expect(r).toEqual({ checked: 1, details: [] });
  });

  it("flags a line timed from an earlier cast of it on another enemy", () => {
    const answers = [cast(12_400, RAKE, "E2"), cast(13_456, RAKE, "E1")];
    expect(scan("Rake", "1.1", answers, RAKE_STUN)).toEqual({
      checked: 1,
      details: [],
    });
    const wrong = scan("Rake", "0.1", answers, RAKE_STUN);
    expect(wrong.checked).toBe(1);
    expect(wrong.details).toHaveLength(1);
  });

  it("a cast of it on another enemy just after the aura is no pair", () => {
    expect(
      scan("Rake", "0.9", [cast(13_456, RAKE, "E2")], RAKE_STUN).checked,
    ).toBe(0);
  });

  it("holds a press with an impact row to the press, not the impact", () => {
    const answers = [
      cast(13_000, HUNT_PRESS, "E1"),
      cast(13_456, HUNT_IMPACT, "E1"),
    ];
    expect(scan("The Hunt", "0.7", answers, HUNT_ROOT)).toEqual({
      checked: 1,
      details: [],
    });
    expect(scan("The Hunt", "1.1", answers, HUNT_ROOT).details).toHaveLength(1);
  });
});
