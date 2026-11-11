/**
 * scan5/t72 (pipeline T72, user ruling R19): the five ruled buttons against
 * the producer's own predicate, and the window lines the check reads.
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  isOffensiveCdFor,
  OFFENSIVE_PRESS_FACT_IDS,
} from "@gladlog/analysis/src/utils/spellDanger";
import { describe, expect, it } from "vitest";

import { RULED, WINDOW_RE } from "../scripts/scan5/t72";

describe("scan5/t72 ruledOffensivePress", () => {
  it("R19 的五个技能在生产谓词里都是进攻大招,名字就是名册打印的名字", () => {
    const rosterName = new Map(
      classMetadata.flatMap((c) =>
        c.abilities.map((a) => [String(a.spellId), a.name] as const),
      ),
    );
    expect(Object.keys(RULED).sort()).toEqual(
      ["153561", "375901", "385059", "426591", "439843"].sort(),
    );
    for (const [id, name] of Object.entries(RULED)) {
      expect(isOffensiveCdFor(id, undefined), id).toBe(true);
      expect(OFFENSIVE_PRESS_FACT_IDS.has(id), id).toBe(false);
      expect(rosterName.get(id), id).toBe(name);
      expect(effectiveCooldownSeconds(id), id).toBe(45);
    }
  });

  it("读 [KILL WINDOW] 与 [VULNERABLE] 行的起止秒", () => {
    const kw = WINDOW_RE.exec(
      "  [KILL WINDOW] 1:28–1:34 on Restoration Druid (Unit-Realm): team offensive CDs ready at 1:28: Frostwyrm's Fury (pressed inside: Reaper's Mark 1:31); your CC ready.",
    )!;
    expect([kw[1], kw[2]]).toEqual(["1:28", "1:34"]);
    expect(
      WINDOW_RE.exec(
        "  [VULNERABLE] 0:40–0:52 (12s) on Arcane Mage (Unit-Realm): no major defensives",
      )?.[2],
    ).toBe("0:52");
    expect(WINDOW_RE.exec("1:28  [ENEMY CD]   5(Enemy): Meteor")).toBeNull();
  });
});
