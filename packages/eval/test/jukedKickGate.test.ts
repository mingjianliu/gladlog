/**
 * FT F12 — `checkJukedKickNotAfterInterrupt`: a `[KICK] your K on N — JUKED
 * by fake Y` line may not follow, inside its rendered second, an interrupt of
 * that spell on that target (8930cb36 0:59: "JUKED by fake Haunt" 0.14 s
 * after a teammate's Rebuke had interrupted the Haunt; 9 of 562 such lines on
 * the 605-file capture of 8c3275fa).
 */
import {
  jukedByFakeText,
  jukedByStoppedChannelText,
} from "@gladlog/analysis/src/utils/kickAudit";
import { describe, expect, it } from "vitest";

import { checkJukedKickNotAfterInterrupt } from "../src/quality/promptQualityCheck";

const juked = (at: string, target: string, spell: string, tag = "") =>
  `${at}  [KICK]   your Pummel on ${target} — ${jukedByFakeText({ jukedBySpellName: spell })}${tag}`;
const interrupted = (at: string, victim: string, spell: string) =>
  `${at}  [KICK]   2(RPaladin) interrupted ${victim}'s ${spell} (Rebuke; back 1:14)`;

describe("checkJukedKickNotAfterInterrupt (FT F12)", () => {
  it("the lines the fix renders pass", () => {
    expect(
      checkJukedKickNotAfterInterrupt([
        interrupted("0:59", "5(AWarlock)", "Haunt"),
        "0:59  [KICK]   your Pummel on 5(AWarlock) — hit nothing — 2(RPaladin)'s Rebuke had interrupted the Haunt 0.1s earlier",
        // a fake of another spell, a fake on another target, the same fake in
        // another second
        juked("0:59", "5(AWarlock)", "Unstable Affliction"),
        juked("0:59", "6(RShaman)", "Haunt"),
        juked("1:03", "5(AWarlock)", "Haunt"),
        `0:44  [KICK]   your Mind Freeze on 5(HPriest) — ${jukedByStoppedChannelText({ jukedBySpellName: "Divine Hymn", jukedChannelStoppedAgoS: 0.1 })}`,
      ]),
    ).toEqual([]);
  });

  it("a fake BEFORE the interrupt in the same second passes — the recast is what was interrupted", () => {
    expect(
      checkJukedKickNotAfterInterrupt([
        juked("0:59", "5(AWarlock)", "Haunt"),
        interrupted("0:59", "5(AWarlock)", "Haunt"),
      ]),
    ).toEqual([]);
  });

  it("mutation: JUKED by the spell a teammate interrupted on that target earlier in the second fails", () => {
    const out = checkJukedKickNotAfterInterrupt([
      interrupted("0:59", "5(AWarlock)", "Haunt"),
      juked("0:59", "5(AWarlock)", "Haunt"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Haunt");
  });

  it("mutation: a miss tag after the spell, and a pet as the target, are still read", () => {
    expect(
      checkJukedKickNotAfterInterrupt([
        interrupted("0:25", "5(FDruid)", "Cyclone"),
        juked("0:25", "5(FDruid)", "Cyclone", " [IMMUNE: 5(FDruid)]"),
      ]),
    ).toHaveLength(1);
    expect(
      checkJukedKickNotAfterInterrupt([
        interrupted("2:08", "4(BMHunter)'s pet", "Spirit Mend"),
        juked("2:08", "4(BMHunter)'s pet", "Spirit Mend"),
      ]),
    ).toHaveLength(1);
  });
});
