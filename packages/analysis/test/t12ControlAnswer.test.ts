/**
 * FT-T12 D3 (user ruling 2026-10-10, T12 item 8 ii): a friendly control
 * answers an enemy burst only when its target — the unit an aimed control was
 * cast at, or the holder a ground control landed on — or that target's pets
 * dealt damage > 0 to the PRESSURED friendly inside the burst window
 * (`controlTargetHitPressured`). One rule for both halves: the engine drops a
 * failing control from `responseCasts`, which `responded` (the
 * slow-defensive-response candidate) and `creditedAnswer` (the
 * `[BURST ANSWERED]` line) both read.
 *
 * Before: any enemy that pressed a cooldown in the window qualified, an enemy
 * healer whose only press was Power Infusion included.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildFindingsPrompt } from "../src/analysis/buildFindingsPrompt";
import {
  burstWindowDecisionPoints,
  controlTargetHitPressured,
} from "../src/analysis/burstWindowDecisionPoints";
import {
  BURST_ANSWERED_CONTROL_LEGEND,
  BURST_ANSWERED_CONTROL_RULE_LEGEND,
  BURST_ANSWERED_LEGEND,
  creditedAnswer,
  formatBurstAnsweredLines,
  parseBurstAnsweredLine,
} from "../src/context/burstAnswered";
import { ensureAnalysisData } from "../src/data/ensure";

const T0 = 1_000_000;
/** Adrenaline Rush — opens a window on its own. */
const AR = "13750";
/** Power Infusion — a cooldown an enemy healer presses on a teammate. */
const PI = "10060";
/** Storm Bolt — hard CC, the aimed control. Its stun aura is 132169. */
const STORM_BOLT = "107570";
const STORM_BOLT_STUN = "132169";
/** Barkskin — the pressured druid's own wall. */
const BARKSKIN = "22812";
/** Capacitor Totem: no target; its totem stuns with Static Charge. */
const CAPACITOR = "192058";
const STATIC_CHARGE = "118905";

const cast = (spellId: string, tSec: number, destUnitId?: string) => ({
  spellId,
  spellName: spellId,
  timestamp: T0 + tSec * 1000,
  destUnitId,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: T0 + tSec * 1000,
  },
});
const aura = (
  spellId: string,
  tSec: number,
  srcUnitId: string,
  destUnitId: string,
) => ({
  spellId,
  spellName: spellId,
  srcUnitId,
  srcUnitName: srcUnitId,
  destUnitId,
  timestamp: T0 + tSec * 1000,
  logLine: {
    event: LogEvent.SPELL_AURA_APPLIED,
    timestamp: T0 + tSec * 1000,
  },
});
const hp = (tSec: number, cur: number, actorId: string) => ({
  timestamp: T0 + tSec * 1000,
  logLine: { timestamp: T0 + tSec * 1000 },
  advancedActorId: actorId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: 100,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});
const dmg = (tSec: number, amount: number, srcUnitId: string) => ({
  timestamp: T0 + tSec * 1000,
  srcUnitId,
  amount: -amount,
  effectiveAmount: -amount,
  logLine: { timestamp: T0 + tSec * 1000 },
});
/** 5 damage a second in [10, 20) from `srcUnitId` — over the lapse floor */
const steady = (srcUnitId: string) =>
  Array.from({ length: 10 }, (_, i) => dmg(10 + i, 5, srcUnitId));

function unit(over: Record<string, unknown>): any {
  return {
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
    ...over,
  };
}
/** The pressured friendly: at 60 % HP through the window. `BARKSKIN` at 120
 * puts the wall in their ledger, so answering was feasible. */
const friend = (casts: any[], damageIn: any[]) =>
  unit({
    id: "F1",
    name: "Friend-R",
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0", specId: "102" },
    advancedActions: Array.from({ length: 41 }, (_, s) => hp(s, 60, "F1")),
    spellCastEvents: [...casts, cast(BARKSKIN, 120)],
    damageIn,
  });
const enemy = (id: string, name: string, over: Record<string, unknown> = {}) =>
  unit({
    id,
    name,
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1", specId: "260" },
    ...over,
  });
/** the opener: Adrenaline Rush at 0:10 */
const opener = (over: Record<string, unknown> = {}) =>
  enemy("E1", "Opener-R", { spellCastEvents: [cast(AR, 10)], ...over });
