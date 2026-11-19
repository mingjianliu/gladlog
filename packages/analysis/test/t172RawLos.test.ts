/**
 * T172 (GH #218 item 12.5; user ruling R70, 2026-11-18): the `, LoS blocked`
 * of a `[CC ON TEAM]` line is said only where the raw sample pair AND the
 * interpolated points both read blocked (`losBlockedOnBothReadings`), and
 * never over a targeted cast that landed (`landedCastProvesLos`, asking the
 * cast's cast→effect family). The death trace's "had <external>
 * available" reads the either-blocked form (R72). Fixture: zone 1505's north pillar, the one
 * `dispelReachGrid.test.ts` uses — both samples of the holder see the
 * caster, the point between them sits inside the pillar.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  analyzePlayerCCAndTrinket,
  landedCastProvesLos,
} from "../src/utils/ccTrinketAnalysis";
import {
  hasLineOfSight,
  losBlockedOnBothReadings,
  losBlockedOnEitherReading,
  rawLineOfSightAt,
} from "../src/utils/losAnalysis";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const ZONE = "1505";
const D = { x: -2054.5, y: 6623.5 };
const A = { x: -2044.5, y: 6615.5 };
const B = { x: -2044.5, y: 6631.5 };
const MID = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
const POLYMORPH = "118";

describe("[CC ON TEAM] caster LoS: blocked on both readings (T172, R70)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const caster = () =>
    makeUnit("e1", {
      reaction: CombatUnitReaction.Hostile,
      advancedActions: [0, 1000, 2000, 3000].map((ms) =>
        makeAdvancedAction(T0 + ms, D.x, D.y),
      ),
    });
  // the control lands at +1.2 s: the holder's samples are 1.2 s either side
  const holder = (at: [typeof A, typeof A]) =>
    makeUnit("v", {
      advancedActions: [
        makeAdvancedAction(T0, at[0].x, at[0].y),
        makeAdvancedAction(T0 + 2400, at[1].x, at[1].y),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          POLYMORPH,
          T0 + 1200,
          "e1",
          "v",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          POLYMORPH,
          T0 + 5200,
          "e1",
          "v",
        ),
      ],
    });
  const combat = {
    startTime: T0 - 10_000,
    endTime: T0 + 60_000,
    startInfo: { zoneId: ZONE },
  };
  const ccOf = (v: ReturnType<typeof holder>) =>
    analyzePlayerCCAndTrinket(v, [caster()], combat).ccInstances[0]!;

  it("the fixture: both samples see the caster, the interpolated point does not", () => {
    expect(hasLineOfSight(ZONE, D, A)).toBe(true);
    expect(hasLineOfSight(ZONE, D, B)).toBe(true);
    expect(hasLineOfSight(ZONE, D, MID)).toBe(false);
    expect(
      rawLineOfSightAt(ZONE, caster(), holder([A, B]), T0 + 1200, 1500),
    ).toBe(true);
  });
  it("in sight on both raw samples: no `LoS blocked`, though the interpolated point is inside the pillar", () => {
    const cc = ccOf(holder([A, B]));
    expect(cc.distanceYards).not.toBeNull();
    expect(cc.losBlocked).toBe(false);
  });
  it("blocked on the raw pair only — the nearest sample behind the pillar, the interpolated point clear of it: not said", () => {
    // the holder's nearest sample (0.1 s before) is behind the pillar, the
    // next (0.2 s after) out in the open; the point between is in sight
    const OPEN = { x: -2054.5, y: 6640.5 };
    const v = makeUnit("v", {
      advancedActions: [
        makeAdvancedAction(T0 + 1000, MID.x, MID.y),
        makeAdvancedAction(T0 + 1300, OPEN.x, OPEN.y),
      ],
      auraEvents: holder([A, B]).auraEvents,
    });
    const at = T0 + 1100;
    const raw = rawLineOfSightAt(ZONE, caster(), v, at, 1500);
    const both = losBlockedOnBothReadings(ZONE, caster(), v, at, 1500);
    expect(raw).toBe(false);
    expect(both).toBe(false);
  });
  it("blocked on both readings: said", () => {
    const cc = ccOf(holder([MID, MID]));
    expect(cc.distanceYards).not.toBeNull();
    expect(cc.losBlocked).toBe(true);
    expect(
      losBlockedOnBothReadings(
        ZONE,
        caster(),
        holder([MID, MID]),
        T0 + 1200,
        1500,
      ),
    ).toBe(true);
  });
  it("no sample pair inside the gap: unknown, not said", () => {
    expect(
      losBlockedOnBothReadings(
        ZONE,
        caster(),
        holder([MID, MID]),
        T0 + 30_000,
        1500,
      ),
    ).toBeNull();
  });
  it("the death trace's form: blocked on either reading (R72)", () => {
    // raw pair in sight, interpolated point inside the pillar
    expect(
      losBlockedOnEitherReading(
        ZONE,
        caster(),
        holder([A, B]),
        T0 + 1200,
        1500,
      ),
    ).toBe(true);
    // both blocked
    expect(
      losBlockedOnEitherReading(
        ZONE,
        caster(),
        holder([MID, MID]),
        T0 + 1200,
        1500,
      ),
    ).toBe(true);
    // both in sight
    expect(
      losBlockedOnEitherReading(
        ZONE,
        caster(),
        holder([A, A]),
        T0 + 1200,
        1500,
      ),
    ).toBe(false);
    // no sample pair inside the gap
    expect(
      losBlockedOnEitherReading(
        ZONE,
        caster(),
        holder([A, A]),
        T0 + 30_000,
        1500,
      ),
    ).toBeNull();
  });
  it("a landed targeted cast proves sight through its cast→effect family (Fear: cast 5782, aura 118699)", () => {
    const cast = (id: string, ms: number, dest = "v") => [
      makeSpellCastEvent(id, T0 + ms, dest, "V", "e1", "E"),
    ];
    expect(
      landedCastProvesLos(cast("5782", 1190), "118699", "v", T0 + 1200),
    ).toBe(true);
    // the aura's own id, as before
    expect(
      landedCastProvesLos(cast("118699", 1190), "118699", "v", T0 + 1200),
    ).toBe(true);
    // another spell, another target, after the aura, too long before it
    expect(
      landedCastProvesLos(cast("118", 1190), "118699", "v", T0 + 1200),
    ).toBe(false);
    expect(
      landedCastProvesLos(cast("5782", 1190, "w"), "118699", "v", T0 + 1200),
    ).toBe(false);
    expect(
      landedCastProvesLos(cast("5782", 1210), "118699", "v", T0 + 1200),
    ).toBe(false);
    expect(
      landedCastProvesLos(cast("5782", -400), "118699", "v", T0 + 1200),
    ).toBe(false);
  });
});
