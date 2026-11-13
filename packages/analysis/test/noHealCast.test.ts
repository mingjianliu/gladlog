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
const positions = (x: number, far?: [number, number], flatHp = false) =>
  Array.from({ length: 32 }, (_, s) =>
    makeAdvancedAction(
      at(s),
      far && s >= far[0] && s <= far[1] ? x + 80 : x,
      0,
      100,
      flatHp ? 80 : 100 - s,
    ),
  );

function round(
  opts: {
    healerAuras?: ReturnType<typeof makeAuraEvent>[];
    mateFar?: [number, number];
    enemyDiesAt?: number;
    presses?: number[];
    /** [spell id, second, target unit id (the enemy when left out)] */
    otherPresses?: Array<[string, number, string?]>;
    flatHp?: boolean;
    /** direct heal rows of the healer under another id: [id, second, dest] */
    effectHeals?: Array<[string, number, string]>;
    /** a spell id with one heal row on the healer itself */
    selfHeal?: string;
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
    spellCastEvents: [
      ...presses.map((s) =>
        makeSpellCastEvent(REJUV, at(s), "mate", "Mate", "healer", "Healer"),
      ),
      ...(opts.otherPresses ?? []).map(([id, s, dest]) =>
        makeSpellCastEvent(
          id,
          at(s),
          dest ?? "enemy-1",
          dest ? "Mate" : "Enemy",
          "healer",
          "Healer",
        ),
      ),
    ],
    healOut: [
      ...presses.map(heal),
      ...(opts.effectHeals ?? []).map(([id, sec, dest]) => ({
        ...makeHealEvent(at(sec), "healer", 1000),
        destUnitId: dest,
        spellId: id,
        spellName: "",
      })),
      ...(opts.selfHeal
        ? [
            {
              ...makeHealEvent(at(24.5), "healer", 1000),
              destUnitId: "healer",
              spellId: opts.selfHeal,
              spellName: "Flash of Light",
            },
          ]
        : []),
    ],
    auraEvents: opts.healerAuras ?? [],
    advancedActions: positions(0),
  });
  const mate = makeUnit("mate", {
    name: "Mate",
    advancedActions: positions(10, opts.mateFar, opts.flatHp),
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
    expect(out[0]!.pressed).toEqual([]);
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

  it("空档里按的别的键按顺序列出来,治疗按键不在其中", () => {
    const out = round({
      otherPresses: [
        ["8921", 22],
        ["33786", 24],
        ["8921", 26],
      ],
    });
    expect(out[0]!.pressed).toEqual(["Moonfire", "Cyclone", "Moonfire"]);
  });

  it("一次按键写两行(给队友和自己各一行)只算一次(codex 80-PIPE-49-B49-v1-T88)", () => {
    // 10060 Power Infusion: one row on its target, one on the priest 1 ms on
    const out = round({
      otherPresses: [
        ["10060", 22],
        ["10060", 22.001],
        ["8921", 24],
      ],
    });
    expect(out[0]!.pressed).toEqual(["Power Infusion", "Moonfire"]);
  });

  it("隔一个公共冷却的同名按键各算一次(Swipe 每秒一按)", () => {
    const out = round({
      otherPresses: [
        ["106785", 22],
        ["106785", 23],
        ["106785", 24],
      ],
    });
    expect(out[0]!.pressed).toEqual(["Swipe", "Swipe", "Swipe"]);
  });

  it("R38:治疗记在别的名字下的按键,同一刻有治疗行落在它所指的队友身上就是治疗按键", () => {
    // 375576 Divine Toll pressed at 24.5 s; its heal logs as 20473 Holy Shock
    const out = round({
      otherPresses: [["375576", 24.5, "mate"]],
      effectHeals: [["20473", 24.556, "mate"]],
    });
    expect(out.map((s) => [s.fromMs - T0, s.toMs - T0])).toEqual([
      [21_000, 24_500],
      [24_500, 28_000],
    ]);
    expect(out.every((s) => s.pressed.length === 0)).toBe(true);
  });

  it("R38:那条治疗行只落在治疗者自己身上、离按键太远、或按键指的不是那个队友,不算", () => {
    // pressed on the enemy; a heal of something else lands on the mate
    const elsewhere = round({
      otherPresses: [["375576", 24.5]],
      effectHeals: [["20473", 24.52, "mate"]],
    });
    expect(elsewhere.map((s) => s.pressed)).toEqual([["Divine Toll"]]);
    const self = round({
      otherPresses: [["375576", 24.5, "mate"]],
      effectHeals: [["20473", 24.52, "healer"]],
    });
    expect(self.map((s) => s.pressed)).toEqual([["Divine Toll"]]);
    const late = round({
      otherPresses: [["375576", 24.5, "mate"]],
      effectHeals: [["20473", 24.65, "mate"]],
    });
    expect(late.map((s) => s.pressed)).toEqual([["Divine Toll"]]);
  });

  it("R30:队友在空档里没掉血,不出行", () => {
    expect(round({ flatHp: true })).toEqual([]);
  });

  it("只奶过自己的治疗也是一次治疗按键,切开空档", () => {
    // 19750 Flash of Light: its only heal row this round is on the healer
    const out = round({ otherPresses: [["19750", 24.5]], selfHeal: "19750" });
    expect(out.map((s) => [s.fromMs - T0, s.toMs - T0])).toEqual([
      [21_000, 24_500],
      [24_500, 28_000],
    ]);
    expect(out.every((s) => s.pressed.length === 0)).toBe(true);
  });
  it("主动按的救赎之魂不是治疗者先死(codex 85-tk-J-T88-2 #4)", () => {
    const pressedForm = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "215769",
        at(5),
        "healer",
        "healer",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "215769",
        at(11),
        "healer",
        "healer",
        "BUFF",
      ),
    ];
    expect(round({ healerAuras: pressedForm })).toHaveLength(1);
  });

  it("两端的血量读的是行上印出的那一秒(codex #3)", () => {
    const out = round({ presses: [15, 21.9, 28.1] });
    expect(out).toHaveLength(1);
    expect([out[0]!.hpFromPct, out[0]!.hpToPct]).toEqual([79, 72]);
  });
});
