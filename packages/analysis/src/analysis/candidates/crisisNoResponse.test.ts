import { describe, expect, it } from "vitest";

import type { DecisionPoint } from "../crisisDecisionPoints";
import {
  CRISIS_NO_RESPONSE_CAP,
  crisisNoResponseEvents,
} from "./crisisNoResponse";

const pt = (over: Partial<DecisionPoint> = {}): DecisionPoint => ({
  tMs: 0,
  tSec: 72.4,
  hpPct: 38,
  dmg2s: 0.25,
  attackers2s: 2,
  enemyBurst: true,
  inCC: false,
  lockedOut: false,
  diedInWindow: false,
  responses: {
    selfHeal: false,
    wall: false,
    external: false,
    control: false,
    peel: false,
    protective: false,
    kite: false,
  },
  responded: false,
  selfHealPct: 0,
  hasTool: true,
  feasible: true,
  dangerous: true,
  diedWithin10s: false,
  friendDiedWithin15s: false,
  ...over,
});
const ref = {
  cellKey: "3v3|healer|>=20%",
  fellBack: false,
  nNoResp: 81,
  deathNoRespPct: 22,
  nResp: 62,
  deathRespPct: 8,
  outcome: "ownDeath10s" as const,
  top: [
    ["selfHeal", 76],
    ["wall", 36],
    ["control", 16],
  ] as [string, number][],
};
const probes = { lookup: () => ref };
const owner = { id: "H", name: "Heals-R" };

describe("crisis-no-response", () => {
  it("fires for a feasible, unanswered crossing with the reference facts", () => {
    const ev = crisisNoResponseEvents([pt()], owner, "3v3", probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("crisis-no-response");
    expect(ev[0]!.id).toBe("crisis-no-response:H:72");
    expect(ev[0]!.facts).toEqual({
      t: "72.4",
      unit: "Heals-R",
      hpPct: "38",
      dmg2sPct: "25",
      attackers: "2",
      burst: "yes",
      refNNoResp: "81",
      refDeathNoResp: "22",
      refNResp: "62",
      refDeathResp: "8",
      refOutcome: "this player died within 10 s",
      refOutcomeKey: "ownDeath10s",
      refTop: "selfHeal 76%; wall 36%; control 16%",
      cellKey: "3v3|healer|>=20%",
      fellBack: "no",
    });
  });
  it("silent when the owner responded", () => {
    expect(
      crisisNoResponseEvents([pt({ responded: true })], owner, "3v3", probes),
    ).toEqual([]);
  });
  it("silent when any feasibility gate failed", () => {
    expect(
      crisisNoResponseEvents([pt({ feasible: false })], owner, "3v3", probes),
    ).toEqual([]);
  });
  it("silent when dangerous is false (below the gate-5 danger floor, spec §1b)", () => {
    expect(
      crisisNoResponseEvents([pt({ dangerous: false })], owner, "3v3", probes),
    ).toEqual([]);
  });
  it("silent when no reference exists for the bracket (never accuse without a baseline)", () => {
    expect(
      crisisNoResponseEvents([pt()], owner, "Skirmish", { lookup: () => null }),
    ).toEqual([]);
  });
  it("caps at 2 per round selected by danger (never by outcome), emitted in time order", () => {
    const pts = [
      pt({
        tSec: 10,
        enemyBurst: false,
        attackers2s: 1,
        dmg2s: 0.05,
        dangerous: false,
      }),
      pt({ tSec: 20, enemyBurst: true, attackers2s: 1, dmg2s: 0.1 }),
      pt({ tSec: 30, enemyBurst: false, attackers2s: 3, dmg2s: 0.4 }),
      pt({ tSec: 40, enemyBurst: true, attackers2s: 2, dmg2s: 0.3 }),
    ];
    const ev = crisisNoResponseEvents(pts, owner, "3v3", probes);
    expect(ev.map((e) => e.facts.t)).toEqual(["20", "40"]);
    expect(CRISIS_NO_RESPONSE_CAP).toBe(2);
  });
  it("overrides.cap changes how many survive selection (still ranked by danger, still emitted in time order)", () => {
    const pts = [
      pt({ tSec: 10, enemyBurst: false, attackers2s: 1, dmg2s: 0.15 }),
      pt({ tSec: 20, enemyBurst: true, attackers2s: 1, dmg2s: 0.1 }),
      pt({ tSec: 30, enemyBurst: false, attackers2s: 3, dmg2s: 0.4 }),
    ];
    const capped1 = crisisNoResponseEvents(pts, owner, "3v3", probes, {
      cap: 1,
    });
    expect(capped1.map((e) => e.facts.t)).toEqual(["20"]); // enemyBurst outranks attackers2s/dmg2s
    const capped3 = crisisNoResponseEvents(pts, owner, "3v3", probes, {
      cap: 3,
    });
    expect(capped3.map((e) => e.facts.t)).toEqual(["10", "20", "30"]); // all 3 survive, time order
  });
  it("emitted events are returned in time order — discriminating: the earlier point has the LOWER danger, so a danger-sorted (not time-sorted) output would fail this assertion", () => {
    const ev = crisisNoResponseEvents(
      [
        // earlier in time, LESS dangerous
        pt({ tSec: 5, enemyBurst: false, attackers2s: 1, dmg2s: 0.1 }),
        // later in time, MORE dangerous
        pt({ tSec: 50, enemyBurst: true, attackers2s: 3, dmg2s: 0.4 }),
      ],
      owner,
      "3v3",
      probes,
    );
    expect(ev.map((e) => e.t)).toEqual([5, 50]);
  });
});
