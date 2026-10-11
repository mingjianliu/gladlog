import { cdWasteSpellFact } from "@gladlog/analysis/src/analysis/candidateFindings";
import { describe, expect, it } from "vitest";

import { checkCdWasteSharedCooldown } from "../src/quality/promptQualityCheck";

// X1: one cd-waste row per cooldown. Shapes from the 605-file capture
// (fe1a9355 / s0/101-3-557: a Holy Paladin's menu with a Blessing of
// Protection row and a Blessing of Spellwarding row — DB2 ChargeCategory
// 1392, one cooldown).
const UNIT = "Bumbiing-Illidan-US";
const GUID = "Player-57-0DAA1122";
const row = (spellId: string, spell: string, guid = GUID, unit = UNIT) =>
  `  - id=cd-waste:${guid}:${spellId} type=cd-waste t=whole-round units=${unit} facts={spell=${spell}, unit=${unit}}`;
const kit = (cooldowns: string, name = UNIT) => [
  `  <unit id="1" name="${name}" spec="Holy Paladin" role="log owner">`,
  `    <cooldowns>${cooldowns}</cooldowns>`,
  "  </unit>",
];
const KIT = kit(
  "Divine Shield [210s, lasts 8s], Blessing of Protection [300s, lasts 10s] [UNUSED], Blessing of Spellwarding [180s, lasts 6s] [UNUSED], Lay on Hands [420s] [UNUSED]",
);
const SHARED = cdWasteSpellFact([
  "Blessing of Protection",
  "Blessing of Spellwarding",
]);

describe("checkCdWasteSharedCooldown", () => {
  it("passes the producer's one row for the two blessings, beside other cd-waste rows", () => {
    expect(
      checkCdWasteSharedCooldown([
        row("1022", SHARED),
        row("471195", "Lay on Hands"),
        ...KIT,
      ]),
    ).toEqual([]);
  });

  it("mutation: the menu as it was before X1 — a row each — fails", () => {
    const fails = checkCdWasteSharedCooldown([
      row("1022", "Blessing of Protection"),
      row("471195", "Lay on Hands"),
      row("204018", "Blessing of Spellwarding"),
      ...KIT,
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "cd-waste 行的技能 204018 与第 1 行的 1022 是同一个冷却",
    );
    // … and a joined row beside a row of its other button fails too
    expect(
      checkCdWasteSharedCooldown([
        row("1022", SHARED),
        row("204018", "Blessing of Spellwarding"),
      ]),
    ).toHaveLength(1);
  });

  it("two units' rows are two cooldowns", () => {
    expect(
      checkCdWasteSharedCooldown([
        row("1022", "Blessing of Protection"),
        row(
          "204018",
          "Blessing of Spellwarding",
          "Player-11-0EBAA61B",
          "Sunnyk-Tichondrius-US",
        ),
      ]),
    ).toEqual([]);
  });

  it("mutation: a joined row names one button, a button the kit lacks, or one the kit does not call unused", () => {
    expect(
      checkCdWasteSharedCooldown([
        row("1022", "Blessing of Protection (one shared cooldown)"),
      ])[0],
    ).toContain("却只列了一个技能");
    expect(
      checkCdWasteSharedCooldown([
        row("1022", SHARED),
        ...kit("Blessing of Protection [300s, lasts 10s] [UNUSED]"),
      ])[0],
    ).toContain("Blessing of Spellwarding 不在 Bumbiing-Illidan-US 的");
    expect(
      checkCdWasteSharedCooldown([
        row("1022", SHARED),
        ...kit(
          "Blessing of Protection [300s, lasts 10s] [UNUSED], Blessing of Spellwarding [180s, lasts 6s], Hammer of Justice [30s]",
        ),
      ])[0],
    ).toContain("Blessing of Spellwarding 在 <cooldowns> 里不是 [UNUSED]");
  });

  it("without a loadout only the rows themselves are judged", () => {
    expect(checkCdWasteSharedCooldown([row("1022", SHARED)])).toEqual([]);
  });
});
