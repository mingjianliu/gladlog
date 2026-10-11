/**
 * Storm Conduit 1217092 gives a RESTORATION holder 4 s per Lightning Bolt /
 * Chain Lightning in a log dated before 2026-08-18 and 2 s from then on
 * (user ruling 2026-10-11; the evidence and its FLAG are on the entry in
 * data/talentScriptedCooldowns.ts). One function says how much a trigger
 * gives back (`eventReductionSecondsAt`, by the trigger's own log
 * timestamp), and the three readers — the cooldown ledger, the [RES]
 * utility entries, the interrupt cooldown — get it through
 * `eventTriggersFor`.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ownerResUtilityCds } from "../src/context/resUtilityCds";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
  eventReductionSecondsAt,
  eventTriggersFor,
  STORM_CONDUIT_HOTFIX_EPOCH_MS,
} from "../src/data/talentScriptedCooldowns";
import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  cdSecondsUntilReady,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import { interruptCooldownRemainingMs } from "../src/utils/enemyInterrupts";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const conduit = EVENT_COOLDOWN_REDUCTIONS["1217092"]!;
const RESTO = CombatUnitSpec.Shaman_Restoration;
const ELEMENTAL = CombatUnitSpec.Shaman_Elemental;
const AUG_14 = Date.UTC(2026, 7, 14, 20, 0, 0);
const AUG_19 = Date.UTC(2026, 7, 19, 20, 0, 0);
const LIGHTNING_BOLT = "188196";
const CHAIN_LIGHTNING = "188443";
const HEALING_TIDE = "108280";
const ASTRAL_SHIFT = "108271";
const WIND_SHEAR = "57994";

/** A Storm Conduit holder whose round starts at `startMs`: the cooldown at
 * 10 s, then a bolt every 2 s from 20 s (the last one a Chain Lightning). */
const holder = (
  spec: CombatUnitSpec,
  startMs: number,
  cooldownId: string,
  bolts = 5,
) =>
  makeUnit("player-1", {
    class: CombatUnitClass.Shaman,
    spec,
    info: { pvpTalents: ["1217092"], talents: [] },
    spellCastEvents: [
      makeSpellCastEvent(cooldownId, startMs + 10_000, "player-1"),
      ...Array.from({ length: bolts }, (_, i) =>
        makeSpellCastEvent(
          i === bolts - 1 ? CHAIN_LIGHTNING : LIGHTNING_BOLT,
          startMs + 20_000 + i * 2_000,
          "enemy-1",
        ),
      ),
    ],
  });

describe("eventReductionSecondsAt — Storm Conduit by spec and by the date of the log", () => {
  it("the entry: 1 s for every holder, Restoration 4 s → 2 s at the start of 2026-08-18 UTC", () => {
    expect(STORM_CONDUIT_HOTFIX_EPOCH_MS).toBe(Date.UTC(2026, 7, 18));
    expect(conduit.seconds).toEqual({
      base: 1,
      bySpec: {
        "264": {
          cutoverEpochMs: STORM_CONDUIT_HOTFIX_EPOCH_MS,
          before: 4,
          since: 2,
        },
      },
    });
  });
  it("Restoration: 4 s in a log dated 08-14, 2 s in one dated 08-19", () => {
    expect(eventReductionSecondsAt(conduit, RESTO, AUG_14)).toBe(4);
    expect(eventReductionSecondsAt(conduit, RESTO, AUG_19)).toBe(2);
  });
  it("the boundary: the last millisecond of 08-17 UTC is 4 s, 08-18 00:00:00.000 UTC is 2 s", () => {
    const cut = STORM_CONDUIT_HOTFIX_EPOCH_MS;
    expect(eventReductionSecondsAt(conduit, RESTO, cut - 1)).toBe(4);
    expect(eventReductionSecondsAt(conduit, RESTO, cut)).toBe(2);
    // 2026-08-17 20:00 at UTC−4 is that same instant: already 2 s
    expect(
      eventReductionSecondsAt(
        conduit,
        RESTO,
        Date.UTC(2026, 7, 17, 20) + 4 * 3_600_000,
      ),
    ).toBe(2);
  });
  it("no usable date → the CURRENT 2 s, never the old 4 s (the smaller give-back keeps the cooldown 'not ready' longer)", () => {
    for (const notADate of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined as unknown as number,
    ])
      expect(eventReductionSecondsAt(conduit, RESTO, notADate)).toBe(2);
  });
  // Elemental was measured 2026-10-11 (605 files: one holder, 28 recast
  // pairs, one of them early at 1 s — which 2 s a cast and a per-overload
  // trigger both explain): too thin to move, so it is still DB2's second.
  it("every other holder keeps DB2's 1 s on every day — Elemental measured and not moved", () => {
    for (const at of [AUG_14, AUG_19, Number.NaN]) {
      expect(eventReductionSecondsAt(conduit, ELEMENTAL, at)).toBe(1);
      expect(
        eventReductionSecondsAt(conduit, CombatUnitSpec.Shaman_Enhancement, at),
      ).toBe(1);
      expect(eventReductionSecondsAt(conduit, undefined, at)).toBe(1);
    }
  });
});

