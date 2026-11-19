/**
 * The GCD lane's major-cooldown highlight reads analysis's offensive
 * predicate (user ruling R71, 2026-11-18, pipeline T154 — batch review
 * 80-PIPE-152-B138: Champion's Spear 376079 was an offensive cooldown to the
 * prompt and no major cooldown to the lane).
 *
 * The flip list below is the whole difference between the lane's former rule
 * (a `SPELL_CATEGORIES` row of type `buffs_offensive`) and the imported
 * predicate, over every id either side knows. It is pinned so a later change
 * of the offensive table or of the cooldown band shows up here as a diff.
 */
import { isEnemyCdWindowSpell, SPELL_CATEGORIES } from "@gladlog/analysis";
import {
  OFFENSIVE_CD_SPELL_IDS,
  SPEC_GATED_OFFENSIVE_CD_IDS,
} from "@gladlog/analysis/src/utils/spellDanger";
import { describe, expect, it } from "vitest";

import { isMajorCd } from "../src/renderer/src/report/derive/casts";

const FORMER_MAJOR_TYPES = new Set([
  "immunities",
  "buffs_defensive",
  "buffs_offensive",
  "disarms",
]);
const formerIsMajorCd = (id: string): boolean => {
  const t = SPELL_CATEGORIES[id]?.type;
  return t != null && FORMER_MAJOR_TYPES.has(t);
};

/** lit by the ruling: cooldown presses the prompt calls offensive cooldowns */
const TURNED_ON =
  "6353 20572 26297 33697 33702 84714 114050 123904 153561 167105 191427 202770 205021 205636 227847 228260 228920 260243 265187 274738 274837 279302 321507 343527 360194 370965 375901 376079 384352 385059 385627 392983 403631 421453 426591 439843 446035 1246167 1249625 1249658 1250646 1257052 1261193 1276452 "
    .trim()
    .split(" ");
/** dark by the ruling: Archangel (no official cooldown read), Shadow Dance
 * (20 s, under the band's floor), Doom Winds' aura id (its cast 384352 is on) */
const TURNED_OFF = ["81700", "185313", "466772"];

describe("isMajorCd(GCD 泳道大招高亮读 analysis 的进攻大招判据,R71)", () => {
  const ids = [
    ...new Set([
      ...Object.keys(SPELL_CATEGORIES),
      ...OFFENSIVE_CD_SPELL_IDS,
      ...Object.keys(SPEC_GATED_OFFENSIVE_CD_IDS),
    ]),
  ].sort((a, b) => Number(a) - Number(b));

  it("冠军之矛 376079 是大招(改前为 false)", () => {
    expect(formerIsMajorCd("376079")).toBe(false);
    expect(isMajorCd(376079)).toBe(true);
  });

  it("进攻一支就是 isEnemyCdWindowSpell,不是另一张表", () => {
    for (const id of ids)
      if (isEnemyCdWindowSpell(id))
        expect(isMajorCd(Number(id)), id).toBe(true);
    // the other three kinds are still category rows
    for (const id of ids) {
      const t = SPELL_CATEGORIES[id]?.type;
      if (t === "immunities" || t === "buffs_defensive" || t === "disarms")
        expect(isMajorCd(Number(id)), id).toBe(true);
    }
  });

  it("翻转清单:44 个点亮、3 个熄灭,其余不变", () => {
    const on = ids.filter(
      (id) => !formerIsMajorCd(id) && isMajorCd(Number(id)),
    );
    const off = ids.filter(
      (id) => formerIsMajorCd(id) && !isMajorCd(Number(id)),
    );
    expect(on).toEqual(TURNED_ON);
    expect(on).toHaveLength(44);
    expect(off).toEqual(TURNED_OFF);
  });

  it("按专精才算的两个:只在对应专精手里点亮", () => {
    // Divine Toll: Retribution 70, not Holy 65
    expect(isMajorCd(375576)).toBe(false);
    expect(isMajorCd(375576, 70)).toBe(true);
    expect(isMajorCd(375576, 65)).toBe(false);
    // Convoke the Spirits: Balance 102 / Feral 103, not Restoration 105
    expect(isMajorCd(391528, 102)).toBe(true);
    expect(isMajorCd(391528, 103)).toBe(true);
    expect(isMajorCd(391528, 105)).toBe(false);
  });
});
