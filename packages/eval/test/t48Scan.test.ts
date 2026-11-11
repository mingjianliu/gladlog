/**
 * scan5/t48 (GH #123.10): the DB2 duration reductions the check walks, and
 * the clean lives it reads — a summon's SPELL_SUMMON → UNIT_DIED from the raw
 * rows, an aura's run through the shared `cleanAuraRuns` — minus the lives
 * something else ended (codex 85-tk-G-T48-1 #1 / #2).
 */
import { describe, expect, it } from "vitest";

import {
  auraLives,
  forcedEnd,
  rowsOf,
  SHORTENINGS,
  summonLives,
} from "../scripts/scan5/t48";

const row = (
  ms: number,
  event: string,
  src: string,
  dest: string,
  spellId = "",
) => ({ ms, event, src, dest, spellId });
const aura = (ms: number, event: string, src: string, dest: string) => ({
  spellId: "445474",
  srcUnitId: src,
  destUnitId: dest,
  timestamp: ms,
  logLine: { event, timestamp: ms },
});

describe("scan5/t48 shortenedDuration", () => {
  it("DB2 的缩短行:天神之赐 → 朱鹤 / 青龙 −13 s;树皮术 −40 %", () => {
    const of = (talent: string, target: string) =>
      SHORTENINGS.find((s) => s.talent === talent && s.target === target);
    expect(of("388212", "325197")).toMatchObject({ kind: "flat", value: -13 });
    expect(of("388212", "322118")).toMatchObject({ kind: "flat", value: -13 });
    expect(of("1250923", "22812")).toMatchObject({ kind: "pct", value: -40 });
    // an extension is not in the list
    expect(of("327993", "22812")).toBeUndefined();
  });

  it("召唤物:SPELL_SUMMON → 自己的 UNIT_DIED;别人的召唤物、别的死亡不算", () => {
    const rows = [
      row(1000, "SPELL_SUMMON", "P1", "C1", "325197"),
      row(2000, "SPELL_SUMMON", "P2", "C2", "325197"),
      row(5000, "UNIT_DIED", "", "X"),
      row(13150, "UNIT_DIED", "", "C1"),
      row(27000, "UNIT_DIED", "", "C2"),
    ];
    expect(summonLives(rows, "P1", "325197")).toEqual([
      { startMs: 1000, endMs: 13150, dest: "C1", summon: true },
    ]);
  });

  it("光环走共用读法:同毫秒 REMOVED → APPLIED 重播是一段;REFRESH 过的不算;没 REMOVED 的不算", () => {
    const units = [
      { id: "P1", auraEvents: [], spellCastEvents: [] },
      {
        id: "E1",
        auraEvents: [
          aura(0, "SPELL_AURA_APPLIED", "P1", "E1"),
          // the re-broadcast codex found on 605: one run, not a 15.5 s life
          aura(15_486, "SPELL_AURA_REMOVED", "P1", "E1"),
          aura(15_486, "SPELL_AURA_APPLIED", "P1", "E1"),
          aura(17_000, "SPELL_AURA_REMOVED", "P1", "E1"),
          aura(40_000, "SPELL_AURA_APPLIED", "P1", "E1"),
          aura(45_000, "SPELL_AURA_REFRESH", "P1", "E1"),
          aura(60_000, "SPELL_AURA_REMOVED", "P1", "E1"),
          aura(70_000, "SPELL_AURA_APPLIED", "P1", "E1"),
        ],
      },
    ];
    expect(auraLives(units, "445474")).toEqual([
      { src: "P1", startMs: 0, endMs: 17_000, dest: "E1" },
    ]);
  });

  it("被别的东西结束的一段不是时长样本:驱散、载体或施放者死亡、回合结束", () => {
    const life = { startMs: 0, endMs: 17_900, dest: "E1" };
    const none = [row(5000, "UNIT_DIED", "", "X")];
    expect(forcedEnd(life, "191587", "P1", none, 100_000)).toBe(false);
    // dispelled at its end
    expect(
      forcedEnd(
        life,
        "191587",
        "P1",
        [row(17_900, "SPELL_DISPEL", "E2", "E1", "191587")],
        100_000,
      ),
    ).toBe(true);
    // another aura dispelled there, or the same one on another carrier
    expect(
      forcedEnd(
        life,
        "191587",
        "P1",
        [
          row(17_900, "SPELL_DISPEL", "E2", "E1", "55095"),
          row(17_900, "SPELL_DISPEL", "E2", "E3", "191587"),
        ],
        100_000,
      ),
    ).toBe(false);
    // carrier died, caster died, round ended
    expect(
      forcedEnd(
        life,
        "191587",
        "P1",
        [row(17_500, "UNIT_DIED", "", "E1")],
        1e6,
      ),
    ).toBe(true);
    expect(
      forcedEnd(
        life,
        "191587",
        "P1",
        [row(18_300, "UNIT_DIED", "", "P1")],
        1e6,
      ),
    ).toBe(true);
    expect(forcedEnd(life, "191587", "P1", none, 18_500)).toBe(true);
    // a summon's own death row is its end
    const summon = {
      startMs: 0,
      endMs: 12_000,
      dest: "C1",
      summon: true as const,
    };
    expect(
      forcedEnd(
        summon,
        "325197",
        "P1",
        [row(12_000, "UNIT_DIED", "", "C1")],
        1e6,
      ),
    ).toBe(false);
  });

  it("rowsOf:驱散行读被驱散的光环 id(第 12 个参数)", () => {
    const line =
      '11/5/2026 18:52:00.158-5  SPELL_DISPEL,Player-1-A,"A",0x511,0x0,Player-1-B,"B",0x10548,0x0,527,"Purify",0x2,191587,"Virulent Plague",32,DEBUFF';
    const [r] = rowsOf([line]);
    expect(r).toMatchObject({
      event: "SPELL_DISPEL",
      dest: "Player-1-B",
      spellId: "191587",
    });
  });
});
