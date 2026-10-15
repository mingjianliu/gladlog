/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Work order 2026-10-15 Part 1 (third acceptance of PV393):
 *  - #1: the two legend cross-references print only when the other line does;
 *  - #2: an answer covers a burst until its OBSERVED end;
 *  - #3: the intent guard's success evidence has no Stasis replays;
 *  - #4: a death inside a lock longer than 5 s bounds the press list;
 *  - #8: the [HEALING] / [MANA] windows' observed end.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { burstWindowDecisionPoints } from "../src/analysis/burstWindowDecisionPoints";
import { ownerPressEvents } from "../src/analysis/candidates/shared";
import { applyLegendCrossRefs } from "../src/context/buildMatchContext";
import {
  BURST_ANSWERED_POSITIONING_XREF,
  creditedAnswer,
} from "../src/context/burstAnswered";
import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { observedCastEndMs } from "../src/utils/enemyCDs";
import { POSITIONING_BURST_ANSWERED_XREF } from "../src/utils/positionAnalysis";
import {
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;
const aura = (
  event: LogEvent,
  spellId: string,
  sec: number,
  src: string,
  dest: string,
) => ({
  logLine: { event, timestamp: S(sec), parameters: [] },
  timestamp: S(sec),
  spellId,
  spellName: spellId,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
});

describe("#1 — a legend names the other family's line only when it is there", () => {
  const legend = `    The pressured player = … went lowest${BURST_ANSWERED_POSITIONING_XREF}. A control counts …`;
  const header = `  STAYED IN during enemy burst (… any source${POSITIONING_BURST_ANSWERED_XREF}.):`;
  const answered = "1:43  [BURST ANSWERED]   enemy opened …";
  const target =
    "    1:43–1:53 [Critical burst] … — you were the burst target — …";

  it("both families present: both cross-references kept", () => {
    const r = applyLegendCrossRefs(`${answered}\n${legend}`, [header, target]);
    expect(r.timelineText).toContain(BURST_ANSWERED_POSITIONING_XREF);
    expect(r.positionLines[0]).toContain(POSITIONING_BURST_ANSWERED_XREF);
  });

  it("no POSITIONING burst target: the [BURST ANSWERED] legend drops its clause", () => {
    const r = applyLegendCrossRefs(`${answered}\n${legend}`, []);
    expect(r.timelineText).not.toContain(BURST_ANSWERED_POSITIONING_XREF);
    expect(r.timelineText).toContain("went lowest. A control counts");
  });

  it("no [BURST ANSWERED] line: the POSITIONING header drops its clause", () => {
    const r = applyLegendCrossRefs("0:10  [YOU] …", [header, target]);
    expect(r.positionLines[0]).not.toContain(POSITIONING_BURST_ANSWERED_XREF);
    expect(r.positionLines[0]).toContain("any source.):");
  });
});

describe("#2 — an answer covers the burst until its observed end", () => {
  // the t12ControlAnswer fixture's shape: an opener at 0:10, a pressured
  // friendly hit by it at 5 / s from 10 to 20 (trough second 18)
  const hp = (tSec: number, cur: number, actorId: string) => ({
    timestamp: S(tSec),
    logLine: { timestamp: S(tSec) },
    advancedActorId: actorId,
    advancedActorCurrentHp: cur,
    advancedActorMaxHp: 100,
    advancedActorPositionX: 0,
    advancedActorPositionY: 0,
  });
  const dmg = (tSec: number, amount: number, src: string) => ({
    timestamp: S(tSec),
    srcUnitId: src,
    amount: -amount,
    effectiveAmount: -amount,
    logLine: { timestamp: S(tSec) },
  });
  const unit = (over: Record<string, unknown>): any => ({
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Balance,
    advancedActions: [],
    damageIn: [],
    healIn: [],
    healOut: [],
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    type: CombatUnitType.Player,
    ...over,
  });
  const BARKSKIN = "22812";
  const cast = (spellId: string, tSec: number, dest?: string) => ({
    spellId,
    spellName: spellId,
    timestamp: S(tSec),
    destUnitId: dest,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: S(tSec) },
  });
  const friend = (barkskinRemovedAt: number) =>
    unit({
      id: "F1",
      name: "Friend-R",
      reaction: CombatUnitReaction.Friendly,
      info: { teamId: "0", specId: "102" },
      advancedActions: Array.from({ length: 41 }, (_, s) =>
        hp(s, s >= 10 && s <= 20 ? 100 - (s - 10) * 5 : 100, "F1"),
      ),
      spellCastEvents: [cast(BARKSKIN, 11, "F1")],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, BARKSKIN, 11, "F1", "F1"),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          BARKSKIN,
          barkskinRemovedAt,
          "F1",
          "F1",
        ),
        // the log names the caster on its aura rows (`srcUnitName`)
      ].map((a) => ({ ...a, srcUnitName: "Friend-R" })),
      damageIn: Array.from({ length: 10 }, (_, i) => dmg(10 + i, 5, "E1")),
    });
  const opener = unit({
    id: "E1",
    name: "Opener-R",
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1", specId: "260" },
    spellCastEvents: [cast("13750", 10)],
  });
  const points = (f: any) =>
    burstWindowDecisionPoints({
      startTime: T0,
      endTime: S(240),
      units: { F1: f, E1: opener },
      startInfo: { bracket: "3v3" },
    } as any);

  it("a wall seen to end well before the trough answered nothing; one that ran through it did", () => {
    const early = points(friend(11.3))[0]!;
    const wall = early.responseCasts.find((r) => r.spellId === BARKSKIN)!;
    expect(wall.effectEndSec).toBe(11);
    expect(creditedAnswer(early)).toBeUndefined();
    const full = points(friend(19))[0]!;
    expect(
      full.responseCasts.find((r) => r.spellId === BARKSKIN)!.effectEndSec,
    ).toBe(19);
    expect(creditedAnswer(full)?.spellId).toBe(BARKSKIN);
  });
});