/** the enemy healer: Power Infusion at 0:11, nothing else */
const piHealer = (over: Record<string, unknown> = {}) =>
  enemy("E2", "Healer-R", { spellCastEvents: [cast(PI, 11, "E1")], ...over });

const points = (units: any[]) => {
  const map: Record<string, any> = {};
  for (const u of units) map[u.id] = u;
  return burstWindowDecisionPoints({
    startTime: T0,
    endTime: T0 + 240_000,
    units: map,
    startInfo: { bracket: "3v3" },
  } as any);
};
const controls = (p: { responseCasts: Array<{ category: string }> }) =>
  p.responseCasts.filter((r) => r.category === "control");

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("burstWindowDecisionPoints — which control answers a burst (FT-T12 D3)", () => {
  it("a control on the opener, who is hitting the pressured unit, counts", () => {
    const [p] = points([
      friend([cast(STORM_BOLT, 12, "E1")], steady("E1")),
      opener(),
    ]);
    expect(p!.pressured!.name).toBe("Friend-R");
    expect(p!.responses.control).toBe(true);
    expect(p!.responded).toBe(true);
    expect(controls(p!)).toMatchObject([{ spellId: STORM_BOLT, destId: "E1" }]);
  });

  it("a control on an enemy healer who only pressed Power Infusion does not", () => {
    const [p] = points([
      friend([cast(STORM_BOLT, 12, "E2")], steady("E1")),
      opener(),
      piHealer(),
    ]);
    // the healer IS one of the window's cooldown casters — the old rule's
    // whole test — and dealt the pressured unit nothing
    expect(p!.extraCds.map((c) => [c.spellId, c.casterName])).toContainEqual([
      PI,
      "Healer-R",
    ]);
    expect(p!.responses.control).toBe(false);
    expect(p!.responseCasts).toEqual([]);
    expect(p!.responded).toBe(false);
    expect(p!.firstResponseSec).toBeNull();
  });

  it("…and one point of damage from that healer inside the window is the whole difference (no threshold)", () => {
    const [p] = points([
      friend([cast(STORM_BOLT, 12, "E2")], [...steady("E1"), dmg(15, 1, "E2")]),
      opener(),
      piHealer(),
    ]);
    expect(p!.responses.control).toBe(true);
    expect(p!.responded).toBe(true);
    expect(controls(p!)).toMatchObject([{ destId: "E2" }]);
  });

  it("a control on an enemy whose PET is the one hitting counts", () => {
    const pet = {
      id: "P2",
      name: "Pet",
      ownerId: "E2",
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [],
      auraEvents: [],
    };
    const [p] = points([
      friend(
        [cast(STORM_BOLT, 12, "E2")],
        [...steady("E1"), dmg(15, 40, "P2")],
      ),
      opener(),
      piHealer(),
      pet,
    ]);
    expect(p!.responses.control).toBe(true);
    expect(controls(p!)).toMatchObject([{ destId: "E2" }]);
    // a FRIENDLY pet's id never maps to an enemy player
    const [q] = points([
      friend(
        [cast(STORM_BOLT, 12, "E2")],
        [...steady("E1"), dmg(15, 40, "P2")],
      ),
      opener(),
      piHealer(),
      { ...pet, ownerId: "F1", reaction: CombatUnitReaction.Friendly },
    ]);
    expect(q!.responses.control).toBe(false);
  });

  it("the span is the burst window: a hit from before it opened does not count", () => {
    const [p] = points([
      friend([cast(STORM_BOLT, 12, "E2")], [dmg(6, 40, "E2"), ...steady("E1")]),
      opener(),
      piHealer(),
    ]);
    expect(p!.tSec).toBe(10);
    expect(p!.responses.control).toBe(false);
  });

  it("a ground control reads the holder it LANDED on, by the same rule", () => {
    const totem = {
      id: "T1",
      name: "Capacitor Totem",
      ownerId: "F1",
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [],
      auraEvents: [],
    };
    const capacitor = [cast(CAPACITOR, 12, "0000000000000000")];
    // landed on the healer, who dealt nothing
    const [onHealer] = points([
      friend(capacitor, steady("E1")),
      totem,
      opener(),
      piHealer({ auraEvents: [aura(STATIC_CHARGE, 14, "T1", "E2")] }),
    ]);
    expect(onHealer!.responses.control).toBe(false);
    expect(onHealer!.responded).toBe(false);
    // landed on the opener, who is hitting
    const [onOpener] = points([
      friend(capacitor, steady("E1")),
      totem,
      opener({ auraEvents: [aura(STATIC_CHARGE, 14, "T1", "E1")] }),
      piHealer(),
    ]);
    expect(onOpener!.responses.control).toBe(true);
    expect(controls(onOpener!)).toMatchObject([
      { spellId: STATIC_CHARGE, destId: "E1" },
    ]);
  });

  it("walls are untouched: a Barkskin beside a control on the healer still answers, and is the only response left", () => {
    const [p] = points([
      friend([cast(STORM_BOLT, 12, "E2"), cast(BARKSKIN, 14)], steady("E1")),
      opener(),
      piHealer(),
    ]);
    expect(p!.responses).toMatchObject({ wall: true, control: false });
    expect(p!.responded).toBe(true);
    expect(p!.responseCasts.map((r) => r.category)).toEqual(["wall"]);
    expect(p!.firstResponseSec).toBe(4);
  });

  it("KNOWN LIMIT (pinned, not endorsed): a control that kept the opener from dealing any damage in the window does not count", () => {
    // every hit on the pressured unit comes from the second enemy; the opener,
    // stunned from 0:10, lands nothing
    const [p] = points([
      friend([cast(STORM_BOLT, 10.2, "E1")], steady("E2")),
      opener(),
      enemy("E2", "Other-R", { spellCastEvents: [cast(AR, 11)] }),
    ]);
    expect(p!.leadCd.casterName).toBe("Opener-R");
    expect(p!.responses.control).toBe(false);
  });
});

