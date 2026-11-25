/**
 * T161 (user ruling R83, 2026-11-19): one press that puts its aura on its
 * caster and on a teammate (Power Infusion with Twins of the Sun Priestess)
 * has two copies, each with its own end. `buffEndSeconds` stays the copy that
 * ended last (the threat readers' question); the burst ledger reads where it
 * ended on the caster (`casterCopyEndSeconds`, `ledgerCastSpan`).
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  allyOverlapSpan,
  burstCastSpan,
  ledgerCastSpan,
} from "../src/utils/burstLedger";
import {
  casterCopyEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const PI = "10060";

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (ev: LogEvent, s: number, dest: string) => ({
  ...makeAuraEvent(ev, PI, at(s), "priest", dest, "BUFF"),
  srcUnitName: "Priest",
});

/** A priest presses Power Infusion on a hunter at 10 s; a copy lands on each.
 *  The priest's copy comes off at `ownOffS`, the hunter's at `mateOffS`. */
const round = (ownOffS: number, mateOffS: number | null, endS = 120) => {
  const priest: ICombatUnit = makeUnit("priest", {
    name: "Priest",
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Shadow,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents: [makeSpellCastEvent(PI, at(10), "hunter", "Hunter", "priest", "Priest")],
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, 10, "priest"),
      aura(LogEvent.SPELL_AURA_REMOVED, ownOffS, "priest"),
    ],
  });
  const hunter: ICombatUnit = makeUnit("hunter", {
    name: "Hunter",
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_Marksmanship,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, 10, "hunter"),
      ...(mateOffS === null
        ? []
        : [aura(LogEvent.SPELL_AURA_REMOVED, mateOffS, "hunter")]),
    ],
  });
  const combat = {
    startTime: T0,
    endTime: at(endS),
    units: { priest, hunter },
  } as never;
  const cd = reconstructEnemyCDTimeline([priest, hunter], combat)
    .players.find((p) => p.playerName === "Priest")!
    .offensiveCDs.find((c) => c.spellId === PI)!;
  return Object.assign(cd, { priest, combat });
};

