import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { noHealStretchesBeforeFirstDeath } from "../src/utils/noHealCast";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeHealEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + s * 1000;
const REJUV = "774";

/** a position sample every second for 31 s; `farFrom`..`farTo` puts the unit
 * 80 yd away */
const positions = (x: number, far?: [number, number]) =>
  Array.from({ length: 32 }, (_, s) =>
    makeAdvancedAction(
      at(s),
      far && s >= far[0] && s <= far[1] ? x + 80 : x,
      0,
      100,
      100 - s,
    ),
  );

function round(
  opts: {
    healerAuras?: ReturnType<typeof makeAuraEvent>[];
    mateFar?: [number, number];
    enemyDiesAt?: number;
    presses?: number[];
    rawStreams?: Parameters<
      typeof noHealStretchesBeforeFirstDeath
    >[0]["rawStreams"];
  } = {},
) {
  const presses = opts.presses ?? [15, 21, 28];
  const heal = (s: number) => ({
    ...makeHealEvent(at(s), "healer", 1000),
    destUnitId: "mate",
    spellId: REJUV,
    spellName: "Rejuvenation",
  });
  const owner = makeUnit("healer", {
    name: "Healer",
    spellCastEvents: presses.map((s) =>
      makeSpellCastEvent(REJUV, at(s), "mate", "Mate", "healer", "Healer"),
    ),
    healOut: presses.map(heal),
    auraEvents: opts.healerAuras ?? [],
    advancedActions: positions(0),
  });
  const mate = makeUnit("mate", {
    name: "Mate",
    advancedActions: positions(10, opts.mateFar),
  });
  const enemy = makeUnit("enemy-1", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
  });
  return noHealStretchesBeforeFirstDeath({
    owner,
    friends: [owner, mate],
    enemies: [enemy],
    allUnits: [owner, mate, enemy],
    startMs: T0,
    friendlyDeaths: [{ name: "Mate", atSeconds: 30 }],
    enemyDeaths:
      opts.enemyDiesAt === undefined
        ? []
        : [{ name: "Enemy", atSeconds: opts.enemyDiesAt }],
    zoneId: undefined,
    rawStreams: opts.rawStreams,
    lowManaPct: 15,
  });
}

describe("T88: the no-heal stretch before a teammate's first death", () => {
  it("两次治疗按键之间的 7 秒是一段,窗口之外的不算", () => {
    const out = round();
    expect(out.map((s) => [s.fromMs - T0, s.toMs - T0])).toEqual([
      [21_000, 28_000],
    ]);
    expect(out[0]!.targetName).toBe("Mate");
    expect(out[0]!.hpFromPct).toBe(79);
    expect(out[0]!.hpToPct).toBe(72);
    expect(out[0]!.form).toBeUndefined();
  });

  it("敌人先死的回合不出行", () => {
    expect(round({ enemyDiesAt: 12 })).toEqual([]);
  });

  it("被控的时间不算空档,剩下的不足最短长度", () => {
    const stun = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "408",
        at(22),
        "enemy-1",
        "healer",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "408",
        at(27),
        "enemy-1",
        "healer",
      ),
    ];
    expect(round({ healerAuras: stun })).toEqual([]);
  });

  it("队友不在治疗距离内的秒数不算", () => {
    expect(round({ mateFar: [23, 26] })).toEqual([]);
  });

  it("空档里处在猎豹形态时带上形态和它的起点", () => {
    const cat = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "768",
        at(21.5),
        "healer",
        "healer",
        "BUFF",
      ),
    ];
    const out = round({ healerAuras: cat });
    expect(out[0]!.form).toEqual({ name: "Cat Form", fromMs: at(21.5) });
  });

  it("窗口只有死亡前 10 秒", () => {
    const out = round({ presses: [5, 29] });
    expect(out.map((s) => [s.fromMs - T0, s.toMs - T0])).toEqual([
      [20_000, 29_000],
    ]);
  });

  it("队友死前已进救赎之魂:治疗者先死,不出行", () => {
    const spirit = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "27827",
        at(24),
        "healer",
        "healer",
        "BUFF",
      ),
    ];
    expect(round({ healerAuras: spirit })).toEqual([]);
  });

  it("被拒的治疗按键切开空档;蓝量见底时这一段不算空档", () => {
    const refused = (mana: number) => ({
      available: true,
      manaSamples: [{ tSeconds: 20, unitGuid: "healer", mana, manaMax: 100 }],
      castFailed: [
        {
          tSeconds: 24.5,
          unitGuid: "healer",
          spellId: 774,
          spellName: "Rejuvenation",
          reason: "x",
        },
      ],
    });
    // 21 → 24.5 → 28: two stretches of 3.5 s with mana in hand
    expect(
      round({ rawStreams: refused(60) }).map((s) => [
        s.fromMs - T0,
        s.toMs - T0,
      ]),
    ).toEqual([
      [21_000, 24_500],
      [24_500, 28_000],
    ]);
    expect(round({ rawStreams: refused(5) })).toEqual([]);
  });
});
