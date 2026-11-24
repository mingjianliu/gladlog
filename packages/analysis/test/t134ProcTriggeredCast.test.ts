/**
 * T134 — the activation a low-HP proc made is no press of the cooldown it
 * casts: Well-Honed Instincts' Frenzied Regeneration (its aura in the batch
 * of marker 382912, no cast row) spends no charge. One pairing
 * (`isProcOwnActivationAt`) for the readers that take an aura as an
 * activation; a cast row is always a press.
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { unitCooldownEntry } from "../src/utils/cooldowns";
import { isAvailableAt } from "../src/utils/deathOutcomeAnalysis";
import { selfSaveCasts } from "../src/utils/enemyDefensives";
import { hiddenPressMs, ownAuraUpBeforeRow } from "../src/utils/hiddenPress";
import {
  isProcOwnActivationAt,
  ownProcMarkers,
  PROC_OWN_ACTIVATION_PAIR_MS,
} from "../src/utils/procTriggeredCast";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const FR = "22842";
const MARKER = "382912";

beforeAll(async () => {
  await ensureAnalysisData();
});

const marker = (s: number, src = "p1") =>
  makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, MARKER, at(s), src, "p1", "BUFF");
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

function druid(
  castSeconds: number[],
  markerSeconds: number[],
  extra: ReturnType<typeof makeAuraEvent>[] = [],
) {
  return makeUnit("p1", {
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Feral,
    spellCastEvents: castSeconds.map(press),
    auraEvents: [...markerSeconds.map((s) => marker(s)), ...extra].sort(
      (a, b) =>
        (a as { timestamp: number }).timestamp -
        (b as { timestamp: number }).timestamp,
    ),
  });
}
const combatOf = (u: ReturnType<typeof makeUnit>) =>
  ({
    startTime: START,
    endTime: START + 300_000,
    units: { p1: u },
  }) as unknown as AtomicArenaCombat;

describe("isProcOwnActivationAt", () => {
  it("pairs a cast of the proc's spell with the unit's own marker, inside the tolerance", () => {
    const u = druid([], [45]);
    expect(ownProcMarkers(u).map((m) => m.t)).toEqual([at(45)]);
    expect(isProcOwnActivationAt(u, FR, at(45))).toBe(true);
    expect(
      isProcOwnActivationAt(u, FR, at(45) + PROC_OWN_ACTIVATION_PAIR_MS),
    ).toBe(true);
    expect(
      isProcOwnActivationAt(u, FR, at(45) + PROC_OWN_ACTIVATION_PAIR_MS + 1),
    ).toBe(false);
    // another spell is not the proc's
    expect(isProcOwnActivationAt(u, "22812", at(45))).toBe(false);
  });

  it("a marker another unit put up is no proc of this unit's", () => {
    const u = makeUnit("p1", { auraEvents: [marker(45, "p2")] });
    expect(isProcOwnActivationAt(u, FR, at(45))).toBe(false);
  });
});

describe("the cooldown ledger", () => {
  it("a cast row is always a press, however close to the marker (codex 85-tk-CD-T134-1 #2)", () => {
    // the player's press at 44.75, the proc 50 ms later
    const u = druid([44.75], [44.8]);
    expect(
      unitCooldownEntry(u, combatOf(u), FR)!.casts.map((c) => c.timeSeconds),
    ).toEqual([44.75]);
    expect(isAvailableAt(u, FR, 36, 50, START)).toBe(false);
  });

  it("18e3feae r4 shape: a cast row a second after the proc is the player's press", () => {
    const u = druid([42.8], [41.76]);
    expect(
      unitCooldownEntry(u, combatOf(u), FR)!.casts.map((c) => c.timeSeconds),
    ).toEqual([42.8]);
  });
});

describe("hiddenPressMs", () => {
  const batch = (s: number, withMarker: boolean) => [
    ...["1126", "21562", "6673", "1459", "462854", "110310"].map((id) =>
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, id, at(s), "p1", "p1", "BUFF"),
    ),
    makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FR, at(s), "p1", "p1", "BUFF"),
    ...(withMarker ? [marker(s)] : []),
  ];
  it("an aura new in a re-stating batch is a press made unseen", () => {
    const u = druid([], [], batch(44.8, false));
    expect(hiddenPressMs(u, FR, START)).toEqual([at(44.8)]);
  });
  it("…but not beside the proc's marker: the ledger and the death block hold no press", () => {
    const u = druid([19.3], [], batch(44.8, true));
    expect(hiddenPressMs(u, FR, START)).toEqual([]);
    expect(
      unitCooldownEntry(u, combatOf(u), FR)!.casts.map((c) => c.timeSeconds),
    ).toEqual([19.3]);
    // pressed 19.3: back at 55.3, not a cooldown after the proc
    expect(isAvailableAt(u, FR, 36, 56, START)).toBe(true);
  });
});

describe("selfSaveCasts (the enemy's [ENEMY DEF] presses)", () => {
  const frAura = (s: number) =>
    makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FR, at(s), "p1", "p1", "BUFF");
  it("18e3feae r4 shape: the proc is stated with no press, the press a second later is its own", () => {
    const u = druid([42.8], [41.76], [frAura(41.76)]);
    expect(
      selfSaveCasts(u, START).map((c) => [c.atSeconds, !!c.noPressLogged]),
    ).toEqual([
      [41.76, true],
      [42.8, false],
    ]);
  });
  it("without the marker the aura is the press's own", () => {
    const u = druid([42.8], [], [frAura(41.76)]);
    expect(
      selfSaveCasts(u, START).map((c) => [c.atSeconds, !!c.noPressLogged]),
    ).toEqual([[42.8, false]]);
  });
});

describe("selfSaveCasts: a re-listed proc aura (codex 85-tk-CD-T134-1 #1)", () => {
  it("4faf00ba shape: up with its marker, both re-listed 1.6 s later with no REMOVED — one line", () => {
    const fr = (s: number) =>
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FR, at(s), "p1", "p1", "BUFF");
    const u = druid([], [304.588, 306.233], [fr(304.588), fr(306.232)]);
    expect(selfSaveCasts(u, START).map((c) => c.atSeconds)).toEqual([304.588]);
  });
});

describe("selfSaveCasts: an aura is up only within its life, not until a REMOVED (T259)", () => {
  const fr = (s: number, ev = LogEvent.SPELL_AURA_APPLIED) =>
    makeAuraEvent(ev, FR, at(s), "p1", "p1", "BUFF");
  const lines = (u: ReturnType<typeof druid>) =>
    selfSaveCasts(u, START).map((c) => [c.atSeconds, !!c.noPressLogged]);
  it("8416188b r1 shape: pressed, no REMOVED, re-listed in a batch 1.3 s later, the proc 4.75 s after the press — its line stays", () => {
    // pressed 117.596 (cast row + aura), re-listed 118.885, the proc 122.347
    // with its marker and no cast row
    const u = druid(
      [117.596],
      [122.347],
      [fr(117.596), fr(118.885), fr(122.347)],
    );
    expect(lines(u)).toEqual([
      [117.596, false],
      [122.347, true],
    ]);
  });
  it("a first marker 3.5 s after a press with no REMOVED is a new proc — the saved aura's clock is not asked (codex 85-mac-minifix-T259-1 #1)", () => {
    const u = druid([100], [103.5], [fr(100), fr(103.5)]);
    expect(lines(u)).toEqual([
      [100, false],
      [103.5, true],
    ]);
  });
  it("a press beside a re-listed marker is the press, not a proc (codex 85-mac-minifix-T259-1 #1)", () => {
    // proc 100 (no REMOVED of either), pressed 130.000, a batch at 130.050
    // re-lists the aura and the marker still inside its 120 s lockout
    const u = druid([130], [100, 130.05], [fr(100), fr(130), fr(130.05)]);
    expect(lines(u)).toEqual([
      [100, true],
      [130, false],
    ]);
  });
  it("the marker's lockout ends at its life: a marker past it is a new proc, one inside it a re-listing", () => {
    // 382912: 120 s, + the 1 s lost-REMOVED slack; a press in the marker's
    // batch shows which: inside the lockout the aura is the press's alone
    expect(lines(druid([220.9], [100, 220.9], [fr(100), fr(220.9)]))).toEqual([
      [100, true],
      [220.9, false],
    ]);
    expect(lines(druid([221.1], [100, 221.1], [fr(100), fr(221.1)]))).toEqual([
      [100, true],
      [221.1, false],
      [221.1, true],
    ]);
  });
  it("one marker is one activation: a second aura row beside it states nothing more", () => {
    const u = druid([], [100], [fr(100), fr(100.02)]);
    expect(lines(u)).toEqual([[100, true]]);
  });
  it("a re-broadcast marker beside a press is no proc (codex 85-mac-minifix-T259-1b #1)", () => {
    // proc 10 (no REMOVED of the aura), the marker re-broadcast 40.000 /
    // 40.001, the player's press and its aura at 40.001
    const u = druid(
      [40.001],
      [10, 40.001],
      [
        fr(10),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          MARKER,
          at(40),
          "p1",
          "p1",
          "BUFF",
        ),
        fr(40.001),
      ],
    );
    expect(lines(u)).toEqual([
      [10, true],
      [40.001, false],
    ]);
  });
  it("an aura new beside a still-running marker, its earlier run REMOVED and no press, is stated with no press (codex 85-mac-minifix-T259-1b #2)", () => {
    const u = druid(
      [],
      [10, 40],
      [fr(10), fr(13, LogEvent.SPELL_AURA_REMOVED), fr(40)],
    );
    expect(lines(u)).toEqual([
      [10, true],
      [40, true],
    ]);
  });
  it("12dc512f r3 shape: a proc that refreshes the aura a press put up is its own activation (codex 85-mac-minifix-T259-1b #3)", () => {
    const u = druid(
      [174.755],
      [176.348],
      [fr(174.755), fr(176.347, LogEvent.SPELL_AURA_REFRESH)],
    );
    expect(lines(u)).toEqual([
      [174.755, false],
      [176.347, true],
    ]);
    // a REFRESH with no fresh marker beside it states nothing
    const v = druid(
      [174.755],
      [],
      [fr(174.755), fr(176.347, LogEvent.SPELL_AURA_REFRESH)],
    );
    expect(lines(v)).toEqual([[174.755, false]]);
  });
  it("11dfa802 r3 shape: the marker pairs the closest aura row — the proc's REFRESH, not the press's APPLIED (codex 85-mac-minifix-T259-1c #2)", () => {
    // the press's APPLIED 99.950 (cast row 99.951), the proc's REFRESH
    // 100.040, its marker 100.041
    const u = druid(
      [99.951],
      [100.041],
      [fr(99.95), fr(100.04, LogEvent.SPELL_AURA_REFRESH)],
    );
    expect(lines(u)).toEqual([
      [99.951, false],
      [100.04, true],
    ]);
  });
  it("a re-listing one second into a confirmed proc is that proc (codex 85-mac-minifix-T259-1c #1)", () => {
    // pressed 100 (no REMOVED), the proc 103.5, both re-listed 104.5
    const u = druid([100], [103.5, 104.5], [fr(100), fr(103.5), fr(104.5)]);
    expect(lines(u)).toEqual([
      [100, false],
      [103.5, true],
    ]);
  });
  it("ownAuraUpBeforeRow: a re-listing does not restart the run's clock; a REFRESH does; a REMOVED ends it", () => {
    const u = druid([], []);
    const rowsOf = (...xs: ReturnType<typeof fr>[]) =>
      makeUnit("p1", { auraEvents: xs }).auraEvents;
    const rows = rowsOf(fr(117.596), fr(118.885), fr(122.347));
    // FR 3 s + 1 s slack, from the run's start 117.596
    expect(ownAuraUpBeforeRow(u, rows, rows[1]!)).toBe(true);
    expect(ownAuraUpBeforeRow(u, rows, rows[2]!)).toBe(false);
    const r2 = rowsOf(fr(100), fr(103, LogEvent.SPELL_AURA_REFRESH), fr(106));
    expect(ownAuraUpBeforeRow(u, r2, r2[2]!)).toBe(true);
    const r3 = rowsOf(fr(100), fr(101, LogEvent.SPELL_AURA_REMOVED), fr(101.5));
    expect(ownAuraUpBeforeRow(u, r3, r3[2]!)).toBe(false);
    // inside the life
    const r4 = rowsOf(fr(100), fr(103.9));
    expect(ownAuraUpBeforeRow(u, r4, r4[1]!)).toBe(true);
    const r5 = rowsOf(fr(100), fr(104.1));
    expect(ownAuraUpBeforeRow(u, r5, r5[1]!)).toBe(false);
    // a row not among the rows is not up
    expect(ownAuraUpBeforeRow(u, r4, rowsOf(fr(103))[0]!)).toBe(false);
  });
});
