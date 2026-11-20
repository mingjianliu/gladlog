/**
 * Pipeline T215: scan5/t215's readers of a `[MINOR DISPELS]` line — the
 * spell's press list and its non-deliberate tags.
 */
import { describe, expect, it } from "vitest";

import {
  filedAsNotPressed,
  ownMinorDispelLineRe,
  pressListOf,
} from "../scripts/scan5/t215";

const BEFORE =
  "0:52  [MINOR DISPELS]   3(Mage): Spellsteal (side effect of the cast) x2, Spellsteal (passive) x8 (low-priority, folded)";
const AFTER =
  "0:52  [MINOR DISPELS]   3(Mage): Spellsteal ×3 (0:52 Lifebloom、Rejuvenation; 1:22 Regrowth; 1:47 Eternal Flame) (low-priority, folded)";

describe("scan5/t215 — [MINOR DISPELS] 行的读法", () => {
  it("修复前的行:两个非按键标签都认,没有按键列表", () => {
    expect(filedAsNotPressed(BEFORE, "Spellsteal")).toBe(true);
    expect(pressListOf(BEFORE, "Spellsteal")).toBeUndefined();
  });

  it("修复后的行:没有标签,按键列表给出每次引导的秒", () => {
    expect(filedAsNotPressed(AFTER, "Spellsteal")).toBe(false);
    expect(pressListOf(AFTER, "Spellsteal")).toEqual({
      secs: ["0:52", "1:22", "1:47"],
      truncated: false,
    });
  });

  it("`+N` 截断的列表标成 truncated;别的法术的标签不算", () => {
    expect(
      pressListOf(
        "0:10  [MINOR DISPELS]   3(Mage): Spellsteal ×6 (0:10 A; 0:40 B; 1:10 C; 1:40 D, +2), Remove Curse (passive)",
        "Spellsteal",
      ),
    ).toEqual({ secs: ["0:10", "0:40", "1:10", "1:40"], truncated: true });
    expect(
      filedAsNotPressed(
        "0:10  [MINOR DISPELS]   3(Mage): Spellsteal ×1 (0:10 A), Remove Curse (passive)",
        "Spellsteal",
      ),
    ).toBe(false);
  });

  it("审计日志:被删的增益名自带括号(Germination),列表读到配对的右括号", () => {
    expect(
      pressListOf(
        "0:44  [MINOR DISPELS]   4(AMage): Spellsteal ×5 (0:44 Lifebloom、Rejuvenation (Germination)、Lifebloom; 1:21 Mark of the Wild、Lifebloom; 1:55 Rejuvenation; 2:45 Rejuvenation, +1) (low-priority, folded)",
        "Spellsteal",
      ),
    ).toEqual({ secs: ["0:44", "1:21", "1:55", "2:45"], truncated: true });
  });

  it("审计日志:玩家自己的行,不是它召唤物的 `'s guardian:` 行", () => {
    const re = ownMinorDispelLineRe("3");
    expect(
      re.test(
        "0:52  [MINOR DISPELS]   3(AMage): Spellsteal ×3 (0:52 Lifebloom) (low-priority, folded)",
      ),
    ).toBe(true);
    expect(
      re.test(
        "0:29  [MINOR DISPELS]   3(AMage)'s guardian: Spellsteal (passive) x3 (low-priority, folded)",
      ),
    ).toBe(false);
    expect(re.test("0:52  [MINOR DISPELS]   13(AMage): Spellsteal ×1 (0:52 A)")).toBe(false);
  });
});
