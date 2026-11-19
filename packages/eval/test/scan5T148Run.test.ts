/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/t148 driven through `run(ctx)` on the raw rows of the round the
 * batch review found unchecked (80-PIPE-145-B131, eadf9636 r4): Arcane
 * Surge completed 28.711 → 30.549; begun 215.023, stopped by its owner at
 * 216.421 ("Interrupted") and begun again in that millisecond; an enemy
 * Pummel out at 216.478 that interrupted nothing; no row ends the second
 * bar; Blink out at 217.861. The stop row is the FIRST bar's end, so the
 * second bar is a rowless bar under an on-GCD press, and the round's
 * printed `yourCancels` has to count both.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t148";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const ARCANE_SURGE = "365350";
const BLINK = "1953";
const PUMMEL = "6552";

const start = (spellId: string, s: number) => ({
  ...makeSpellCastEvent(spellId, at(s), "e1", "Enemy", "p1", "Me"),
  logLine: {
    event: LogEvent.SPELL_CAST_START,
    timestamp: at(s),
    parameters: [],
  },
});
const success = (spellId: string, s: number) =>
  makeSpellCastEvent(spellId, at(s), "p1", "Me", "p1", "Me");
const fail = (spellId: string, s: number, reason: string) => ({
  tSeconds: s,
  unitGuid: "p1",
  spellId: Number(spellId),
  spellName: spellId,
  reason,
});

function scan(printedCancels: number) {
  const owner = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
    info: {},
    castStartEvents: [28.711, 215.023, 216.421].map((s) =>
      start(ARCANE_SURGE, s),
    ),
    spellCastEvents: [success(ARCANE_SURGE, 30.549), success(BLINK, 217.861)],
  } as any);
  const enemy = makeUnit("e1", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
    info: {},
    spellCastEvents: [
      makeSpellCastEvent(PUMMEL, at(216.478), "p1", "Me", "e1", "Enemy"),
    ],
  } as any);
  const combat = {
    startTime: T0,
    endTime: at(218.5),
    units: { p1: owner, e1: enemy },
  };
  const streams = {
    available: true,
    manaSamples: [],
    castFailed: [
      fail("321507", 212.17, "Not yet recovered"),
      fail(ARCANE_SURGE, 216.421, "Interrupted"),
    ],
  };
  const checked: Record<string, number> = {};
  const violations: { check: string; kind: string; detail: string }[] = [];
  run({
    firstOwnerOfRound: true,
    rawStreams: () => streams,
    players: [owner, enemy],
    units: [owner, enemy],
    owner,
    legacy: combat,
    start: T0,
    menu: `  - id=kick-eaten:p1:108 type=kick-eaten t=108.4s units=Me/Enemy facts={t=108.4, interrupted=Arcane Surge, kick=Pummel, yourCancels=${printedCancels}, baitedKicks=0}`,
    bump: (c: string, n = 1) => (checked[c] = (checked[c] ?? 0) + n),
    violate: (check: string, kind: string, _t: number, _f: string, d: string) =>
      violations.push({ check, kind, detail: d }),
  } as any);
  return { checked, violations };
}

describe("scan5/t148 run — a stop and a restart in one millisecond (80-PIPE-145-B131)", () => {
  it("the restarted bar is found from the rows and is a cancel of the ledger", () => {
    const r = scan(2);
    // the bar begun 216.421: the stop row of that millisecond is the bar
    // before it, so this one has no end row
    expect(r.checked.pressOverBarNotCancel).toBe(1);
    expect(
      r.violations.filter((v) => v.check === "pressOverBarNotCancel"),
    ).toEqual([]);
  });
  it("the printed count is checked: the base's count (one short) fails, the right count passes", () => {
    // base product: the logged stop only → yourCancels=1 (the round's 13)
    const base = scan(1);
    expect(base.checked.kickEatenCancelsShort).toBe(1);
    expect(
      base.violations
        .filter((v) => v.check === "kickEatenCancelsShort")
        .map((v) => v.kind),
    ).toEqual(["short by 1"]);
    // the logged stop + the rowless bar → 2 (the round's 14)
    const fixed = scan(2);
    expect(fixed.checked.kickEatenCancelsShort).toBe(1);
    expect(
      fixed.violations.filter((v) => v.check === "kickEatenCancelsShort"),
    ).toEqual([]);
  });
});
