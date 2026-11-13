/**
 * T41 (fact12 D11 / N12): an effect still up when the analysed slice ends is
 * not seen to end there. 52a97230 r0: a Havoc Metamorphosis went up at
 * 0:32.885, the slice ended at 0:35.744 and the aura's REMOVED was logged at
 * 0:39.48, in the round's cleanup — `[RES]` read
 * `Metamorphosis/Havoc Demon Hunter(3s left)` at 0:33, the slice's end minus
 * the row. The aura occurrences read no row past the slice's end and bound
 * an inferred end by it; an unobserved end there leaves the effect's own
 * official end standing, as `observedEffectEnd` already does for a logged
 * press (F15) — whose guard read the first REMOVED of any of the press's
 * effect ids, not the chain's own aura's. The corpus
 * check is `packages/eval/scripts/scan5/t41.ts`.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { burstWindowDecisionPoints } from "../src/analysis/burstWindowDecisionPoints";
import { ensureAnalysisData } from "../src/data/ensure";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import {
  enemyEffectOwnEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const AURA_S = 32.885;
const LANDING_S = 33.809;
const END_S = 35.744;

beforeAll(async () => {
  await ensureAnalysisData();
});

const dh = (auraS: number, removedS?: number): ICombatUnit =>
  makeUnit("player-1", {
    name: "Dh",
    class: CombatUnitClass.DemonHunter,
    spec: CombatUnitSpec.DemonHunter_Havoc,
    info: {} as never,
    spellCastEvents: [
      makeSpellCastEvent("200166", at(auraS + LANDING_S - AURA_S), "player-1"),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "162264",
        at(auraS),
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...(removedS === undefined
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              "162264",
              at(removedS),
              "player-1",
              "player-1",
              "BUFF",
            ),
          ]),
    ],
  });

const combatOf = (u: ICombatUnit, endS = END_S) =>
  ({
    startTime: T0,
    endTime: at(endS),
    units: { [u.id]: u },
  }) as never;

const metaCast = (u: ICombatUnit, endS = END_S) =>
  reconstructEnemyCDTimeline(
    [u],
    combatOf(u, endS),
  ).players[0]!.offensiveCDs.find((c) => c.spellName === "Metamorphosis")!;
/** the end `[RES]` counts to (`enemyEffectOwnEndSeconds`) */
const metaEnd = (u: ICombatUnit, endS = END_S) =>
  enemyEffectOwnEndSeconds(metaCast(u, endS));