describe("controlTargetHitPressured — the rule itself", () => {
  const victim = { damageIn: [dmg(10, 1, "E1"), dmg(20, 7, "PET")] };
  const owners = (src: string) =>
    src === "E1" ? "E1" : src === "PET" ? "E2" : undefined;
  const from = T0 + 10_000;
  const to = T0 + 20_000;

  it("any landed damage > 0 from the target or its pets, both ends of the window included", () => {
    expect(controlTargetHitPressured(victim, "E1", owners, from, to)).toBe(
      true,
    );
    expect(controlTargetHitPressured(victim, "E2", owners, from, to)).toBe(
      true,
    );
    expect(controlTargetHitPressured(victim, "E3", owners, from, to)).toBe(
      false,
    );
  });

  it("outside the window, a zero hit, no target, or no pressured unit ⇒ false", () => {
    expect(controlTargetHitPressured(victim, "E1", owners, from + 1, to)).toBe(
      false,
    );
    expect(controlTargetHitPressured(victim, "E2", owners, from, to - 1)).toBe(
      false,
    );
    expect(
      controlTargetHitPressured(
        { damageIn: [dmg(12, 0, "E1")] },
        "E1",
        owners,
        from,
        to,
      ),
    ).toBe(false);
    expect(controlTargetHitPressured(victim, undefined, owners, from, to)).toBe(
      false,
    );
    expect(controlTargetHitPressured(null, "E1", owners, from, to)).toBe(false);
  });
});

