/**
 * FT F22 — two rendering gates.
 *  - `checkBacklashSilenceFamily`: an enemy's dispel-backlash SILENCE
 *    (Unstable Affliction's 196364) is a `[SILENCE]` line, never a
 *    `[CC ON ENEMY]` one (515 lines on the 605-file capture of 8c3275fa).
 *  - `checkTopSourcesOneEntryPerAbility`: a `Top sources` list names one
 *    source + ability once (312 of 20,847 lists named one twice).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  getTopDamageSourcesInWindow,
  parseTopSourceEntries,
} from "@gladlog/analysis/src/context/timelineHelpers";
import { backlashCcTag } from "@gladlog/analysis/src/data/backlashCc";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  checkBacklashSilenceFamily,
  checkTopSourcesOneEntryPerAbility,
} from "../src/quality/promptQualityCheck";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("checkBacklashSilenceFamily (FT F22)", () => {
  const silence = `0:16  [SILENCE]   4(HPriest) ← Unstable Affliction (by 2(AWarlock)) | 4s${backlashCcTag("silence")}`;
  it("the generated [SILENCE] line passes; so do ordinary control and silence lines", () => {
    expect(
      checkBacklashSilenceFamily([
        silence,
        "0:20  [CC ON ENEMY]   4(HPriest) ← Fear (by 2(AWarlock)) (4s) [DR: Disorient Full]",
        "0:30  [CC ON ENEMY]   5(SPriest) ← Sin and Punishment (by 1(SPriest)) (3s)",
        "0:48  [SILENCE]   6(RShaman) ← Garrote - Silence (by 2(ARogue)) | 3s",
        // a break clause that merely names the DoT is not the control
        "0:24  [CC ON ENEMY]   5(BMHunter) ← Howl of Terror (by 2(DWarlock)) (4s) [DR: Disorient Full] | broken by 3(AWarlock)'s Unstable Affliction",
      ]),
    ).toEqual([]);
  });

  it("mutation: the same silence on a [CC ON ENEMY] line fails", () => {
    const out = checkBacklashSilenceFamily([
      "0:16  [CC ON ENEMY]   4(HPriest) ← Unstable Affliction (by 2(AWarlock)) (4s)",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("[SILENCE]");
  });

  it("the landing a [FORCED TRINKET] line cites keeps its [CC ON ENEMY] line — and only that one", () => {
    const forced =
      "1:07  [FORCED TRINKET]  4(HPriest) used PvP trinket inside your team's kill attempt [1:02–1:12] on them → 1:09 your Unstable Affliction landed on 4(HPriest) 2 s later (4s)";
    const kept =
      "1:09  [CC ON ENEMY]   4(HPriest) ← Unstable Affliction (by 2(AWarlock)) (4s)";
    expect(checkBacklashSilenceFamily([forced, kept])).toEqual([]);
    const other =
      "2:09  [CC ON ENEMY]   4(HPriest) ← Unstable Affliction (by 2(AWarlock)) (4s)";
    expect(checkBacklashSilenceFamily([forced, kept, other])).toHaveLength(1);
  });

  it("mutation: the backlash tag on a [SILENCE] line of another spell fails", () => {
    expect(
      checkBacklashSilenceFamily([
        `0:48  [SILENCE]   6(RShaman) ← Garrote - Silence (by 2(ARogue)) | 3s${backlashCcTag("silence")}`,
      ]),
    ).toHaveLength(1);
  });
});

describe("checkTopSourcesOneEntryPerAbility (FT F22)", () => {
  it("what the producer writes passes, and reads back entry for entry", () => {
    const hit = (
      spellId: string,
      spellName: string,
      school: string,
      amount: number,
    ) => ({
      logLine: { timestamp: 5_000 },
      effectiveAmount: -amount,
      srcUnitId: "Player-R",
      srcUnitName: "Rogue-Illidan-US",
      srcUnitFlags: 0x548,
      spellId,
      spellName,
      spellSchoolId: school,
    });
    const list = getTopDamageSourcesInWindow(
      {
        id: "Player-V",
        reaction: CombatUnitReaction.Friendly,
        damageIn: [
          hit("196819", "Eviscerate", "0x1", 85_000),
          hit("328082", "Eviscerate", "0x20", 69_000),
          hit("999003", "Invoke Xuen, the White Tiger", "0x8", 20_000),
        ],
      } as never,
      10_000,
      10_000,
      3,
      new Map(),
      new Map([["Rogue-Illidan-US", 4]]),
    ).join(", ");
    expect(parseTopSourceEntries(list)).toEqual([
      { ability: "4 — Eviscerate", schools: ["Physical", "Shadow"], k: 154 },
      // a comma inside a spell name does not cut the entry
      {
        ability: "4 — Invoke Xuen, the White Tiger",
        schools: ["Nature"],
        k: 20,
      },
    ]);
    expect(
      checkTopSourcesOneEntryPerAbility([
        `                 Top sources: ${list}`,
        "               Top damage in final 10s: 6 — Drain Soul [Shadow] (167k), Refraction (own) (65k), deferred Time Dilation (own) (20k)",
        "                 Top sources: 5 — Bladestorm (270k; 270k of it absorbed), [pet] — Claw [Physical] (12k)",
      ]),
    ).toEqual([]);
  });

  it("mutation: the lists of 8c3275fa fail — one ability split by school tag, or by a missing one", () => {
    expect(
      checkTopSourcesOneEntryPerAbility([
        "                 Top sources: 4 — Eviscerate [Physical] (85k), 5 — Tempest [Nature] (70k), 4 — Eviscerate [Shadow] (69k)",
      ]),
    ).toHaveLength(1);
    expect(
      checkTopSourcesOneEntryPerAbility([
        "                 Top sources: 4 — Blade Dance [Chaos] (229k; 59k of it absorbed), 4 — The Hunt (116k; 116k of it absorbed), 4 — The Hunt [Chaos] (108k)",
      ]),
    ).toHaveLength(1);
    // the same ability from two sources is two entries
    expect(
      checkTopSourcesOneEntryPerAbility([
        "                 Top sources: 4 — Eviscerate [Physical] (85k), 5 — Eviscerate [Physical] (60k)",
      ]),
    ).toEqual([]);
  });

  it("mutation: a list that is not in the generated format fails", () => {
    expect(
      checkTopSourcesOneEntryPerAbility([
        "                 Top sources: 4 — Eviscerate [Physical] 85k",
      ]),
    ).toHaveLength(1);
  });
});
