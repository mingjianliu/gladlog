/**
 * cd-hoarded × a low-HP talent proc (BACKLOG #43, user ruling 2026-09-17
 * 「可以免,如果人没死的话」): a proc / cheat-death that answered the crisis
 * lifts the "held a ready defensive" accusation — but only if the crisis
 * unit was still alive CD_HOARD_RESPONSE_S later.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  CD_HOARD_RESPONSE_S,
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";

const OWNER = { id: "h", name: "Healer-R" };
const MATE = { id: "m", name: "Ally-R" };

const responses = (over: Record<string, boolean> = {}) => ({
  selfHeal: false,
  carriedHeal: false,
  attackerMoved: false,
  wall: false,
  protective: false,
  external: false,
  control: false,
  peel: false,
  kite: false,
  proc: false,
  cheatDeath: false,
  ...over,
});
const point = (
  over: Partial<ICdHoardedCrisisSource["points"][number]> = {},
): ICdHoardedCrisisSource["points"][number] => ({
  tSec: 10,
  hpPct: 13,
  dmg2s: 0.3,
  attackers2s: 1,
  enemyBurst: false,
  inCC: false,
  dangerous: true,
  ...over,
});
const tranq = {
  spellId: "740",
  spellName: "Tranquility",
  tag: "Defensive",
  cooldownSeconds: 300,
  casts: [] as { timeSeconds: number }[],
  neverUsed: true,
};

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cd-hoarded × proc exemption (BACKLOG #43)", () => {
  it("no proc → the held Tranquility is accused as before", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point()] }],
      [tranq],
      OWNER,
    );
    expect(evts).toHaveLength(1);
  });

  it("a proc answered and the crisis unit lived through the hoard window → no accusation", () => {
    const evts = cdHoardedEvents(
      [
        {
          crisisUnit: MATE,
          own: false,
          points: [point({ responses: responses({ proc: true }) })],
          deathSeconds: [],
        },
      ],
      [tranq],
      OWNER,
    );
    expect(evts).toEqual([]);
    const cheat = cdHoardedEvents(
      [
        {
          crisisUnit: MATE,
          own: false,
          points: [point({ responses: responses({ cheatDeath: true }) })],
          deathSeconds: [10 + CD_HOARD_RESPONSE_S + 5],
        },
      ],
      [tranq],
      OWNER,
    );
    expect(cheat).toEqual([]);
  });

  it("a proc answered but the crisis unit still died inside the hoard window → the accusation stands", () => {
    const evts = cdHoardedEvents(
      [
        {
          crisisUnit: MATE,
          own: false,
          points: [point({ responses: responses({ proc: true }) })],
          deathSeconds: [10 + CD_HOARD_RESPONSE_S - 1],
        },
      ],
      [tranq],
      OWNER,
    );
    expect(evts).toHaveLength(1);
  });
});
