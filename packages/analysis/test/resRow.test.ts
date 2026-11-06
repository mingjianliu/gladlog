import { describe, expect, it } from "vitest";

import {
  isResRowLine,
  parseResRow,
  resLedgerName,
  splitResList,
} from "../src/context/resRow";

// GH #178: the one reader of a [RES] row's text
describe("parseResRow", () => {
  it("reads every field of a full row", () => {
    const r = parseResRow(
      "      [RES] rdy:Ironbark,2:Blessing of Sacrifice[1/2]  cd:Barkskin(31s),3:Ice Block(1–4s) | Atonements: 3  enemy:Incarnation: Chosen of Elune/Balance Druid(2s left)  focus:2  cc:3/Wind Shear-1s[kick]",
    );
    expect(r).toEqual({
      rdy: "Ironbark,2:Blessing of Sacrifice[1/2]",
      delta: false,
      cd: "Barkskin(31s),3:Ice Block(1–4s)",
      atonements: 3,
      enemy: "Incarnation: Chosen of Elune/Balance Druid(2s left)",
      focus: "2",
      cc: "3/Wind Shear-1s[kick]",
    });
  });

  it("a change list is a delta, the bare Δ too", () => {
    expect(
      parseResRow(
        "      [RES] rdy:Δ +Ironbark -2:Pain Suppression ~Vanish[1/2]  cd:—",
      ),
    ).toMatchObject({
      rdy: "Δ +Ironbark -2:Pain Suppression ~Vanish[1/2]",
      delta: true,
      cd: "—",
    });
    expect(parseResRow("      [RES] rdy:Δ  cd:—")).toMatchObject({
      rdy: "Δ",
      delta: true,
    });
    expect(parseResRow("      [RES] rdy:—  cd:—")?.delta).toBe(false);
  });

  it("the legend's own [RES] lines are no rows", () => {
    for (const l of [
      "  [RES] rdy: = abilities READY then. `rdy:Δ` = unchanged since the previous [RES]",
      "  [RES] lists TRACKED major cooldowns — absent from both `rdy:` and `cd:`",
      "  On the [RES] row under a friendly [DEATH], a positional cooldown (Darkness: …",
      "1:02  [PRESS]   2(HPaladin) (Holy Paladin): Holy Bulwark (lasts 20s)",
    ]) {
      expect(isResRowLine(l)).toBe(false);
      expect(parseResRow(l)).toBeUndefined();
    }
  });
});

describe("splitResList / resLedgerName", () => {
  it('splits on a bare comma only — a name may hold ", "', () => {
    expect(
      splitResList("Invoke Chi-Ji, the Red Crane(12s),2:Ice Block(3s)"),
    ).toEqual(["Invoke Chi-Ji, the Red Crane(12s)", "2:Ice Block(3s)"]);
  });
  it("drops the charge and mana suffixes", () => {
    expect(resLedgerName(" Vanish[1/2]")).toBe("Vanish");
    expect(resLedgerName("Divine Steed[1–2/2]")).toBe("Divine Steed");
    expect(resLedgerName("Rebirth(no mana 6.1k/11.5k)")).toBe("Rebirth");
  });
});
