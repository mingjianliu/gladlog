/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A missed-purge window ends at the round's end (`utils/roundEnd.ts`
 * `roundEndMs`: a Solo Shuffle round's first player death, else the combat
 * end) — the one round end the uncleansed windows (missed-cleanse F-C3), the
 * control lines and the kill windows already stop at.
 *
 * What the log shows (five Solo Shuffle logs, 30 rounds,
 * fix-FT/scripts/upr_windowEnds.ts): a round's units keep the rows logged
 * after its ending death, so a buff still up then paired with a
 * SPELL_AURA_REMOVED written in the strip between two rounds — 41 of the 59
 * windows that ran past the round's end ended on a removal logged AFTER
 * `combat.endTime` (up to 6.0 s after the death), 10 on one between the death
 * and `combat.endTime`, 8 had no removal row and ran to `combat.endTime`
 * (287ee68f round 2: Power Infusion up 7.7 s when the round ended at 2:29
 * read `unpurged for 14s`).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  formatMissedPurgeExemption,
  reconstructDispelSummary,
  unpurgedForText,
} from "../src/utils/dispelAnalysis";
import {
  makeAuraEvent,
  makeDispelAction,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const S = (sec: number) => START + sec * 1000;
/** Blessing of Freedom: Magic, High while our side has a kiter. */
const FREEDOM = "1044";
const POLY = "118";
const PURGE = "528";

/** A Solo Shuffle round whose first player death is at `deathS`; the log
 * runs on 2 s, as a round's `endTime` does. */
function shuffle(deathS: number) {
  const dead = makeUnit("x", {
    info: {},
    deathRecords: [{ timestamp: S(deathS) }],
  } as any);
  return {
    startTime: START,
    endTime: S(deathS + 2),
    startInfo: { zoneId: "1672", bracket: "Rated Solo Shuffle" },
    units: { x: dead },
  };
}

/** The enemy paladin with Freedom on from `fromS`, removed at `toS` (no
 * removal row when undefined). */
function freedomOn(fromS: number, toS?: number) {
  return makeUnit("e1", {
    spec: CombatUnitSpec.Paladin_Holy,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        FREEDOM,
        S(fromS),
        "e1",
        "e1",
        "BUFF",
      ),
      ...(toS === undefined
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              FREEDOM,
              S(toS),
              "e1",
              "e1",
              "BUFF",
            ),
          ]),
    ],
  });
}

const purger = (overrides: any = {}) =>
  makeUnit("h1", { spec: CombatUnitSpec.Priest_Discipline, ...overrides });
/** A teammate whose slows Freedom answers (what makes it worth a purge) — a
 * purger too: Spellsteal. */
const kiter = (overrides: any = {}) =>
  makeUnit("h2", { spec: CombatUnitSpec.Mage_Frost, ...overrides });

function windows(
  enemy: any,
  combat: any,
  friends: any[] = [purger(), kiter()],
) {
  return reconstructDispelSummary(friends as any, [enemy] as any, combat)
    .missedPurgeWindows;
}

describe("missed-purge windows end at the round end", () => {
  it("a removal logged after the round's end is clipped to it", () => {
    // 287ee68f round 2 shape: applied 7.7 s before the ending death, the
    // REMOVED written 6 s after it — after `combat.endTime`
    const w = windows(freedomOn(40.652, 54.362), shuffle(48.327));
    expect(w).toHaveLength(1);
    expect(w[0]!.durationSeconds).toBeCloseTo(7.675, 3);
    // what both lines print of it (the gate reads this text back)
    expect(unpurgedForText(w[0]!)).toBe("unpurged for 8s");
  });

  it("a buff with no removal row ends at the round's end, not the log's", () => {
    // 0284fcd9 round 1 shape: `combat.endTime` is the death + 2 s
    const w = windows(freedomOn(40), shuffle(48.327));
    expect(w).toHaveLength(1);
    expect(w[0]!.durationSeconds).toBeCloseTo(8.327, 3);
  });

  it("a buff up for less than the reaction floor inside the round is no window; one applied after the end is none", () => {
    // e7444643 round 3 shape: Nether Ward 0.2 s before the death, its 3 s
    // run out after it
    expect(windows(freedomOn(46.5, 54.5), shuffle(48.327))).toHaveLength(0);
    // 287ee68f round 1 shape: applied in the strip after the death
    expect(windows(freedomOn(48.732, 53.8), shuffle(48.327))).toHaveLength(0);
  });

  it("a buff that ended inside the round is untouched", () => {
    const w = windows(freedomOn(20, 28), shuffle(48.327));
    expect(w).toHaveLength(1);
    expect(w[0]!.durationSeconds).toBeCloseTo(8, 3);
  });

  it("control: another bracket's round ends where its log does — a death cuts nothing", () => {
    const threes = {
      ...shuffle(48.327),
      endTime: S(60),
      startInfo: { zoneId: "1672", bracket: "3v3" },
    };
    const w = windows(freedomOn(40.652, 54.362), threes);
    expect(w).toHaveLength(1);
    expect(w[0]!.durationSeconds).toBeCloseTo(13.71, 3);
    // … and a removal after the log's end is clipped to the log's end there
    const late = windows(freedomOn(50, 63), threes);
    expect(late[0]!.durationSeconds).toBeCloseTo(10, 3);
  });

  it("feasibility is asked of the window inside the round: purgers free only after the end were locked out", () => {
    /** Polymorph on `id` over [fromS, toS] */
    const poly = (id: string, fromS: number, toS: number) => ({
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, S(fromS), "e1", id),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, S(toS), "e1", id),
      ],
    });
    // both purgers Polymorphed from the buff's start until 2 s before the
    // round's end, free from there on: 2 s free in the round (< the 3 s
    // reaction floor), 8 s free up to the removal logged after it
    const w = windows(freedomOn(40.652, 54.362), shuffle(48.327), [
      purger(poly("h1", 40, 46.327)),
      kiter(poly("h2", 40, 46.327)),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]!.purgersLockedOut).toBe(true);
    expect(formatMissedPurgeExemption(w[0]!)).toContain("not actionable");
    // the same lock against a window that long INSIDE a round leaves 8 s
    const inside = windows(freedomOn(20.652, 34.362), shuffle(48.327), [
      purger(poly("h1", 20, 26.327)),
      kiter(poly("h2", 20, 26.327)),
    ]);
    expect(inside[0]!.purgersLockedOut).toBe(false);
  });

  it("a purge logged after the round's end is not in the round: the window stands, cut (the uncleansed windows' rule)", () => {
    const withPurgeAt = (purgeS: number) =>
      purger({
        actionOut: [
          makeDispelAction(
            S(purgeS),
            "h1",
            "e1",
            PURGE,
            FREEDOM,
            "Blessing of Freedom",
            "e1",
            "h1",
          ),
        ],
      });
    const enemyAt = (toS: number) => freedomOn(40.652, toS);
    // purged inside the round: answered, no window
    expect(
      windows(enemyAt(45), shuffle(48.327), [withPurgeAt(45), kiter()]),
    ).toHaveLength(0);
    // purged 1 s after the ending death: 7.7 s unpurged in the round
    const w = windows(enemyAt(49.3), shuffle(48.327), [
      withPurgeAt(49.3),
      kiter(),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]!.durationSeconds).toBeCloseTo(7.675, 3);
  });
});
