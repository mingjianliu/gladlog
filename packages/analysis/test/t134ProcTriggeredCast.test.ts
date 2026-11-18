/**
 * T134 — a cast a low-HP proc made is no press of the cooldown it casts:
 * Well-Honed Instincts' Frenzied Regeneration (marker 382912 beside it)
 * spends no charge. One pairing (`isProcTriggeredCastAt`) for the cooldown
 * ledger, the death block's readiness and the hidden-press reading.
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
import { hiddenPressMs } from "../src/utils/hiddenPress";
import {
  isProcTriggeredCastAt,
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

describe("isProcTriggeredCastAt", () => {
  it("pairs a cast of the proc's spell with the unit's own marker, inside the tolerance", () => {
    const u = druid([], [45]);
    expect(ownProcMarkers(u).map((m) => m.t)).toEqual([at(45)]);
    expect(isProcTriggeredCastAt(u, FR, at(45))).toBe(true);
    expect(
      isProcTriggeredCastAt(u, FR, at(45) + PROC_OWN_ACTIVATION_PAIR_MS),
    ).toBe(true);
    expect(
      isProcTriggeredCastAt(u, FR, at(45) + PROC_OWN_ACTIVATION_PAIR_MS + 1),
    ).toBe(false);
    // another spell is not the proc's
    expect(isProcTriggeredCastAt(u, "22812", at(45))).toBe(false);
  });

  it("a marker another unit put up is no proc of this unit's", () => {
    const u = makeUnit("p1", { auraEvents: [marker(45, "p2")] });
    expect(isProcTriggeredCastAt(u, FR, at(45))).toBe(false);
  });
});

describe("the cooldown ledger", () => {
  it("74f541c0 r5 shape: the proc's cast row is no press, and spends nothing", () => {
    // pressed 19.3, the proc at 44.8 (cast row logged), pressed again 54.6
    const u = druid([19.3, 44.8, 54.6], [44.8]);
    const combat = combatOf(u);
    expect(
      unitCooldownEntry(u, combat, FR)!.casts.map((c) => c.timeSeconds),
    ).toEqual([19.3, 54.6]);
    // the death block's readiness reads the same presses: with the proc
    // counted the 36 s button would be out until 80.8 s
    const noThird = druid([19.3, 44.8], [44.8]);
    expect(isAvailableAt(noThird, FR, 36, 50, START)).toBe(false);
    expect(isAvailableAt(noThird, FR, 36, 56, START)).toBe(true);
  });

  it("without the marker the same row is a press", () => {
    const u = druid([19.3, 44.8], []);
    expect(
      unitCooldownEntry(u, combatOf(u), FR)!.casts.map((c) => c.timeSeconds),
    ).toEqual([19.3, 44.8]);
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
  it("…but not beside the proc's marker", () => {
    const u = druid([], [], batch(44.8, true));
    expect(hiddenPressMs(u, FR, START)).toEqual([]);
  });
});
