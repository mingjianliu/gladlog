/**
 * scan5/t48 (GH #123.10): the DB2 duration reductions the check walks, and
 * the clean lives it reads from the raw rows (a summon's SPELL_SUMMON →
 * UNIT_DIED, an aura's APPLIED → REMOVED with no REFRESH between).
 */
import { describe, expect, it } from "vitest";

import { cleanLives, SHORTENINGS } from "../scripts/scan5/t48";

const row = (
  ms: number,
  event: string,
  src: string,
  dest: string,
  spellId = "",
) => ({ ms, event, src, dest, spellId });

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
    expect(cleanLives(rows, "P1", "325197")).toEqual([
      { startMs: 1000, seconds: 12.15 },
    ]);
  });

  it("光环:中间 REFRESH 过的一段不算;没有 REMOVED 的不算", () => {
    const rows = [
      row(0, "SPELL_AURA_APPLIED", "P1", "P1", "22812"),
      row(7200, "SPELL_AURA_REMOVED", "P1", "P1", "22812"),
      row(10000, "SPELL_AURA_APPLIED", "P1", "P1", "22812"),
      row(12000, "SPELL_AURA_REFRESH", "P1", "P1", "22812"),
      row(19000, "SPELL_AURA_REMOVED", "P1", "P1", "22812"),
      row(30000, "SPELL_AURA_APPLIED", "P1", "P1", "22812"),
    ];
    expect(cleanLives(rows, "P1", "22812")).toEqual([
      { startMs: 0, seconds: 7.2 },
    ]);
  });
});