describe("T161 — 一次按键在施法者和队友身上各有一份光环", () => {
  it("施法者那份先结束:威胁读者读最后结束的那份,爆发账本读施法者自己的", () => {
    const cd = round(16, 21);
    expect(cd.buffEndSeconds).toBeCloseTo(21, 3);
    expect(casterCopyEndSeconds(cd)).toBeCloseTo(16, 3);
    expect(burstCastSpan(cd).to).toBeCloseTo(21, 3);
    expect(ledgerCastSpan(cd)).toEqual({ from: 10, to: 16 });
  });

  it("对照:队友那份先结束,两种读法是同一个结束", () => {
    const cd = round(21, 16);
    expect(cd.buffEndSeconds).toBeCloseTo(21, 3);
    expect(cd.casterCopyEndSeconds).toBeUndefined();
    expect(ledgerCastSpan(cd).to).toBe(burstCastSpan(cd).to);
  });

  it("对照:两份同时结束,不记第二个结束", () => {
    const cd = round(21, 21);
    expect(cd.casterCopyEndSeconds).toBeUndefined();
    expect(casterCopyEndSeconds(cd)).toBeCloseTo(21, 3);
  });

  it("队友那份没有观测到结束(REMOVED 缺失):施法者自己观测到的结束仍被记下 (codex 85-tk-WIN-T161-1 #1)", () => {
    const cd = round(16, null);
    expect(cd.buffEndSeconds).toBeGreaterThan(16);
    expect(casterCopyEndSeconds(cd)).toBeCloseTo(16, 3);
    expect(ledgerCastSpan(cd).to).toBeCloseTo(16, 3);
  });

  it("对面偷走的那份不是施法者的结束:账本读施法者自己那份 (codex 85-tk-WIN-T161-1 #2)", () => {
    const cd = round(11, 20);
    const units = (cd.combat as { units: Record<string, ICombatUnit> }).units;
    // an opposing mage steals the priest's copy at 11 s and keeps it to 25 s
    units["mage"] = makeUnit("mage", {
      name: "Mage",
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Friendly,
      info: { talents: [], pvpTalents: [] } as never,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 11, "mage"),
        aura(LogEvent.SPELL_AURA_REMOVED, 25, "mage"),
      ],
      actionOut: [
        {
          logLine: { event: LogEvent.SPELL_STOLEN, timestamp: at(11) },
          timestamp: at(11),
          srcUnitId: "mage",
          extraSpellId: PI,
        } as never,
      ],
    });
    // a new combat object: the aura index is memoised per combat
    const stolen = reconstructEnemyCDTimeline(
      [units["priest"]!, units["hunter"]!],
      { startTime: T0, endTime: at(120), units: { ...units } } as never,
    )
      .players.find((p) => p.playerName === "Priest")!
      .offensiveCDs.find((c) => c.spellId === PI)!;
    // the thief's copy is the one that ended last (the threat reading)
    expect(stolen.buffEndSeconds).toBeCloseTo(25, 3);
    expect(ledgerCastSpan(stolen).to).toBeCloseTo(11, 3);
  });

  it("效果还在敌方目标身上跑、日志里没有它的结束:那不是「另一份副本」,账本不在施法者光环处截断 (codex 80-WSL-B250-1 #1, 842247a0 r6)", () => {
    // The Hunt pressed at 10 s: its 370965 buff on the demon hunter comes
    // off 0.109 s later, its root 370970 and damage over time 370969 go up
    // on the target; the round ends before the damage over time's REMOVED
    const HUNT = "370965";
    const row = (ev: LogEvent, id: string, s: number, dest: string) => ({
      ...makeAuraEvent(
        ev,
        id,
        at(s),
        "dh",
        dest,
        dest === "dh" ? "BUFF" : "DEBUFF",
      ),
      srcUnitName: "Dh",
    });
    const build = (mateCopy: boolean) => {
      const dh: ICombatUnit = makeUnit("dh", {
        name: "Dh",
        class: CombatUnitClass.DemonHunter,
        spec: CombatUnitSpec.DemonHunter_Havoc,
        reaction: CombatUnitReaction.Hostile,
        info: { talents: [], pvpTalents: [] } as never,
        spellCastEvents: [
          makeSpellCastEvent(HUNT, at(10), "target", "Target", "dh", "Dh"),
        ],
        auraEvents: [
          row(LogEvent.SPELL_AURA_APPLIED, HUNT, 9.998, "dh"),
          row(LogEvent.SPELL_AURA_REMOVED, HUNT, 10.109, "dh"),
        ],
      });
      const target: ICombatUnit = makeUnit("target", {
        name: "Target",
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Arms,
        reaction: CombatUnitReaction.Friendly,
        info: { talents: [], pvpTalents: [] } as never,
        auraEvents: [
          row(LogEvent.SPELL_AURA_APPLIED, "370970", 10.108, "target"),
          row(LogEvent.SPELL_AURA_APPLIED, "370969", 10.109, "target"),
          row(LogEvent.SPELL_AURA_REFRESH, "370969", 10.109, "target"),
          row(LogEvent.SPELL_AURA_REMOVED, "370970", 11.619, "target"),
        ],
      });
      // control: the same open aura on a TEAMMATE of the caster is another
      // unit's copy, and the caster's own end is still kept (-T161-1 #1)
      const mate: ICombatUnit = makeUnit("mate", {
        name: "Mate",
        class: CombatUnitClass.Hunter,
        spec: CombatUnitSpec.Hunter_Marksmanship,
        reaction: CombatUnitReaction.Hostile,
        info: { talents: [], pvpTalents: [] } as never,
        auraEvents: mateCopy
          ? [row(LogEvent.SPELL_AURA_APPLIED, "370969", 10.109, "mate")]
          : [],
      });
      const combat = {
        startTime: T0,
        endTime: at(16.5),
        units: mateCopy ? { dh, mate } : { dh, target, mate },
      } as never;
      return reconstructEnemyCDTimeline([dh, mate], combat)
        .players.find((p) => p.playerName === "Dh")!
        .offensiveCDs.find((c) => c.spellId === HUNT)!;
    };
    const cd = build(false);
    expect(cd.casterCopyEndSeconds).toBeUndefined();
    expect(cd.buffEndSeconds).toBeGreaterThan(15);
    expect(ledgerCastSpan(cd)).toEqual(burstCastSpan(cd));
    expect(ledgerCastSpan(cd).to).toBeGreaterThan(15);
    const onMate = build(true);
    expect(onMate.buffEndSeconds).toBeGreaterThan(15);
    expect(ledgerCastSpan(onMate).to).toBeCloseTo(10.109, 3);
  });

  it("R89:队友重叠那句读账本持有者身上那份;持有者身上没有副本时读施法者自己的", () => {
    const cd = round(16, 21);
    // the hunter's ledger: the priest's press put a copy on the hunter
    expect(allyOverlapSpan(cd, cd.priest, "hunter", cd.combat)).toEqual({
      from: 10,
      to: 21,
    });
    // a third teammate's ledger: no copy on it — the caster's own copy
    expect(allyOverlapSpan(cd, cd.priest, "third", cd.combat).to).toBeCloseTo(
      16,
      3,
    );
    // the holder's copy ended FIRST (purged at 13 s, the priest's ran to
    // 21 s): the overlap ends with the holder's (codex 85-tk-WIN-T161-2 #1)
    const early = round(21, 13);
    expect(
      allyOverlapSpan(early, early.priest, "hunter", early.combat),
    ).toEqual({ from: 10, to: 13 });
    expect(ledgerCastSpan(early).to).toBeCloseTo(21, 3);
    // the holder's copy has no logged end (still up): it is a copy, read to
    // the press's own end — not the caster's earlier one (codex
    // 85-tk-WIN-T161-4 #1)
    const open = round(16, null);
    expect(allyOverlapSpan(open, open.priest, "hunter", open.combat)).toEqual({
      from: 10,
      to: open.buffEndSeconds,
    });
    expect(open.buffEndSeconds).toBeGreaterThan(16);
    // …and a third teammate with no copy still reads the caster's
    expect(
      allyOverlapSpan(open, open.priest, "third", open.combat).to,
    ).toBeCloseTo(16, 3);
    // control: copies that ended together have one reading
    const same = round(21, 21);
    expect(allyOverlapSpan(same, same.priest, "hunter", same.combat)).toEqual(
      ledgerCastSpan(same),
    );
  });

  it("施法者那份的结束不会晚于构建器后来截短的 buffEndSeconds", () => {
    expect(
      casterCopyEndSeconds({ buffEndSeconds: 14, casterCopyEndSeconds: 16 }),
    ).toBe(14);
    // the span never ends before the press
    expect(
      ledgerCastSpan({
        castTimeSeconds: 10,
        buffEndSeconds: 21,
        casterCopyEndSeconds: 9,
      }).to,
    ).toBe(10);
  });
});