describe("eventTriggersFor — the same trigger stream on two dates", () => {
  const reduced = (spec: CombatUnitSpec, startMs: number) => {
    const u = holder(spec, startMs, HEALING_TIDE, 10);
    const triggers = eventTriggersFor(u, [conduit]);
    return {
      seconds: triggers.map((g) => g.seconds),
      offsets: triggers.map((g) => (g.atMs - startMs) / 1000),
      // pressed at 10 s on a 180 s cooldown
      cooldown: eventReducedCooldownSeconds(
        10,
        180,
        triggers.map((g) => ({
          atSeconds: (g.atMs - startMs) / 1000,
          seconds: g.seconds,
        })),
      ),
    };
  };
  it("ten casts: 180 − 40 in a round dated 08-14, 180 − 20 in one dated 08-19", () => {
    const early = reduced(RESTO, AUG_14);
    const late = reduced(RESTO, AUG_19);
    expect(early.offsets).toEqual(late.offsets);
    expect(early.seconds).toEqual(Array(10).fill(4));
    expect(late.seconds).toEqual(Array(10).fill(2));
    expect(early.cooldown).toBe(140);
    expect(late.cooldown).toBe(160);
  });
  it("an Elemental holder: 180 − 10 on both dates", () => {
    expect(reduced(ELEMENTAL, AUG_14).cooldown).toBe(170);
    expect(reduced(ELEMENTAL, AUG_19).cooldown).toBe(170);
  });
  it("a round played across the cutover: each cast gives what the game gave at its own instant", () => {
    // round starts 25 s before the cutover: casts at 20 / 22 / 24 s are
    // before it, the cast at 26 s and later after it
    const startMs = STORM_CONDUIT_HOTFIX_EPOCH_MS - 25_000;
    expect(reduced(RESTO, startMs).seconds).toEqual([
      4, 4, 4, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });
});

describe("the three readers get the dated seconds", () => {
  const combatOf = (u: ICombatUnit, startMs: number) =>
    ({
      startTime: startMs,
      endTime: startMs + 300_000,
      units: { [u.id]: u },
    }) as unknown as AtomicArenaCombat;
  const tide = (spec: CombatUnitSpec, startMs: number) => {
    const u = holder(spec, startMs, HEALING_TIDE);
    return extractMajorCooldowns(u, combatOf(u, startMs)).find(
      (c) => c.spellId === HEALING_TIDE,
    )!;
  };

  it("the ledger: Healing Tide's press carries 5 × 4 s on 08-14 and 5 × 2 s on 08-19", () => {
    for (const [startMs, per] of [
      [AUG_14, 4],
      [AUG_19, 2],
    ] as const) {
      const cd = tide(RESTO, startMs);
      expect(cd).toBeDefined();
      const press = cd.casts[0]!;
      expect(press.timeSeconds).toBe(10);
      expect(press.reductions).toEqual(
        [20, 22, 24, 26, 28].map((atSeconds) => ({ atSeconds, seconds: per })),
      );
      expect(press.cooldownSecondsOverride).toBe(cd.cooldownSeconds - 5 * per);
      // ready 5 × per sooner than the unreduced cooldown, to the second
      const readyAt = 10 + cd.cooldownSeconds - 5 * per;
      expect(cdAvailableAt(cd, readyAt - 1)).toBe(false);
      expect(cdAvailableAt(cd, readyAt)).toBe(true);
      // "seconds until ready" counts only the casts that had happened
      expect(cdSecondsUntilReady(cd, 23)).toBeCloseTo(
        10 + cd.cooldownSeconds - 2 * per - 23,
        6,
      );
    }
  });
  it("the ledger: Astral Shift, another target, the same seconds", () => {
    for (const [startMs, per] of [
      [AUG_14, 4],
      [AUG_19, 2],
    ] as const) {
      const u = holder(RESTO, startMs, ASTRAL_SHIFT);
      const shift = extractMajorCooldowns(u, combatOf(u, startMs)).find(
        (c) => c.spellId === ASTRAL_SHIFT,
      )!;
      expect(shift).toBeDefined();
      expect(shift.casts[0]!.reductions?.map((r) => r.seconds)).toEqual(
        Array(5).fill(per),
      );
    }
  });

  it("[RES] and the interrupt cooldown: Wind Shear at 10 s and one cast at 15 s — Restoration back 4 s sooner on 08-14 and 2 s sooner on 08-19, Elemental 1 s on both, for both readers", () => {
    for (const [spec, startMs, per] of [
      [RESTO, AUG_14, 4],
      [RESTO, AUG_19, 2],
      [ELEMENTAL, AUG_14, 1],
      [ELEMENTAL, AUG_19, 1],
    ] as const) {
      const shaman = (bolt: boolean) =>
        makeUnit("player-1", {
          class: CombatUnitClass.Shaman,
          spec,
          info: { pvpTalents: ["1217092"], talents: [] },
          spellCastEvents: [
            makeSpellCastEvent(WIND_SHEAR, startMs + 10_000, "enemy-1"),
            ...(bolt
              ? [
                  makeSpellCastEvent(
                    LIGHTNING_BOLT,
                    startMs + 15_000,
                    "enemy-1",
                  ),
                ]
              : []),
          ],
        });
      const u = shaman(true);
      const at = (s: number, unit = u) =>
        interruptCooldownRemainingMs(unit, WIND_SHEAR, startMs + s * 1000);
      // the unit's own Wind Shear cooldown, from a holder who cast nothing
      const cooldownS = at(10, shaman(false)) / 1000;
      expect(cooldownS).toBeGreaterThan(5 + per);
      const readyS = 10 + cooldownS - per;
      expect(at(readyS - 0.5)).toBe(500);
      expect(at(readyS)).toBe(0);
      // before the cast happened nobody knows about it
      expect(at(14)).toBe((cooldownS - 4) * 1000);
      const shear = ownerResUtilityCds(u, startMs).find(
        (e) => e.spellId === WIND_SHEAR,
      )!;
      expect(shear.casts[0]!.cooldownSecondsOverride).toBe(cooldownS - per);
      // the [RES] entry and the exact interrupt predicate never disagree
      // (codex review of batch 14) — the press slack is the only gap
      for (let t = 10.5; t <= 10 + cooldownS + 2; t += 0.5)
        expect(cdAvailableAt(shear, t)).toBe(
          at(t) <= CD_INSTANT_SLACK_S * 1000,
        );
    }
  });
});
