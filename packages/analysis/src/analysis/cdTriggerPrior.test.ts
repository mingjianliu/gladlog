/**
 * `[CD PRIOR]` engine (GH #54 (f) / BACKLOG #38 (a)(h), 2026-09-04).
 *
 * Two halves, matching the two exports:
 *  1. `cdTriggerObservations` — the scan side: which presses count and what
 *     HP they carry. The shared-predicate pin is that the HP on a row equals
 *     `gridHpPct` of the lowest alive friendly at the press's whole second.
 *  2. `cdPriorHoldEpisodes` — the product side: crossing, dip walk, the
 *     crisis partition, readiness, "spent" and the reference gate.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import type { CdTriggerPriorRef } from "../data/cdTriggerPrior";
import { ensureAnalysisData } from "../data/ensure";
import { gridHpPct } from "../utils/cooldowns";
import {
  CD_PRIOR_MIN_PERSIST_S,
  CD_TRIGGER_DEDUPE_S,
  CD_TRIGGER_NEEDED_HP_PCT,
  cdPriorHoldEpisodes,
  cdTriggerObservations,
  lowestFriendlyGridHp,
} from "./cdTriggerPrior";
import { CRISIS_HP_PCT_RENDERED } from "./crisisDecisionPoints";

const T0 = 1_700_000_000_000;
const hp = (dtMs: number, cur: number, max = 100) => ({
  timestamp: T0 + dtMs,
  logLine: { timestamp: T0 + dtMs },
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: max,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});
function unit(id: string, over: Record<string, unknown> = {}) {
  // the [STATE] sampler only reads advanced actions whose actor is the unit
  const actions = ((over.advancedActions as any[]) ?? [hp(0, 100)]).map(
    (a) => ({ ...a, advancedActorId: id }),
  );
  return {
    id,
    name: `${id}-Realm-US`,
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    damageIn: [],
    healIn: [],
    healOut: [],
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
    ...over,
    advancedActions: actions,
  };
}
function combat(units: any[], durationS = 20) {
  const map: Record<string, any> = {};
  for (const u of units) map[u.id] = u;
  return {
    startTime: T0,
    endTime: T0 + durationS * 1000,
    units: map,
    startInfo: { bracket: "3v3" },
  };
}
/** Pain Suppression — a real external (official targeting reaches an ally),
 * so `canHelpAnotherUnit` passes on a TEAMMATE's dip. */
