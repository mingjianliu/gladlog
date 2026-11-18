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
import { hiddenPressMs } from "../src/utils/hiddenPress";
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
