/**
 * 19th hardFailure class (GH #95, 2026-09-17): `checkTeammateCrisisRefConsistency`
 * re-parses a `teammate-crisis-idle` menu line and demands the SAME
 * `lookupTeammateCrisisPriorByBin(bracket, bin)` the producer rendered it
 * from. Expected values come from the lookup itself, never re-typed; the
 * fixture picks a real cell out of the generated table so the test moves
 * with the data. While the table is still the placeholder (no cells) only
 * the fail-closed cases run.
 */
import {
  lookupTeammateCrisisPriorByBin,
  lookupTeammateCrisisTriageByBin,
  type TeammateCrisisDmgBin,
} from "@gladlog/analysis/src/data/teammateCrisisPrior";
import RAW from "@gladlog/analysis/src/data/teammateCrisisPriorGenerated.json";
import { describe, expect, it } from "vitest";

import { checkTeammateCrisisRefConsistency } from "../src/quality/promptQualityCheck";

const CELLS = (RAW as any).cells as Record<string, unknown>;
const firstKey = Object.keys(CELLS).find((k) => {
  const [b, bin] = k.split("|") as [string, string];
  if (bin === "*") return false;
  const r = lookupTeammateCrisisPriorByBin(b, bin as TeammateCrisisDmgBin);
  return r !== null && r.cellKey === k;
});
const REF = firstKey
  ? (() => {
      const [b, bin] = firstKey.split("|") as [string, TeammateCrisisDmgBin];
      return { bracket: b, bin, ...lookupTeammateCrisisPriorByBin(b, bin)! };
    })()
  : null;
const dmgFor = (bin: string) =>
  bin === "10-20%" ? 15 : bin === "20-30%" ? 25 : 35;

function line(over: Record<string, string> = {}): string {
  const r = REF!;
  const f: Record<string, string> = {
    t: "47",
    unit: "Heals-R",
    mate: "Mate-R",
    mateHpPct: "38",
    dmg2sPct: String(dmgFor(r.bin)),
    attackers: "Foe-R",
    windowFrom: "0:45",
    windowTo: "0:50",
    distanceYd: "12",
    externalsReady: "none",
    burst: "none",
    burstCue: "no",
    refNIdle: String(r.nIdle),
    refDeathIdle: String(r.deathIdlePct),
    refNAnswered: String(r.nAnswered),
    refDeathAnswered: String(r.deathAnsweredPct),
    cellKey: r.cellKey,
    fellBack: r.fellBack ? "yes" : "no",
    ...over,
  };
  const facts = Object.entries(f)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `  - id=teammate-crisis-idle:H:M:47 type=teammate-crisis-idle t=47 facts={${facts}}`;
}

describe("checkTeammateCrisisRefConsistency", () => {
  it("a line without facts, or with a malformed cellKey, fails closed", () => {
    expect(
      checkTeammateCrisisRefConsistency([
        "  - id=x type=teammate-crisis-idle t=1",
      ]),
    ).toHaveLength(1);
    expect(
      checkTeammateCrisisRefConsistency([
        "  - id=x type=teammate-crisis-idle t=1 facts={dmg2sPct=25, cellKey=3v3}",
      ]),
    ).toHaveLength(1);
  });

  it("a reference to a cell the table does not have (or under the n floor) fails", () => {
    const out = checkTeammateCrisisRefConsistency([
      "  - id=x type=teammate-crisis-idle t=1 facts={dmg2sPct=25, cellKey=Nowhere|20-30%, refNIdle=1}",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("查不到");
  });

  it("other candidate types are ignored", () => {
    expect(
      checkTeammateCrisisRefConsistency([
        "  - id=x type=crisis-no-response t=1 facts={dmg2sPct=25, cellKey=3v3|healer|>=20%}",
      ]),
    ).toHaveLength(0);
  });

  const withTable = REF ? it : it.skip;
  withTable(
    "a line rendered from the lookup passes; a drifted number, cellKey bin or fellBack fails",
    () => {
      expect(checkTeammateCrisisRefConsistency([line()])).toHaveLength(0);
      expect(
        checkTeammateCrisisRefConsistency([
          line({ refDeathIdle: String(REF!.deathIdlePct + 1) }),
        ]),
      ).toHaveLength(1);
      expect(
        checkTeammateCrisisRefConsistency([
          line({ refNAnswered: String(REF!.nAnswered + 1) }),
        ]),
      ).toHaveLength(1);
      expect(
        checkTeammateCrisisRefConsistency([
          line({ fellBack: REF!.fellBack ? "no" : "yes" }),
        ]),
      ).toHaveLength(1);
      // the bin inside cellKey must agree with the rendered dmg2sPct
      const otherBin = REF!.bin === "10-20%" ? "20-30%" : "10-20%";
      expect(
        checkTeammateCrisisRefConsistency([
          line({ cellKey: `${REF!.bracket}|${otherBin}` }),
        ]),
      ).toHaveLength(1);
    },
  );

  // teammate-crisis-triage (user ruling 2026-09-17): same gate, its own lookup
  const triageKey = Object.keys(CELLS).find((k) => {
    const [b, bin] = k.split("|") as [string, string];
    const r = lookupTeammateCrisisTriageByBin(
      b,
      bin as TeammateCrisisDmgBin | "*",
    );
    return r !== null && r.cellKey === k;
  });
  const TREF = triageKey
    ? (() => {
        const [b, bin] = triageKey.split("|") as [
          string,
          TeammateCrisisDmgBin | "*",
        ];
        return { bracket: b, bin, ...lookupTeammateCrisisTriageByBin(b, bin)! };
      })()
    : null;
  const triageLine = (over: Record<string, string> = {}) => {
    const r = TREF!;
    const f: Record<string, string> = {
      t: "47",
      unit: "Heals-R",
      mate: "Mate-R",
      mateHpPct: "38",
      dmg2sPct: r.bin === "*" ? "25" : String(dmgFor(r.bin)),
      castOn: "Friend-R",
      castOnHpPct: "71",
      castSpell: "Rejuvenation",
      refNWrong: String(r.nTriageWrong),
      refDeathWrong: String(r.deathTriageWrongPct),
      refNOther: String(r.nTriageOther),
      refDeathOther: String(r.deathTriageOtherPct),
      cellKey: r.cellKey,
      fellBack: r.bin === "*" || r.fellBack ? "yes" : "no",
      ...over,
    };
    const facts = Object.entries(f)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    return `  - id=teammate-crisis-triage:H:M:47 type=teammate-crisis-triage t=47 facts={${facts}}`;
  };
  const withTriage = TREF ? it : it.skip;
  withTriage(
    "a triage line rendered from its lookup passes; a drifted triage number fails; a triage line quoting idle fields fails",
    () => {
      // the bracket-wide cell can be resolved from any bin's dmg2sPct; when the
      // fine cell exists the line must carry that bin's dmg2sPct
      expect(checkTeammateCrisisRefConsistency([triageLine()])).toHaveLength(0);
      expect(
        checkTeammateCrisisRefConsistency([
          triageLine({ refDeathWrong: String(TREF!.deathTriageWrongPct + 1) }),
        ]),
      ).toHaveLength(1);
      expect(
        checkTeammateCrisisRefConsistency([
          triageLine({ refNOther: String(TREF!.nTriageOther + 1) }),
        ]),
      ).toHaveLength(1);
    },
  );
});