const PAIN_SUPP = "33206";
const cd = (over: Record<string, unknown> = {}) => ({
  spellId: PAIN_SUPP,
  spellName: "Pain Suppression",
  tag: "Defensive",
  cooldownSeconds: 90,
  neverUsed: true,
  casts: [] as Array<{ timeSeconds: number }>,
  isThroughput: false,
  ...over,
});
const ref = (over: Partial<CdTriggerPriorRef> = {}): CdTriggerPriorRef => ({
  cellKey: "Discipline Priest|Oracle|33206",
  fellBack: false,
  n: 1913,
  medianHpPct: 54,
  ...over,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cdTriggerObservations (scan side)", () => {
  it("a press while the lowest friendly is below the needed-HP door yields one row whose HP is gridHpPct of that friendly at that second", () => {
    const me = unit("H");
    const mate = unit("M", {
      advancedActions: [hp(0, 100), hp(3000, 61), hp(4000, 58)],
    });
    const c = combat([me, mate]);
    const rows = cdTriggerObservations(me, c, {
      cds: [cd({ casts: [{ timeSeconds: 3.4 }], neverUsed: false })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tSec).toBe(3);
    expect(rows[0]!.lowestFriendlyName).toBe("M-Realm-US");
    // the shared-predicate pin
    expect(rows[0]!.lowestFriendlyHpPct).toBe(gridHpPct(mate as any, T0 + 3000));
    expect(lowestFriendlyGridHp([me, mate] as any, T0, 3)!.hpPct).toBe(
      rows[0]!.lowestFriendlyHpPct,
    );
  });

  it("a press with everybody at or above the door is not an observation (the study's LADDER_HP)", () => {
    const me = unit("H");
    const mate = unit("M", { advancedActions: [hp(0, 100), hp(3000, 80)] });
    const rows = cdTriggerObservations(me, combat([me, mate]), {
      cds: [cd({ casts: [{ timeSeconds: 3 }], neverUsed: false })],
    });
    expect(CD_TRIGGER_NEEDED_HP_PCT).toBe(75);
    expect(rows).toHaveLength(0);
  });

  it("a re-press of the same spell inside the dedupe window is one event; a dead friendly is not the lowest", () => {
    const me = unit("H");
    const mate = unit("M", {
      advancedActions: [hp(0, 100), hp(3000, 50), hp(10000, 45), hp(40000, 40)],
    });
    const corpse = unit("D", {
      advancedActions: [hp(0, 100), hp(2000, 5)],
      deathRecords: [{ timestamp: T0 + 2500 }],
    });
    const rows = cdTriggerObservations(me, combat([me, mate, corpse], 60), {
      cds: [
        cd({
          casts: [{ timeSeconds: 3 }, { timeSeconds: 10 }, { timeSeconds: 40 }],
          neverUsed: false,
        }),
      ],
    });
    expect(CD_TRIGGER_DEDUPE_S).toBe(30);
    expect(rows.map((r) => r.tSec)).toEqual([3, 40]);
    expect(rows.every((r) => r.lowestFriendlyName === "M-Realm-US")).toBe(true);
  });

  it("a non-roster cooldown (throughput / not Defensive) never yields a row, even when injected", () => {
    const me = unit("H");
    const mate = unit("M", { advancedActions: [hp(0, 100), hp(3000, 50)] });
    const rows = cdTriggerObservations(me, combat([me, mate]), {
      cds: [
        cd({ casts: [{ timeSeconds: 3 }], isThroughput: true }),
        cd({ casts: [{ timeSeconds: 3 }], tag: "Offensive" }),
      ],
    });
    expect(rows).toHaveLength(0);
  });
});

describe("cdPriorHoldEpisodes (product side)", () => {
  /** Mate: 100 → 60 → 50 → 45 → 48 → 50 → 70: crosses the 54 line at s=2,
   * bottoms at 45 (s=3), still below at s=5 (persists 3 s), back above at
   * s=6. */
  const dipping = () =>
    unit("M", {
      advancedActions: [
        hp(0, 100),
        hp(1000, 60),
        hp(2000, 50),
        hp(3000, 45),
        hp(4000, 48),
        hp(5000, 50),
        hp(6000, 70),
      ],
    });

  it("a held, ready cooldown over a dip through the cohort median yields one episode with gridHpPct numbers", () => {
    const me = unit("H");
    const mate = dipping();
    const eps = cdPriorHoldEpisodes(me, combat([me, mate]), () => ref(), {
      cds: [cd()],
    });
    expect(eps).toHaveLength(1);
    const e = eps[0]!;
    expect(e.tSec).toBe(2);
    expect(e.hpAtCrossPct).toBe(gridHpPct(mate as any, T0 + 2000));
    expect(e.minHpPct).toBe(gridHpPct(mate as any, T0 + 3000));
    expect(e.minSec).toBe(3);
    expect(e.endSec).toBe(5);
    expect(e.ownerLockedSecs).toBe(0);
    expect(e.minUnitName).toBe("M-Realm-US");
    expect(e.minUnitIsOwner).toBe(false);
    expect(e.ref.cellKey).toBe("Discipline Priest|Oracle|33206");
  });

  it("no reference cell → no episode; a spent cooldown → no episode", () => {
    const me = unit("H");
    expect(
      cdPriorHoldEpisodes(me, combat([me, dipping()]), () => null, {
        cds: [cd()],
      }),
    ).toHaveLength(0);
    expect(
      cdPriorHoldEpisodes(me, combat([me, dipping()]), () => ref(), {
        cds: [cd({ casts: [{ timeSeconds: 3 }], neverUsed: false })],
      }),
    ).toHaveLength(0);
  });

  it("a cooldown still on cooldown at the crossing is not 'held'", () => {
    const me = unit("H");
    const eps = cdPriorHoldEpisodes(me, combat([me, dipping()]), () => ref(), {
      cds: [cd({ casts: [{ timeSeconds: -80 }], neverUsed: false })],
    });
    expect(eps).toHaveLength(0);
  });

  it("a dip that is back above the median before the response window elapses is not 'held' (persistence door)", () => {
    const me = unit("H");
    const blip = unit("M", {
      advancedActions: [hp(0, 100), hp(1000, 60), hp(2000, 50), hp(3000, 45), hp(4000, 70)],
    });
    expect(CD_PRIOR_MIN_PERSIST_S).toBe(3);
    expect(
      cdPriorHoldEpisodes(me, combat([me, blip]), () => ref(), { cds: [cd()] }),
    ).toHaveLength(0);
  });

  it("a dip that reaches the crisis line is crisis territory (cd-hoarded's), not a [CD PRIOR] episode", () => {
    const me = unit("H");
    const mate = unit("M", {
      advancedActions: [hp(0, 100), hp(1000, 60), hp(2000, 50), hp(3000, 38), hp(5000, 70)],
    });
    expect(CRISIS_HP_PCT_RENDERED).toBe(40);
    expect(
      cdPriorHoldEpisodes(me, combat([me, mate]), () => ref(), { cds: [cd()] }),
    ).toHaveLength(0);
  });

  it("a dead owner cannot hold anything", () => {
    const me = unit("H", { deathRecords: [{ timestamp: T0 + 1500 }] });
    expect(
      cdPriorHoldEpisodes(me, combat([me, dipping()]), () => ref(), {
        cds: [cd()],
      }),
    ).toHaveLength(0);
  });

  it("the owner's own dip counts (self-castable wall), and a self-cast no-op external does not", () => {
    const me = unit("H", {
      advancedActions: [hp(0, 100), hp(1000, 60), hp(2000, 50), hp(3000, 45), hp(5000, 50), hp(6000, 70)],
    });
    const mate = unit("M");
    // Desperate Prayer — a self heal; helps the owner's own dip.
    const selfWall = cd({ spellId: "19236", spellName: "Desperate Prayer" });
    const eps = cdPriorHoldEpisodes(
      me,
      combat([me, mate]),
      () => ref({ cellKey: "Discipline Priest|Oracle|19236" }),
      { cds: [selfWall] },
    );
    expect(eps).toHaveLength(1);
    expect(eps[0]!.minUnitIsOwner).toBe(true);
    // Blessing of Sacrifice self-cast is a mechanical no-op → not held over
    // the owner's OWN dip.
    const bos = cd({ spellId: "6940", spellName: "Blessing of Sacrifice" });
    expect(
      cdPriorHoldEpisodes(
        me,
        combat([me, mate]),
        () => ref({ cellKey: "Holy Paladin|*|6940" }),
        { cds: [bos] },
      ),
    ).toHaveLength(0);
  });

  it("two dips of the same cooldown closer than the crisis merge gap are one episode", () => {
    const me = unit("H");
    const mate = unit("M", {
      advancedActions: [
        hp(0, 100),
        hp(1000, 50),
        hp(2000, 50),
        hp(3000, 50),
        hp(4000, 50),
        hp(5000, 70),
        hp(6000, 50),
        hp(7000, 50),
        hp(8000, 50),
        hp(9000, 50),
        hp(10000, 70),
        hp(11000, 70),
        hp(12000, 70),
        hp(13000, 70),
        hp(14000, 70),
        hp(15000, 45),
        hp(16000, 45),
        hp(17000, 45),
        hp(18000, 45),
        hp(19000, 70),
      ],
    });
    const eps = cdPriorHoldEpisodes(me, combat([me, mate], 30), () => ref(), {
      cds: [cd()],
    });
    // dips at s=1..4 and s=6..9 are 2 s apart (< CRISIS_WINDOW_GAP_MS) → one
    // episode; s=15..18 is 6 s after → a second one.
    expect(eps.map((e) => e.tSec)).toEqual([1, 15]);
  });
});