describe("#3 — the intent guard's success evidence has no Stasis replays", () => {
  it("casts inside a Stasis release window are not presses", () => {
    const owner = {
      spellCastEvents: [
        { logLine: { timestamp: S(10) }, spellId: "a" },
        { logLine: { timestamp: S(20.5) }, spellId: "b" }, // replay
        { logLine: { timestamp: S(25) }, spellId: "c" },
      ],
      auraEvents: [
        {
          spellId: "370562",
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: S(20) },
          timestamp: S(20),
        },
      ],
    };
    expect(ownerPressEvents(owner).map((e: any) => e.spellId)).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("#4 — a death inside a lock longer than 5 s bounds the press list", () => {
  it("diedAfterKickS is set for a death 5.5 s into a 6 s Counterspell lock", () => {
    const player = makeUnit("player-1", {
      name: "Owner",
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "2139",
          "Counterspell",
          "77472",
          "Healing Wave",
          S(10),
          "enemy-1",
        ),
      ],
      deathRecords: [{ timestamp: S(15.5) }] as any,
    } as any);
    const enemy = makeUnit("enemy-1", {
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
    });
    const [k] = analyzePlayerCCAndTrinket(player, [enemy], {
      startTime: T0,
      endTime: S(300),
      startInfo: { zoneId: "1672" },
    } as any).interruptInstances;
    expect(k!.lockoutDurationSeconds).toBeGreaterThan(5);
    expect(k!.diedAfterKickS).toBeCloseTo(5.5, 5);
  });
});

describe("#8 — the [HEALING] / [MANA] windows read the observed end", () => {
  it("observedCastEndMs: the buff's logged removal, else null", () => {
    const priest = makeUnit("p", {
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [makeSpellCastEvent("10060", S(30), "m", "M", "p", "p")],
    }) as any;
    priest.type = CombatUnitType.Player;
    const mage = makeUnit("m", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "10060", 30, "p", "m"),
        aura(LogEvent.SPELL_AURA_REMOVED, "10060", 38, "p", "m"),
      ],
    }) as any;
    mage.type = CombatUnitType.Player;
    priest.name = "p";
    const players = [priest, mage];
    expect(observedCastEndMs(priest, "10060", S(30), players, T0, S(300))).toBe(
      S(38),
    );
    expect(
      observedCastEndMs(priest, "10060", S(30), [priest], T0, S(300)),
    ).toBeNull();
  });
});
