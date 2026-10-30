/**
 * A STAYED IN / KITED span is not measured on the log owner's corpse.
 *
 * The burst-span samples are the span's rendered seconds (`tStart … tEnd`,
 * whole seconds). `getUnitPositionAtTime` holds a unit's last position for
 * `INTERP_MAX_GAP_MS` (1.5 s) past its last sample — and a dead player's last
 * sample is the death. So a span whose last rendered second fell up to 1.5 s
 * after the owner's death was measured against the spot the owner died on
 * (the enemy's distance to a corpse), and a span that began in that 1.5 s was
 * built from nothing else. A death further from the span's end already gave
 * no event: the end sample had no position.
 *
 * On the 605-file capture of f8ce87ae (3,520 prompts, the owner dies in 702):
 * 16 STAYED IN lines end after the owner's death second, 1 starts after it,
 * and 2 KITED lines put their peak after it — every one within 2 s of the
 * death.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { positionMistakeEvents } from "../src/analysis/candidateFindings";
import {
  burstSpanSampledAfterDeath,
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
  type IPositionEvent,
  KITED_SECTION_HEADER,
  STAYED_IN_SECTION_HEADER,
} from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
const END = T0 + 60_000;

/** A unit sampled every 500 ms until `diesAtS` (the death is its last
 *  sample, at 0 HP) or to the end of the match. */
function unit(
  id: string,
  name: string,
  spec: CombatUnitSpec,
  opts: {
    x: (s: number) => number;
    hpPct?: number;
    diesAtS?: number;
  },
): any {
  const sample = (ms: number, hp: number) => ({
    timestamp: T0 + ms,
    logLine: { timestamp: T0 + ms },
    advanced: true,
    advancedActorId: id,
    advancedActorCurrentHp: hp,
    advancedActorMaxHp: 100,
    advancedActorPositionX: opts.x(ms / 1000),
    advancedActorPositionY: 0,
    advancedActorPowers: [],
  });
  const lastMs =
    opts.diesAtS === undefined ? 60_000 : Math.round(opts.diesAtS * 1000);
  const advancedActions = [];
  for (let ms = 0; ms <= 60_000 && ms < lastMs; ms += 500)
    advancedActions.push(sample(ms, opts.hpPct ?? 50));
  advancedActions.push(
    sample(lastMs, opts.diesAtS === undefined ? (opts.hpPct ?? 50) : 0),
  );
  return {
    id,
    name,
    spec,
    advancedActions,
    deathRecords:
      opts.diesAtS === undefined ? [] : [{ timestamp: T0 + lastMs }],
    damageOut: [],
    damageIn: [],
  };
}

const burst = (from: number, to: number): any => ({
  fromSeconds: from,
  toSeconds: to,
  activeCDs: [],
  threatScore: 1,
  threatLabel: "High",
  dangerScore: 1,
  dangerLabel: "High",
  dampeningPct: 0,
  damageInWindow: 0,
  damageRatio: 0,
  healerCCed: false,
  mostPressuredTarget: {
    unitName: "Owner-R-US",
    startHpPct: 100,
    midHpPct: 50,
    endHpPct: 30,
  },
});

/** The owner stands still at x = 0, 3 yd from the enemy, at 20 % HP. */
const standingOwner = (diesAtS?: number) =>
  unit("o", "Owner-R-US", CombatUnitSpec.Paladin_Holy, {
    x: () => 0,
    hpPct: 20,
    ...(diesAtS === undefined ? {} : { diesAtS }),
  });
/** The owner runs from x = 0 to x = 40 between 10 s and 15 s, then stands. */
const kitingOwner = (diesAtS?: number) =>
  unit("o", "Owner-R-US", CombatUnitSpec.Paladin_Holy, {
    x: (s) => Math.max(0, Math.min(40, (s - 10) * 8)),
    ...(diesAtS === undefined ? {} : { diesAtS }),
  });
const ENEMY = () =>
  unit("e1", "Dk-R-US", CombatUnitSpec.DeathKnight_Unholy, { x: () => -3 });

const run = (owner: any, from: number, to: number) =>
  computeOwnerPositionEvents({
    owner,
    enemies: [ENEMY()],
    combat: { startTime: T0, endTime: END },
    burstWindows: [burst(from, to)],
    ownerCooldowns: [],
    isHealer: true,
    ownerIsMelee: false,
  });
const spans = (evs: IPositionEvent[]) =>
  evs.filter((e) => e.type === "STAYED_IN" || e.type === "KITED");
const OWNER_REF = { id: "o", name: "Owner-R-US" };

