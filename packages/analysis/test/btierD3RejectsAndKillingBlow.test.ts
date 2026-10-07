/**
 * B-tier D3 (user rulings 2026-10-06):
 *  - B15b: the owner's range / line-of-sight / moving rejects in the 10 s
 *    before a teammate's death are stated whatever their count (9d899d10
 *    2:41: two line-of-sight rejects and one "moving" 1.3 s before the Fire
 *    Mage died — no line under REJECT_RUN_MIN = 3);
 *  - X5: "vision obscured" (Smoke Bomb) is its own kind, apart from a
 *    pillar's line of sight; the German string moves out of the wrong list;
 *  - B15c-U11: the friendly death block names the killing blow when it was
 *    an execute (95127ab4 1:51: Touch of Death).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import {
  ownerRejectRuns,
  REJECT_NEAR_DEATH_S,
  REJECT_REASONS,
  REJECT_RUN_MIN,
  REJECT_WHY,
} from "../src/context/spellOutcomeLines";
import observed from "../src/data/observedSpellIdsGenerated.json";
import {
  EXECUTE_KILLING_BLOW_IDS,
  executeKillingBlowOf,
  playerKillingBlow,
} from "../src/utils/killingBlow";

const f = (
  s: number,
  reason: string,
  spellId = 8004,
  spellName = "Healing Surge",
) => ({
  tSeconds: s,
  unitGuid: "Player-O",
  spellId,
  spellName,
  reason,
});
const LOS = "Target not in line of sight";

describe("ownerRejectRuns near a teammate's death (B15b)", () => {
  it("9d899d10 2:41: two line-of-sight rejects and one 'moving', 1.3 s before the death — both runs stated", () => {
    const hits = [
      f(161.14, LOS),
      f(161.3, LOS),
      f(161.76, "Can't do that while moving"),
    ];
    expect(REJECT_RUN_MIN).toBe(3);
    expect(ownerRejectRuns(hits, "Player-O")).toEqual([]);
    const runs = ownerRejectRuns(hits, "Player-O", [162.556]);
    expect(runs.map((r) => [r.kind, r.count])).toEqual([
      ["no line of sight", 2],
      ["moving", 1],
    ]);
  });

  it("the window is the REJECT_NEAR_DEATH_S before the death: 10 s before counts, 10.1 s does not, after it does not", () => {
    expect(REJECT_NEAR_DEATH_S).toBe(10);
    const one = (s: number) =>
      ownerRejectRuns([f(s, LOS)], "Player-O", [100]).length;
    expect(one(90)).toBe(1);
    expect(one(89.9)).toBe(0);
    expect(one(100)).toBe(1);
    expect(one(100.1)).toBe(0);
  });

  it("a run that only reaches into the window is kept whole; one of 3+ far from any death is unchanged", () => {
    const [run] = ownerRejectRuns(
      [f(88, "Out of range"), f(89.5, "Out of range")],
      "Player-O",
      [100],
    );
    // started 12 s before, its last press 10.5 s before: not in the window
    expect(run).toBeUndefined();
    // a TWO-press run (under the 3-press minimum) whose second press is
    // inside the window: kept whole, from its first press — without the
    // near-death rule it would not be a run at all
    const [reaching] = ownerRejectRuns(
      [f(89, "Out of range"), f(90.5, "Out of range")],
      "Player-O",
      [100],
    );
    expect(reaching).toMatchObject({
      fromSeconds: 89,
      toSeconds: 90.5,
      count: 2,
    });
    expect(
      ownerRejectRuns(
        [f(89, "Out of range"), f(90.5, "Out of range")],
        "Player-O",
      ),
    ).toEqual([]);
    expect(
      ownerRejectRuns(
        [f(10, LOS), f(10.5, LOS), f(11, LOS)],
        "Player-O",
        [100],
      ),
    ).toHaveLength(1);
  });

  it("a reject that is not one of the kinds — a control reject — never enters, death or not", () => {
    expect(
      ownerRejectRuns(
        [f(99, "Can't do that while stunned"), f(99.5, "Not yet recovered")],
        "Player-O",
        [100],
      ),
    ).toEqual([]);
  });
});

describe("'vision obscured' is its own kind (X5)", () => {
  it("every listed string maps to it, and none of them is still a line-of-sight string", () => {
    for (const text of REJECT_REASONS["vision obscured"]) {
      const [run] = ownerRejectRuns(
        [f(10, text), f(10.5, text), f(11, text)],
        "Player-O",
      );
      expect(run?.kind).toBe("vision obscured");
      expect(REJECT_REASONS["no line of sight"]).not.toContain(text);
    }
    expect(REJECT_REASONS["vision obscured"]).toContain(
      "Die Sicht auf Euer Ziel ist behindert.",
    );
  });

  it("is worded apart from a pillar, and does not merge with a line-of-sight run of the same spell", () => {
    expect(REJECT_WHY["vision obscured"]).toBe("vision obscured (Smoke Bomb)");
    expect(REJECT_WHY["no line of sight"]).toBe("target not in line of sight");
    const runs = ownerRejectRuns(
      [
        f(10, LOS),
        f(10.4, LOS),
        f(10.8, LOS),
        f(11.2, "Your vision of the target is obscured"),
        f(11.6, "Your vision of the target is obscured"),
        f(12, "Your vision of the target is obscured"),
      ],
      "Player-O",
    );
    expect(runs.map((r) => [r.kind, r.count])).toEqual([
      ["no line of sight", 3],
      ["vision obscured", 3],
    ]);
  });

  it("the same threshold as the other kinds: two presses are no run, unless a teammate dies within 10 s (539b6ed0's two)", () => {
    const two = [
      f(50, "Your vision of the target is obscured"),
      f(50.6, "Your vision of the target is obscured"),
    ];
    expect(ownerRejectRuns(two, "Player-O")).toEqual([]);
    expect(ownerRejectRuns(two, "Player-O", [55])[0]).toMatchObject({
      kind: "vision obscured",
      count: 2,
    });
  });

  it("no string sits under two kinds", () => {
    const all = Object.values(REJECT_REASONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the execute killing blow (B15c-U11)", () => {
  const T = 1_000_000;
  const hit = (ms: number, spellId: string, overkill?: number): any => ({
    logLine: { timestamp: ms },
    spellId,
    effectiveAmount: -84_450,
    ...(overkill !== undefined ? { overkill } : {}),
  });

  it("the table holds live ids only", () => {
    const seen = new Set(
      (observed as unknown as Array<string | number>).map(String),
    );
    for (const id of EXECUTE_KILLING_BLOW_IDS) expect(seen.has(id)).toBe(true);
    expect(EXECUTE_KILLING_BLOW_IDS.has("322109")).toBe(true);
  });

  it("the two looked at and left out stay out: Execute (any health through Sudden Death) and Sudden Demise (mechanic not checked)", () => {
    expect(EXECUTE_KILLING_BLOW_IDS.has("260798")).toBe(false);
    expect(EXECUTE_KILLING_BLOW_IDS.has("343769")).toBe(false);
  });

  it("is the damage row that carries overkill — the predicate KILL SEQUENCE's `killing blow:` reads", () => {
    const unit = {
      damageIn: [hit(T - 400, "107428"), hit(T - 5, "322109", 249_935)],
    };
    expect(playerKillingBlow(unit, T)?.spellId).toBe("322109");
    expect(executeKillingBlowOf(unit, T)).toBe(playerKillingBlow(unit, T));
    // the UNIT_DIED row can precede its damage row: the shared +500 ms slack
    const late = { damageIn: [hit(T + 60, "322109", 249_935)] };
    expect(executeKillingBlowOf(late, T)?.spellId).toBe("322109");
    expect(
      executeKillingBlowOf({ damageIn: [hit(T + 600, "322109", 5)] }, T),
    ).toBeUndefined();
  });

  it("Touch of Death that landed but did not kill is not the killing blow", () => {
    const unit = {
      damageIn: [hit(T - 600, "322109"), hit(T - 5, "107428", 12_000)],
    };
    expect(playerKillingBlow(unit, T)?.spellId).toBe("107428");
    expect(executeKillingBlowOf(unit, T)).toBeUndefined();
  });

  it("no overkill row: nothing is guessed from the last hit", () => {
    expect(
      executeKillingBlowOf({ damageIn: [hit(T - 5, "322109")] }, T),
    ).toBeUndefined();
  });
});
