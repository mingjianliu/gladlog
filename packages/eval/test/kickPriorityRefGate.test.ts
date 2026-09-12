import { lookupKickPriorityPrior } from "@gladlog/analysis/src/data/kickPriorityPrior";
import { describe, expect, it } from "vitest";

import { checkKickPriorityRefConsistency } from "../src/quality/promptQualityCheck";

const line = (facts: string, type = "kick-priority-missed") =>
  `- id=${type}:P1:100 type=${type} t=100 units=Priest facts={${facts}}`;

describe("checkKickPriorityRefConsistency (17th hardFailure class, GH #78)", () => {
  it("other types are ignored; a kick-priority line without facts fails", () => {
    expect(checkKickPriorityRefConsistency(["- id=x type=cd-waste t=1 units=Y facts={t=0:01}"])).toHaveLength(0);
    expect(checkKickPriorityRefConsistency(["- id=kick-priority-missed:P1:1 type=kick-priority-missed t=1 units=Y"])).toHaveLength(1);
  });
  it("matching numbers pass, one digit off fails; with an empty table every line fails", () => {
    const ref = lookupKickPriorityPrior();
    if (!ref) {
      expect(checkKickPriorityRefConsistency([line("t=1:40, refNCompleted=1")])).toHaveLength(1);
      return;
    }
    const ok = `t=1:40, refNCompleted=${ref.nCompleted}, refNInterrupted=${ref.nInterrupted}, refDeathCompleted=${ref.deathCompletedPct}, refDeathInterrupted=${ref.deathInterruptedPct}`;
    expect(checkKickPriorityRefConsistency([line(ok), line(ok, "kick-priority-team")])).toHaveLength(0);
    expect(checkKickPriorityRefConsistency([line(ok.replace(`refDeathInterrupted=${ref.deathInterruptedPct}`, `refDeathInterrupted=${ref.deathInterruptedPct + 1}`))])).toHaveLength(1);
  });
});