describe("[BURST ANSWERED] reads the same list (FT-T12 D3)", () => {
  const line = (units: any[]) =>
    formatBurstAnsweredLines(points(units)).map((e) => e.line);

  it("a control on the opener who is hitting is credited, target named", () => {
    const [l] = line([
      friend([cast(STORM_BOLT, 12, "E1")], steady("E1")),
      opener({ auraEvents: [aura(STORM_BOLT_STUN, 12.1, "F1", "E1")] }),
    ]);
    expect(l).toContain(
      "Friend-R answered with Storm Bolt on Opener-R in 2.0s",
    );
  });

  it("a control on the Power Infusion healer is not the credited answer: the later wall is", () => {
    const units = [
      friend([cast(STORM_BOLT, 12, "E2"), cast(BARKSKIN, 14)], steady("E1")),
      opener(),
      piHealer({ auraEvents: [aura(STORM_BOLT_STUN, 12.1, "F1", "E2")] }),
    ];
    const [l, ...rest] = line(units);
    expect(rest).toEqual([]);
    expect(l).toContain("Friend-R answered with Barkskin in 4.0s");
    expect(l).not.toContain("Storm Bolt");
    expect(l).not.toContain("Healer-R");
    expect(creditedAnswer(points(units)[0]!)!.category).toBe("wall");
    // the gates' own reader still reads the line (its wording did not change)
    expect(parseBurstAnsweredLine(`0:10  ${l}`)).toMatchObject({
      atSec: 10,
      answerer: "Friend-R",
      spellName: "Barkskin",
      controlOn: [],
      latencySec: 4,
      pressured: "Friend-R",
    });
  });

  it("with nothing else pressed the window has no credit line — and is not `responded` either: one rule, both signs", () => {
    const units = [
      friend([cast(STORM_BOLT, 12, "E2")], steady("E1")),
      opener(),
      piHealer({ auraEvents: [aura(STORM_BOLT_STUN, 12.1, "F1", "E2")] }),
    ];
    const [p] = points(units);
    expect(line(units)).toEqual([]);
    expect(creditedAnswer(p!)).toBeUndefined();
    expect(p!.responded).toBe(false);
    // the window stays what the slow-defensive-response half asks about
    expect(p!.feasible).toBe(true);
  });

  it("an AoE control names only the burst casters that were hitting", () => {
    // one Capacitor Totem lands on both casters; only the opener deals damage
    const totem = {
      id: "T1",
      name: "Capacitor Totem",
      ownerId: "F1",
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [],
      auraEvents: [],
    };
    const [l] = line([
      friend([cast(CAPACITOR, 12, "0000000000000000")], steady("E1")),
      totem,
      opener({ auraEvents: [aura(STATIC_CHARGE, 14, "T1", "E1")] }),
      piHealer({ auraEvents: [aura(STATIC_CHARGE, 14, "T1", "E2")] }),
    ]);
    expect(l).toContain(" on Opener-R ");
    expect(l).not.toContain("Healer-R");
    expect(parseBurstAnsweredLine(`0:10  ${l}`)!.controlOn).toEqual([
      { target: "Opener-R" },
    ]);
  });
});

describe("the legends say what counts as a control answer (FT-T12 D3)", () => {
  it("[BURST ANSWERED]: the rule is part of the legend every credit line brings, limit included", () => {
    expect(BURST_ANSWERED_LEGEND).toContain(BURST_ANSWERED_CONTROL_RULE_LEGEND);
    expect(BURST_ANSWERED_CONTROL_RULE_LEGEND).toContain(
      "A control counts as an answer only when it went on an enemy who dealt damage to the pressured player inside the burst window (that enemy's pets count as that enemy)",
    );
    expect(BURST_ANSWERED_CONTROL_RULE_LEGEND).toContain(
      "an enemy healer who only pressed a cooldown",
    );
    expect(BURST_ANSWERED_CONTROL_RULE_LEGEND).toContain(
      "neither is one whose target dealt that player no damage at all in the window, even if the control is why",
    );
  });

  it("[BURST ANSWERED]: the control-target line no longer disclaims the target altogether", () => {
    expect(BURST_ANSWERED_CONTROL_LEGEND).toContain(
      "Every enemy named there was dealing damage to the pressured player in the window (the rule above); beyond that it says what happened, not whether that was the right target.",
    );
  });

  it("slow-defensive-response: `no friendly answered` spells out the control it would have counted", () => {
    const p = buildFindingsPrompt(
      [
        {
          id: "slow-defensive-response:o:10",
          type: "slow-defensive-response",
          t: 10,
          unitNames: ["Friend-R"],
          facts: { t: "10", pressured: "Friend-R" },
        },
      ],
      "",
      "Balance Druid",
    );
    const legend = p
      .split("\n")
      .find((l) => l.startsWith('- "slow-defensive-response"'))!;
    expect(legend).toContain(
      "a control on an enemy who pressed a cooldown in that window and dealt damage to facts.pressured inside it, that enemy's pets counting as that enemy",
    );
    expect(legend).toContain(
      "a control on any other enemy, an enemy healer who only pressed a cooldown, is not an answer",
    );
    expect(legend).toContain(
      "neither is one whose target dealt facts.pressured no damage at all in the window, even if the control is why",
    );
    expect(legend).not.toContain("control on the caster/kite");
  });
});
