import { SYNC_LOCK_ENDED_BY_ROUND_END } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { SOLO_SHUFFLE_BRACKET } from "@gladlog/analysis/src/utils/roundEnd";
import { describe, expect, it } from "vitest";

import { checkSyncWindowLockLength } from "../src/quality/promptQualityCheck";

// F06a: a missed-sync-window row states its lock's length as the timeline
// does — `durationS` is the number the lock's `[CC ON ENEMY]` line prints,
// and neither runs past the round's end. Shapes from the 605-file capture.
const header = `  Spec: Windwalker Monk  |  Bracket: ${SOLO_SHUFFLE_BRACKET}  |  Result: Loss  |  Duration: 3:07  |  Map: Nagrand Arena`;
const ROSTER = [
  '<unit id="1" name="Owner-Realm-US" spec="Windwalker Monk" role="log owner"/>',
  '<unit id="6" name="Verial-EmeraldDream-US" spec="Holy Paladin" role="enemy"/>',
];
const DEATH =
  "3:05  [DEATH]  2(HPaladin) (Holy Paladin — friendly) | dampening: 40%";
const MATCH_END = "3:07  [MATCH END]   damp: 40%";
const row = (facts: string) =>
  `  - id=missed-sync-window:Verial-EmeraldDream-US:853:94 type=missed-sync-window t=94s units=Verial-EmeraldDream-US facts={${facts}, refN=48745, refKillEntered=9, refKillUnentered=5, cellKey=Rated Solo Shuffle}`;
const facts = (
  t: number,
  windowEndT: number,
  cc: string,
  durationS: string,
  endedBy?: string,
) =>
  `t=${t}, windowEndT=${windowEndT}, healer=Verial-EmeraldDream-US, cc=${cc}, dr=Full, durationS=${durationS}, readyCds=Zenith${endedBy ? `, endedBy=${endedBy}` : ""}`;
const check = (rowLine: string, ...timeline: string[]) =>
  checkSyncWindowLockLength([
    rowLine,
    header,
    ...ROSTER,
    ...timeline,
    DEATH,
    MATCH_END,
  ]);

describe("checkSyncWindowLockLength", () => {
  const HOJ_4S =
    "1:34  [CC ON ENEMY]   6(HPaladin) ← Hammer of Justice (by 2(HPaladin)) (4s) [DR: Stun Full]";

  it("passes a one-control row whose durationS is its [CC ON ENEMY] line's seconds", () => {
    expect(check(row(facts(94, 99, "Hammer of Justice", "4")), HOJ_4S)).toEqual(
      [],
    );
  });

  it("fails the floored endpoints' difference beside the line's rounded length — s0/135-5-802", () => {
    const fails = check(row(facts(94, 99, "Hammer of Justice", "5")), HOJ_4S);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "durationS=5 与同秒 [CC ON ENEMY] 行印的 4s 不一致",
    );
  });

  it("a lock the round ended on: the line's cut length, endedBy = the round's end, windowEndT not after the round", () => {
    const CUT =
      "3:03  [CC ON ENEMY]   6(HPaladin) ← Kidney Shot (by 3(SRogue)) (still on them when the round ended, 1s in) [DR: Stun Full]";
    expect(
      check(
        row(facts(183, 185, "Kidney Shot", "1", SYNC_LOCK_ENDED_BY_ROUND_END)),
        CUT,
      ),
    ).toEqual([]);
    // s1/132-5-722 before: the row ran on past the round
    const fails = check(row(facts(183, 188, "Kidney Shot", "5")), CUT);
    expect(fails).toHaveLength(3);
    expect(fails[0]).toContain("windowEndT 在回合结束之后");
    expect(fails[0]).toContain("第一条 [DEATH] 行在 3:05");
    expect(fails[1]).toContain(
      "durationS=5 与同秒 [CC ON ENEMY] 行印的 1s 不一致",
    );
    expect(fails[2]).toContain("却没有 endedBy=the round's end");
    // `<1`: the control lines' own text for under half a second
    expect(
      check(
        row(facts(184, 185, "Blind", "<1", SYNC_LOCK_ENDED_BY_ROUND_END)),
        "3:04  [CC ON ENEMY]   6(HPaladin) ← Blind (by 3(SRogue)) (still on them when the round ended, <1s in) [DR: Disorient Full]",
      ),
    ).toEqual([]);
  });

  it("fails endedBy = the round's end on a row whose line was not cut", () => {
    const fails = check(
      row(
        facts(94, 99, "Hammer of Justice", "4", SYNC_LOCK_ENDED_BY_ROUND_END),
      ),
      HOJ_4S,
    );
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("[CC ON ENEMY] 行却没有被回合结束截断");
  });

  it("a logged end note or the Tremor form on the line does not hide its length", () => {
    expect(
      check(
        row(facts(94, 97, "Polymorph", "3")),
        "1:34  [CC ON ENEMY]   6(HPaladin) ← Polymorph (by 1(WMonk)) (3s) [DR: Incapacitate Full] | broken by 2(HPaladin)'s Judgment",
      ),
    ).toEqual([]);
    expect(
      check(
        row(facts(94, 97, "Fear", "3")),
        "1:34  [CC ON ENEMY]   6(HPaladin) ← Fear (by 3(AWarlock)) [DR: Disorient Full] | enemy Tremor Totem from 5(RShaman) ended this CC after 2s (cut short — it had not expired)",
      ),
    ).toHaveLength(1);
  });

  it("does not judge a chain, a row with no line of its own, another unit's line or another second's", () => {
    expect(
      check(
        row(facts(94, 102, "Hammer of Justice→Blinding Light", "8")),
        HOJ_4S,
      ),
    ).toEqual([]);
    expect(
      check(row(facts(94, 99, "Hammer of Justice ×2", "5")), HOJ_4S),
    ).toEqual([]);
    expect(check(row(facts(94, 99, "Hammer of Justice", "5")))).toEqual([]);
    expect(
      check(
        row(facts(94, 99, "Hammer of Justice", "5")),
        "1:34  [CC ON ENEMY]   4(RDruid) ← Hammer of Justice (by 2(HPaladin)) (4s) [DR: Stun Full]",
        "1:35  [CC ON ENEMY]   6(HPaladin) ← Hammer of Justice (by 2(HPaladin)) (4s) [DR: Stun Full]",
      ),
    ).toEqual([]);
  });

  it("a chain row is still held to the round's end", () => {
    const fails = check(row(facts(180, 188, "Kidney Shot→Blind", "8")));
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("windowEndT 在回合结束之后");
  });
});
