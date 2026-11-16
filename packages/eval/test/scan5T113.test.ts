/**
 * scan5/t113 `hitEndPastOwnAction` (T113): the `[ENEMY DEF]` line form the
 * check reads — a stealth-kind immunity an aimed hit ended.
 */
import { describe, expect, it } from "vitest";

import { LINE_RE } from "../scripts/scan5/t113";

describe("scan5/t113 LINE_RE", () => {
  it("reads the time, the pid, the aura and the printed length", () => {
    const m = LINE_RE.exec(
      "0:11  [ENEMY DEF]   5(AMage) (Arcane Mage): Mass Invisibility (immune, 10.8s — ended by a hit; also on 4(RShaman), 6(RPaladin))",
    );
    expect(m?.slice(1, 6)).toEqual([
      "0",
      "11",
      "5",
      "Mass Invisibility",
      "10.8",
    ]);
  });
  it("skips a line that states no hit end", () => {
    expect(
      LINE_RE.exec(
        "0:11  [ENEMY DEF]   5(AMage) (Arcane Mage): Mass Invisibility (immune, end not logged)",
      ),
    ).toBeNull();
  });
});
