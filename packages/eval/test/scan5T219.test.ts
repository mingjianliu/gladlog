/**
 * Pipeline T219: scan5/t219's reader of the printed `N purgeable buff[s]`.
 */
import { describe, expect, it } from "vitest";

import { printedPurgeableCounts } from "../scripts/scan5/t219";

describe("scan5/t219 — 行上印出的 N purgeable buffs", () => {
  it("e7a3569f r0 的 [PURGE] 行:目标、增益、N", () => {
    expect(
      printedPurgeableCounts(
        "0:39  [PURGE]   2(AMage) purged Void Shield off 4(WMonk) (1 of 3 purgeable buffs on it) (Spellsteal)",
      ),
    ).toEqual([
      { s: 39, targetPid: "4", buff: "Void Shield", n: 3, row: "removal" },
    ]);
  });

  it("一次按键两条移除、宠物的驱散、单数", () => {
    expect(
      printedPurgeableCounts(
        "1:02  [PURGE]   3(ALock)'s pet purged Power Word: Fortitude off 5(DPriest) (2 of 4 purgeable buffs on it), Body and Soul off 5(DPriest) (2 of 4 purgeable buffs on it) (Devour Magic)",
      ).map((c) => [c.buff, c.targetPid, c.n]),
    ).toEqual([
      ["Power Word: Fortitude", "5", 4],
      ["Body and Soul", "5", 4],
    ]);
    expect(
      printedPurgeableCounts(
        "0:10  [PURGE]   1(RShaman) purged Renew off 4(HPriest) (1 of 1 purgeable buff on it) (Purge)",
      )[0]!.n,
    ).toBe(1);
  });

  it("[ENEMY BUFF] 行的 on it then;没有计数的行不出结果", () => {
    expect(
      printedPurgeableCounts(
        "0:21  [ENEMY BUFF]   6(AWarrior): Power Infusion (purgeable; unpurged for 15s; 5 purgeable buffs on it then)",
      ),
    ).toEqual([
      { s: 21, targetPid: "6", buff: "Power Infusion", n: 5, row: "applied" },
    ]);
    expect(
      printedPurgeableCounts(
        "0:21  [ENEMY BUFF]   6(AWarrior): Power Infusion (purgeable)",
      ),
    ).toEqual([]);
  });

  it("codex #1 真实形态:一行里有不带计数的条目,逐条读,不并成一个名字", () => {
    expect(
      printedPurgeableCounts(
        "0:39  [PURGE]   2(FMage) purged Divine Shield off 6(HPaladin), Power Word: Shield off 4(SPriest) (1 of 5 purgeable buffs on it) (Mass Dispel)",
      ),
    ).toEqual([
      { s: 39, targetPid: "4", buff: "Power Word: Shield", n: 5, row: "removal" },
    ]);
    expect(
      printedPurgeableCounts(
        "0:39  [PURGE]   2(FMage) purged Divine Shield off 6(HPaladin) (1 of 2 purgeable buffs on it), Power Word: Shield off 4(SPriest) (1 of 1 purgeable buff on it) (Mass Dispel)",
      ).map((c) => [c.targetPid, c.buff, c.n]),
    ).toEqual([
      ["6", "Divine Shield", 2],
      ["4", "Power Word: Shield", 1],
    ]);
  });
});
