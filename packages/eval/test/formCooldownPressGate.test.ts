import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import { checkFormCooldownPressSpacing } from "../src/quality/promptQualityCheck";

/**
 * F11: Incarnation: Tree of Life logs a cast for the press and for every
 * shift back into the form while its 30 s "Incarnation" buff runs; a press
 * line is a press. Two of one unit's inside that buff are a shift back
 * printed as a second press.
 */
beforeAll(async () => {
  await ensureAnalysisData();
});

const YOU = (t: string) =>
  `${t}  [YOU] [CD]   Incarnation: Tree of Life (self: 72% HP, -5%/s, 90k DPS)`;
const TEAM = (t: string, pid = "2(RDruid)") =>
  `${t}  [TEAM] [CD]   ${pid} (Restoration Druid): Incarnation: Tree of Life`;
const ENEMY = (t: string, pid = "4(RDruid)", tail = "") =>
  `${t}  [ENEMY HEAL CD]   ${pid} (Restoration Druid): Incarnation: Tree of Life${tail}`;

describe("checkFormCooldownPressSpacing (F11)", () => {
  it("presses a cooldown apart pass, on every press tag", () => {
    expect(
      checkFormCooldownPressSpacing([
        YOU("0:22"),
        YOU("2:06"),
        TEAM("0:16"),
        TEAM("1:43"),
        ENEMY("0:27", "4(RDruid)", " (cast 1 of 2)"),
        ENEMY("2:41", "4(RDruid)", " (cast 2 of 2)"),
      ]),
    ).toEqual([]);
  });

  it("mutation — 14055cb2's shift back printed as a third press fails", () => {
    const f = checkFormCooldownPressSpacing([
      ENEMY("0:27", "4(RDruid)", " (cast 1 of 3)"),
      ENEMY("2:41", "4(RDruid)", " (cast 2 of 3)"),
      ENEMY("3:05", "4(RDruid)", " (cast 3 of 3)"),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/line 3: Incarnation: Tree of Life .* 24s after/);
  });

  it("mutation — the owner's and a teammate's too", () => {
    expect(
      checkFormCooldownPressSpacing([YOU("0:22"), YOU("0:45")]),
    ).toHaveLength(1);
    expect(
      checkFormCooldownPressSpacing([TEAM("0:16"), TEAM("0:42")]),
    ).toHaveLength(1);
  });

  it("the bound is the printed grid's: 28 printed seconds fail, 29 do not", () => {
    // two casts under 30 s apart can print up to 30 s apart
    expect(
      checkFormCooldownPressSpacing([YOU("1:00"), YOU("1:28")]),
    ).toHaveLength(1);
    expect(checkFormCooldownPressSpacing([YOU("1:00"), YOU("1:29")])).toEqual(
      [],
    );
  });

  it("two units, and other spells, are not compared", () => {
    expect(
      checkFormCooldownPressSpacing([
        TEAM("0:16", "2(RDruid)"),
        TEAM("0:20", "3(RDruid)"),
        ENEMY("0:25", "4(RDruid)"),
        YOU("0:30"),
        "0:31  [YOU] [CD]   Tranquility (self: 80% HP)",
        "0:40  [YOU] [CD]   Tranquility (self: 80% HP)",
        "0:41  [YOU] [CAST]   Incarnation: Tree of Life",
      ]),
    ).toEqual([]);
  });
});