describe("T41 — an effect still up at the slice's end runs to its own end", () => {
  it("52a97230 r0: the press runs to its own official end, not the slice's", () => {
    const u = dh(AURA_S, 39.48);
    const full = buffFullDurationForCaster("191427", u)!;
    expect(full).toBeGreaterThan(10);
    expect(metaEnd(u)).toBeCloseTo(AURA_S + full, 3);
  });

  it("every other reader keeps the end the slice shows: buffEndSeconds, and no build-time field leaves the builder (codex 80-PIPE-51-B50)", () => {
    for (const u of [dh(AURA_S, 39.48), dh(AURA_S)]) {
      const cast = metaCast(u);
      expect(cast.buffEndSeconds).toBeCloseTo(END_S, 3);
      expect(cast.ownEndSeconds).toBeGreaterThan(END_S);
      expect("windowEndSeconds" in cast).toBe(false);
    }
    // an end the log shows has no own end beside it
    const seen = metaCast(dh(AURA_S, 35));
    expect(seen.buffEndSeconds).toBeCloseTo(35, 3);
    expect("ownEndSeconds" in seen).toBe(false);
  });

  it("a burst window's segment, length and outcome horizon stop at the slice's end with damage rows retained past it (codex 80-PIPE-51-B50)", () => {
    // Metamorphosis from 20 s, the slice over at 35.744 s, the friendly's
    // damage rows running on to 36 s
    const enemy = {
      ...dh(20, 39.48),
      id: "player-1",
      reaction: CombatUnitReaction.Hostile,
      info: { teamId: "1", specId: "577" },
    };
    const row = (s: number) => ({
      timestamp: at(s),
      srcUnitId: "player-1",
      amount: -5,
      effectiveAmount: -5,
      logLine: { timestamp: at(s) },
    });
    const friend = makeUnit("player-2", {
      name: "Friend",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Balance,
      reaction: CombatUnitReaction.Friendly,
      info: { teamId: "0", specId: "102" } as never,
      advancedActions: Array.from({ length: 37 }, (_, s) => ({
        timestamp: at(s),
        logLine: { timestamp: at(s) },
        advancedActorId: "player-2",
        advancedActorCurrentHp: 60,
        advancedActorMaxHp: 100,
        advancedActorPositionX: 0,
        advancedActorPositionY: 0,
      })) as never,
      damageIn: Array.from({ length: 17 }, (_, i) => row(20 + i)) as never,
    });
    const points = burstWindowDecisionPoints({
      startTime: T0,
      endTime: at(END_S),
      units: { [enemy.id]: enemy, [friend.id]: friend },
      startInfo: { bracket: "3v3" },
    } as never);
    expect(points).toHaveLength(1);
    const p = points[0]!;
    expect([p.endSec, p.durationSec, p.outcomeEndSec]).toEqual([
      35,
      35 - p.tSec,
      35,
    ]);
  });

  it("its burst window still ends at the slice's end", () => {
    const u = dh(AURA_S, 39.48);
    const windows = reconstructEnemyCDTimeline(
      [u],
      combatOf(u),
    ).alignedBurstWindows;
    expect(windows.length).toBe(1);
    expect(windows[0]!.toSeconds).toBeCloseTo(END_S, 3);
  });

  it("no REMOVED at all reads the same", () => {
    const u = dh(AURA_S);
    const full = buffFullDurationForCaster("191427", u)!;
    expect(metaEnd(u)).toBeCloseTo(AURA_S + full, 3);
  });

  it("a REMOVED inside the slice is the observed end", () => {
    expect(metaEnd(dh(AURA_S, 35))).toBeCloseTo(35, 3);
  });

  it("an effect whose official end falls inside the slice keeps it", () => {
    const u = dh(5, 70);
    const full = buffFullDurationForCaster("191427", u)!;
    expect(5 + full).toBeLessThan(60);
    expect(metaEnd(u, 60)).toBeCloseTo(5 + full, 3);
  });

  it("a logged press: a side aura's REMOVED inside the slice does not hide the clamp", () => {
    // 605 s0/34-2: Incarnation: Avatar of Ashamane 102543 up at 104.21 s
    // with its same-named side aura 252071 (off at 104.43 s); the slice
    // ends at 121.34 s and 102543's own REMOVED is logged at 124.21 s
    // the rows name their caster as the unit does: the chain reader pairs
    // a press with its auras by that name (codex 85-tk-G-T41-1: with the
    // helper's "Source" the test passed on the parent too)
    const row = (event: LogEvent, id: string, s: number) => ({
      ...makeAuraEvent(event, id, at(s), "player-1", "player-1", "BUFF"),
      srcUnitName: "Druid",
    });
    const druid = makeUnit("player-1", {
      name: "Druid",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Feral,
      info: {} as never,
      spellCastEvents: [makeSpellCastEvent("102543", at(104.21), "player-1")],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, "102543", 104.21),
        row(LogEvent.SPELL_AURA_APPLIED, "252071", 104.21),
        row(LogEvent.SPELL_AURA_REMOVED, "252071", 104.43),
        row(LogEvent.SPELL_AURA_REMOVED, "102543", 124.21),
      ],
    });
    const full = buffFullDurationForCaster("102543", druid)!;
    const cast = reconstructEnemyCDTimeline(
      [druid],
      combatOf(druid, 121.34),
    ).players[0]!.offensiveCDs.find((c) => c.spellId === "102543")!;
    expect(enemyEffectOwnEndSeconds(cast)).toBeCloseTo(104.21 + full, 3);
    expect(cast.buffEndSeconds).toBeCloseTo(121.34, 3);
  });

  it("an effect aura shorter than the cast's own length does not replace it (codex 85-tk-G-T41-1 #1)", () => {
    // Summon Infernal 1122 at 10 s, its landing stun 22703 on a player from
    // 10 s to 12 s, the slice over at 11 s
    const stun = (event: LogEvent, s: number) => ({
      ...makeAuraEvent(event, "22703", at(s), "player-1", "player-2", "DEBUFF"),
      srcUnitName: "Lock",
    });
    const lock = makeUnit("player-1", {
      name: "Lock",
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Destruction,
      info: {} as never,
      spellCastEvents: [makeSpellCastEvent("1122", at(10), "player-1")],
    });
    const victim = makeUnit("player-2", {
      name: "Victim",
      auraEvents: [
        stun(LogEvent.SPELL_AURA_APPLIED, 10),
        stun(LogEvent.SPELL_AURA_REMOVED, 12),
      ],
    });
    const full = buffFullDurationForCaster("1122", lock)!;
    expect(full).toBeGreaterThan(2);
    const cast = reconstructEnemyCDTimeline([lock], {
      startTime: T0,
      endTime: at(11),
      units: { [lock.id]: lock, [victim.id]: victim },
    } as never).players[0]!.offensiveCDs.find((c) => c.spellId === "1122")!;
    expect(cast.buffEndSeconds).toBeCloseTo(10 + full, 3);
  });

  it("a holder dead on the slice's last row: the effect is over, not due (codex 85-tk-G-T41-1 #2)", () => {
    // up at 10 s, the holder dies at 20 s where the slice ends, the aura's
    // REMOVED logged 50 ms later in the cascade
    const u = dh(10, 20.05);
    (u as { deathRecords: unknown[] }).deathRecords = [{ timestamp: at(20) }];
    expect(metaEnd(u, 20)).toBeCloseTo(20, 3);
    // alive, the same rows leave the official end standing
    const alive = dh(10, 20.05);
    const full = buffFullDurationForCaster("191427", alive)!;
    expect(metaEnd(alive, 20)).toBeCloseTo(10 + full, 3);
  });

  it("…and the rows before that death still read the time the effect was due (codex 85-tk-G-T41-1b #1)", () => {
    const u = dh(10, 20.05);
    (u as { deathRecords: unknown[] }).deathRecords = [{ timestamp: at(20) }];
    const full = buffFullDurationForCaster("191427", u)!;
    const cast = reconstructEnemyCDTimeline(
      [u],
      combatOf(u, 20),
    ).players[0]!.offensiveCDs.find((c) => c.spellName === "Metamorphosis")!;
    expect(cast.buffEndSeconds).toBeCloseTo(20, 3);
    expect(cast.deathCutAtSeconds).toBeCloseTo(20, 3);
    expect(cast.deathCutOfficialEndSeconds).toBeCloseTo(10 + full, 3);
  });

  it("the cast's own aura on the holder is the effect, whichever of its auras the log wrote first (codex 85-tk-G-T41-1b #2)", () => {
    // Incarnation 102543 pressed at 10 s: its side aura 252071 logged at
    // 10 s, its own a millisecond later; the slice over at 10.1 s, the side
    // aura's REMOVED at 10.22 s
    const row = (event: LogEvent, id: string, s: number) => ({
      ...makeAuraEvent(event, id, at(s), "player-1", "player-1", "BUFF"),
      srcUnitName: "Druid",
    });
    const druid = makeUnit("player-1", {
      name: "Druid",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Feral,
      info: {} as never,
      spellCastEvents: [makeSpellCastEvent("102543", at(10), "player-1")],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, "252071", 10),
        row(LogEvent.SPELL_AURA_APPLIED, "102543", 10.001),
        row(LogEvent.SPELL_AURA_REMOVED, "252071", 10.22),
        row(LogEvent.SPELL_AURA_REMOVED, "102543", 30),
      ],
    });
    const full = buffFullDurationForCaster("102543", druid)!;
    expect(buffFullDurationForCaster("252071", druid)).toBeGreaterThan(full);
    const cast = reconstructEnemyCDTimeline(
      [druid],
      combatOf(druid, 10.1),
    ).players[0]!.offensiveCDs.find((c) => c.spellId === "102543")!;
    expect(cast.buffEndSeconds).toBeCloseTo(10 + full, 3);
  });
});
