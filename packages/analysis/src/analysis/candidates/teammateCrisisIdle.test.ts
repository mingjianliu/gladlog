/** `teammate-crisis-idle` producer (GH #95): only clean-idle points, ranked by
 * 2 s damage under the cap, emitted in time order; facts carry the reference
 * verbatim from the injected lookup; no reference → no accusation. */
import { describe, expect, it } from "vitest";

import type { TeammateCrisisPoint } from "../teammateCrisis";
import {
  TEAMMATE_CRISIS_IDLE_CAP,
  teammateCrisisIdleEvents,
  teammateCrisisWindowSeconds,
} from "./teammateCrisisIdle";

const point = (
  over: Partial<TeammateCrisisPoint> = {},
): TeammateCrisisPoint => ({
  mateId: "M",
  mateName: "Mate-R",
  tSec: 47,
  tMs: 0,
  hpPct: 38,
  dmg2s: 0.24,
  attackerNames: ["Foe-R", "Foe2-R"],
  enemyBurst: {
    casterName: "Foe-R",
    spellId: "1",
    spellName: "Avatar",
    secondsBefore: 3,
  },
  mateResponded: false,
  healerAnswers: [],
  healerAnswered: false,
  carriedHealPct: 0,
  distanceYd: 12,
  externalsReady: [{ spellId: "33206", spellName: "Pain Suppression" }],
  manaPct: 60,
  excluded: null,
  healerIdle: true,
  idleReason: null,
  cleanIdle: true,
  busyOn: null,
  busyOnInCrisis: false,
  diedWithin10s: true,
  ...over,
});
const owner = { id: "H", name: "Heals-R" };
const ref = {
  cellKey: "3v3|20-30%",
  fellBack: false,
  nIdle: 120,
  deathIdlePct: 77,
  nAnswered: 3400,
  deathAnsweredPct: 11,
};

describe("teammateCrisisIdleEvents", () => {
  it("renders a clean-idle point with every fact and the reference verbatim", () => {
    const [e] = teammateCrisisIdleEvents([point()], owner, "3v3", {
      lookup: (bin) => (bin === "20-30%" ? ref : null),
    });
    expect(e).toBeDefined();
    expect(e!.type).toBe("teammate-crisis-idle");
    expect(e!.t).toBe(47);
    expect(e!.unitNames).toEqual(["Heals-R", "Mate-R"]);
    const w = teammateCrisisWindowSeconds(47);
    expect(w).toEqual({ from: 45, to: 50 });
    expect(e!.facts).toMatchObject({
      t: "47",
      unit: "Heals-R",
      mate: "Mate-R",
      mateHpPct: "38",
      dmg2sPct: "24",
      attackers: "Foe-R; Foe2-R",
      windowFrom: "0:45",
      windowTo: "0:50",
      distanceYd: "12",
      externalsReady: "Pain Suppression",
      burst: "Foe-R Avatar 3s before",
      burstCue: "yes",
      refNIdle: "120",
      refDeathIdle: "77",
      refNAnswered: "3400",
      refDeathAnswered: "11",
      cellKey: "3v3|20-30%",
      fellBack: "no",
    });
    // no fact value may carry ", " — every text-side parser splits on it
    for (const v of Object.values(e!.facts ?? {}))
      expect(String(v)).not.toContain(", ");
  });

  it("a press under the cue floor is a bare fact (burstCue=no); no press → none", () => {
    const [a] = teammateCrisisIdleEvents(
      [
        point({
          enemyBurst: {
            casterName: "Foe-R",
            spellId: "1",
            spellName: "Avatar",
            secondsBefore: 1,
          },
        }),
      ],
      owner,
      "3v3",
      { lookup: () => ref },
    );
    expect(a!.facts!.burstCue).toBe("no");
    const [b] = teammateCrisisIdleEvents(
      [point({ enemyBurst: null })],
      owner,
      "3v3",
      { lookup: () => ref },
    );
    expect(b!.facts!.burst).toBe("none");
    expect(b!.facts!.burstCue).toBe("no");
  });

  it("only clean-idle points are eligible; without a reference nothing is emitted", () => {
    expect(
      teammateCrisisIdleEvents(
        [point({ cleanIdle: false, excluded: "losUnknown" })],
        owner,
        "3v3",
        { lookup: () => ref },
      ),
    ).toEqual([]);
    expect(
      teammateCrisisIdleEvents([point()], owner, "3v3", { lookup: () => null }),
    ).toEqual([]);
  });

  it("selects the biggest 2 s hits under the cap and emits them in time order", () => {
    const out = teammateCrisisIdleEvents(
      [
        point({ tSec: 30, dmg2s: 0.12 }),
        point({ tSec: 60, dmg2s: 0.35 }),
        point({ tSec: 10, dmg2s: 0.22 }),
      ],
      owner,
      "3v3",
      { lookup: () => ref },
    );
    expect(out).toHaveLength(TEAMMATE_CRISIS_IDLE_CAP);
    expect(out.map((e) => e.t)).toEqual([10, 60]);
  });
});