describe("burstSpanSampledAfterDeath — the one predicate", () => {
  const owner = standingOwner(19.4);
  it("a rendered second after the death is a sample on the corpse", () => {
    expect(burstSpanSampledAfterDeath(owner, T0, 20)).toBe(true);
    expect(burstSpanSampledAfterDeath(owner, T0, 25)).toBe(true);
  });
  it("the death second itself is sampled at its first instant, before the death", () => {
    expect(burstSpanSampledAfterDeath(owner, T0, 19)).toBe(false);
    expect(burstSpanSampledAfterDeath(owner, T0, 10)).toBe(false);
  });
  it("a death on a whole second: that second's sample is the death", () => {
    expect(burstSpanSampledAfterDeath(standingOwner(19), T0, 19)).toBe(true);
    expect(burstSpanSampledAfterDeath(standingOwner(19), T0, 18)).toBe(false);
  });
  it("a unit that never died has no such second", () => {
    expect(burstSpanSampledAfterDeath(standingOwner(), T0, 59)).toBe(false);
  });
});

describe("a span that straddles the owner's death is not emitted", () => {
  it("STAYED IN 0:10–0:20 with the owner dead at 19.4 s: no event, no line, no candidate", () => {
    const evs = run(standingOwner(19.4), 10, 20);
    expect(spans(evs)).toEqual([]);
    expect(formatPositionEventsForContext(evs).join("\n")).not.toContain(
      STAYED_IN_SECTION_HEADER,
    );
    expect(positionMistakeEvents(evs, OWNER_REF)).toEqual([]);
  });

  it("KITED with the peak's span running past the death: no event, no line", () => {
    const evs = run(kitingOwner(19.4), 10, 20);
    expect(spans(evs)).toEqual([]);
    expect(formatPositionEventsForContext(evs).join("\n")).not.toContain(
      KITED_SECTION_HEADER,
    );
  });

  it("control — the same spans with the owner alive are emitted", () => {
    const stay = spans(run(standingOwner(), 10, 20));
    expect(stay.map((e) => e.type)).toEqual(["STAYED_IN"]);
    expect(stay[0]!.toSeconds).toBe(20);
    expect(positionMistakeEvents(stay, OWNER_REF)).toHaveLength(1);
    const kite = spans(run(kitingOwner(), 10, 20));
    expect(kite.map((e) => e.type)).toEqual(["KITED"]);
  });

  it("control — a death after the span's last rendered second leaves it alone", () => {
    // dies at 20.4 s: the 0:20 sample is the owner 0.4 s before the death
    const stay = spans(run(standingOwner(20.4), 10, 20));
    expect(stay.map((e) => e.type)).toEqual(["STAYED_IN"]);
    expect(stay[0]).toMatchObject({
      atSeconds: 10,
      toSeconds: 20,
      startDistanceYards: 3,
      endDistanceYards: 3,
    });
    // …and one long after it
    expect(spans(run(standingOwner(45), 10, 20))).toHaveLength(1);
  });
});

describe("a span that starts after the owner's death is not emitted", () => {
  it("the owner dead at 9.9 s, a burst window 0:10–0:11: nothing is measured on the corpse", () => {
    const evs = run(standingOwner(9.9), 10.2, 11.4);
    expect(spans(evs)).toEqual([]);
    expect(positionMistakeEvents(evs, OWNER_REF)).toEqual([]);
  });

  it("control — the same short window with the owner alive is a stay", () => {
    expect(spans(run(standingOwner(), 10.2, 11.4)).map((e) => e.type)).toEqual([
      "STAYED_IN",
    ]);
  });
});

describe("dropped, not cut at the death", () => {
  it("a death further inside the span gave no event before either — the end has no position", () => {
    // dead at 16.2 s: 0:20 is 3.8 s past the last sample (the 1.5 s guard)
    expect(spans(run(standingOwner(16.2), 10, 20))).toEqual([]);
    // dead at 18.4 s: 1.6 s past it
    expect(spans(run(standingOwner(18.4), 10, 20))).toEqual([]);
  });

  it("no shorter span ending at the death takes its place", () => {
    for (const diesAtS of [16.2, 18.4, 18.6, 19.4, 19.9]) {
      const evs = spans(run(standingOwner(diesAtS), 10, 20));
      expect(evs, `dead at ${diesAtS}`).toEqual([]);
    }
  });

  it("a dropped stay frees its menu slot: the cap (2) then lists a stay it had pushed out", () => {
    const windows = [burst(10, 20), burst(25, 35), burst(40, 50)];
    const rowsOf = (owner: any) =>
      positionMistakeEvents(
        computeOwnerPositionEvents({
          owner,
          enemies: [ENEMY()],
          combat: { startTime: T0, endTime: END },
          burstWindows: windows,
          ownerCooldowns: [],
          isHealer: true,
          ownerIsMelee: false,
        }),
        OWNER_REF,
      ).map((e) => e.t);
    // alive: three stays at 20 % HP, the cap keeps the first two
    expect(rowsOf(standingOwner())).toEqual([10, 25]);
    // dead at 49.4 s: the 0:40–0:50 stay read 0 % on the corpse and sorted
    // first (rows 40, 10); without it the two living stays are the rows
    expect(rowsOf(standingOwner(49.4))).toEqual([10, 25]);
  });
});
