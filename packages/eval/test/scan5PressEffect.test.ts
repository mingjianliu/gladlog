/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/pressEffect `noPressButPressed` driven through `run(ctx)` on lines
 * rendered from the producer's own events (`enemyDefensiveEvents`, in its
 * order, as `enemyDef.ts` prints them). A `[no press logged]` line is a
 * proc's own (T259 / B192: Well-Honed Instincts' Frenzied Regeneration) only
 * when the producer's event behind that very line says so — the scan reads
 * the owner, it does not work it out from the aura rows again.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { enemyDefensiveEvents } from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { ownEventOfLine, run } from "../scripts/scan5/pressEffect";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const FR = "22842";
const MARKER = "382912";
const TAG = " [no press logged]";

const aura = (event: LogEvent, id: string, s: number) =>
  makeAuraEvent(event, id, at(s), "p1", "p1", "BUFF");
const applied = (s: number) => aura(LogEvent.SPELL_AURA_APPLIED, FR, s);
const refresh = (s: number) => aura(LogEvent.SPELL_AURA_REFRESH, FR, s);
const marker = (s: number) => aura(LogEvent.SPELL_AURA_APPLIED, MARKER, s);
const press = (s: number) =>
  makeSpellCastEvent(
    FR,
    at(s),
    "p1",
    "p1",
    "p1",
    "p1",
    0,
    "Frenzied Regeneration",
  );

/** The round, the producer's events of the druid, and the scan's verdict on
 * their lines after `retag` (the tag each line carries, by rendered order). */
function scan(
  casts: number[],
  auras: ReturnType<typeof makeAuraEvent>[],
  retag?: (tagged: boolean[]) => boolean[],
) {
  const druid = makeUnit("p1", {
    name: "Druid",
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Feral,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: casts.map(press),
    // log order as given: rows of one millisecond keep it
    auraEvents: auras,
  } as any);
  const combat = {
    startTime: T0,
    endTime: T0 + 300_000,
    units: { p1: druid },
  };
  const events = enemyDefensiveEvents(
    druid,
    [druid],
    combat as any,
    combat.endTime,
  ).filter((e) => e.spellName === "Frenzied Regeneration");
  const produced = events.map((e) => e.noPressLogged === true);
  const tags = retag ? retag(produced) : produced;
  const lines = events.map((e, i) => {
    const t = Math.floor(e.atSeconds);
    const mss = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    return `${mss}  [ENEMY DEF]   2(Feral) (Feral Druid): Frenzied Regeneration (heal)${tags[i] ? TAG : ""} (at 40% HP)`;
  });
  const checked: Record<string, number> = {};
  const violations: { check: string; line: string }[] = [];
  run({
    lines,
    unitOfPid: (pid: string) => (pid === "2" ? druid : undefined),
    players: [druid],
    units: [druid],
    legacy: combat,
    start: T0,
    bump: (c: string, n = 1) => (checked[c] = (checked[c] ?? 0) + n),
    violate: (
      check: string,
      _k: string,
      _t: number,
      _f: string,
      _d: string,
      line: string,
    ) => violations.push({ check, line }),
  } as any);
  return {
    produced,
    procOwned: events.map((e) => e.procOwned === true),
    flagged: violations
      .filter((v) => v.check === "noPressButPressed")
      .map((v) => lines.indexOf(v.line)),
  };
}
const swap = (t: boolean[]) => t.map((x) => !x);
const all = (t: boolean[]) => t.map(() => true);

describe("scan5/pressEffect run — a proc's line beside the player's own press", () => {
  // 11346ea9 r1 1:53: APPLIED .197, the press .198, the proc's REFRESH +
  // marker at .937
  const druid = (retag?: (t: boolean[]) => boolean[]) =>
    scan(
      [113.198],
      [applied(113.197), refresh(113.937), marker(113.937)],
      retag,
    );
  it("as rendered: the press's line untagged, the proc's tagged — nothing flagged", () => {
    const r = druid();
    expect(r.produced).toEqual([false, true]);
    expect(r.procOwned).toEqual([false, true]);
    expect(r.flagged).toEqual([]);
  });
  it("B192 reviews 1 / 2: both tagged, or the tags swapped — the press's line is flagged", () => {
    expect(druid(all).flagged).toEqual([0]);
    expect(druid(swap).flagged).toEqual([0]);
  });

  // bf679e40 r1: the proc 0:52.172, the druid's press beside its own REFRESH
  // at 0:53.500 — two seconds, one line each
  const twoSeconds = (retag?: (t: boolean[]) => boolean[]) =>
    scan([53.5], [applied(52.172), marker(52.172), refresh(53.5)], retag);
  it("B192 stack check: a press a second after the proc does not flag the proc's line", () => {
    const r = twoSeconds();
    expect(r.produced).toEqual([true, false]);
    expect(r.flagged).toEqual([]);
  });
  it("B192 reviews 4 / 5: the tag moved to the press of the next second is flagged", () => {
    expect(twoSeconds(swap).flagged).toEqual([1]);
    expect(twoSeconds(all).flagged).toEqual([1]);
  });

  // B192 review 9 (constructed): APPLIED, REFRESH, a fresh marker and the
  // cast row all in one millisecond — the producer puts the press first
  const tie = (retag?: (t: boolean[]) => boolean[]) =>
    scan([10.2], [applied(10.2), refresh(10.2), marker(10.2)], retag);
  it("B192 review 9: rows of one millisecond — the owner is the producer's, in its order", () => {
    const r = tie();
    expect(r.produced).toHaveLength(2);
    const proc = r.procOwned.indexOf(true);
    expect(proc).toBeGreaterThanOrEqual(0);
    expect(r.produced[proc]).toBe(true);
    expect(r.flagged).toEqual([]);
    // the tag moved to the player's press: that line is flagged
    expect(tie(swap).flagged).toEqual([1 - proc]);
  });
});

describe("scan5/pressEffect ownEventOfLine", () => {
  const evs = [{ atSeconds: 10.2 }, { atSeconds: 10.2, procOwned: true }];
  it("pairs lines and events one to one, in order", () => {
    expect(ownEventOfLine(1, 2, evs)).toBe(evs[1]);
    expect(ownEventOfLine(0, 2, evs)).toBe(evs[0]);
  });
  it("counts that differ give no owner — nothing is exempt", () => {
    expect(ownEventOfLine(0, 1, evs)).toBeUndefined();
    expect(ownEventOfLine(2, 3, evs)).toBeUndefined();
  });
});
