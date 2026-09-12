import { lookupBacklashPrior } from "@gladlog/analysis/src/data/backlashDispelPrior";
import { describe, expect, it } from "vitest";

import { checkBacklashRefConsistency } from "../src/quality/promptQualityCheck";

const line = (facts: string, type = "backlash-dispel") =>
  `- id=${type}:P1:65 type=${type} t=65 units=Dps facts={${facts}}`;

describe("checkBacklashRefConsistency (16th hardFailure class, GH #80)", () => {
  it("a backlash-dispel line without refKey, or with a key the table cannot serve, is a hard failure", () => {
    expect(checkBacklashRefConsistency([line("t=1:05, target=Dps")])).toHaveLength(1);
    expect(
      checkBacklashRefConsistency([line("t=1:05, refKey=999999, refN=5")]),
    ).toHaveLength(1);
    expect(
      checkBacklashRefConsistency([
        line("t=1:05, refKey=999999:worth, refND=5", "backlash-dispel-window"),
      ]),
    ).toHaveLength(1);
  });
  it("lines of other types are ignored", () => {
    expect(
      checkBacklashRefConsistency([
        "- id=cd-hoarded:P1:1 type=cd-hoarded t=1 units=X facts={t=0:01}",
      ]),
    ).toHaveLength(0);
  });
  it("a rendered reference that matches the table passes; one digit off fails (only when the table has the UA cell)", () => {
    const ref = lookupBacklashPrior("1259790");
    if (!ref) return; // placeholder table — the producer would not have emitted either
    const ok = `t=1:05, refKey=1259790, refN=${ref.n}, refRemovedK=${ref.removedK}, refHealLostK=${ref.healLostK}, refBacklashDmgK=${ref.backlashDmgK}, refCcExposureS=${ref.ccExposureS}, backlash=${ref.backlashKind} ${ref.backlashS}s`;
    expect(checkBacklashRefConsistency([line(ok)])).toHaveLength(0);
    expect(
      checkBacklashRefConsistency([line(ok.replace(`refN=${ref.n}`, `refN=${ref.n + 1}`))]),
    ).toHaveLength(1);
  });
});
