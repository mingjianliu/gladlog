/**
 * Triage 2026-09-29, group G14 — one STAYED IN template:
 *  - sync-burst F-L2 + F-L2b (user ruling 2026-09-30, A′12): the burst target
 *    of a POSITIONING line is the header spike only while that spike covers
 *    at least half of the line's own span; otherwise the friendly under the
 *    most incoming pressure in the span;
 *  - position F-S2 (A′13 = C): CC / root seconds on the line, and the skip
 *    rule reads hard CC ∪ roots ∪ the owner's own immunity;
 *  - position F-S4 (A60 = B): the tag is a fact, selected by the menu gate's
 *    own predicate;
 *  - position F-S5: how long of the span the owner could not cast.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  FULL_IMMUNITY_IDS,
  IMMUNITY_IDS,
  IMMUNITY_SAVE_AURA_NAMES,
  isImmunitySaveAura,
  isOwnImmunityInterval,
  SCHOOL_LIMITED_IMMUNITY_IDS,
} from "../src/utils/enemyDefensives";
import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
  type IPositionEvent,
  mostPressuredInSpan,
  SPIKE_SPAN_MIN_SHARE,
  STAYED_IN_NEAR_DEATH_PCT,
} from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
const END = T0 + 60_000;

function unit(
  id: string,
  name: string,
  spec: CombatUnitSpec,
  x: number,
  /** damage taken per second inside [10, 20] */
  dmgPerSec = 0,
): any {
  const advancedActions = [];
  for (let ms = 0; ms <= 60_000; ms += 500)
    advancedActions.push({
      timestamp: T0 + ms,
      logLine: { timestamp: T0 + ms },
      advanced: true,
      advancedActorCurrentHp: 50,
      advancedActorMaxHp: 100,
      advancedActorPositionX: x,
      advancedActorPositionY: 0,
      advancedActorPowers: [],
    });
  const damageIn = [];
  if (dmgPerSec > 0)
    for (let s = 10; s <= 20; s++)
      damageIn.push({
        logLine: { timestamp: T0 + s * 1000 },
        timestamp: T0 + s * 1000,
        effectiveAmount: -dmgPerSec,
        srcUnitId: "e1",
      });
  return {
    id,
    name,
    spec,
    advancedActions,
    deathRecords: [],
    damageOut: [],
    damageIn,
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
    unitName: "Mate-R-US",
    startHpPct: 100,
    midHpPct: 50,
    endHpPct: 30,
  },
});

const OWNER = (dmg = 0, spec = CombatUnitSpec.Paladin_Holy) =>
  unit("o", "Owner-R-US", spec, 0, dmg);
const MATE = (dmg = 0) =>
  unit("m", "Mate-R-US", CombatUnitSpec.Hunter_Marksmanship, 30, dmg);
const ENEMY = () => unit("e1", "Dk-R-US", CombatUnitSpec.DeathKnight_Unholy, 3);

const run = (owner: any, friends: any[] | undefined, extra: any = {}) =>
  computeOwnerPositionEvents({
    owner,
    enemies: [ENEMY()],
    combat: { startTime: T0, endTime: END },
    burstWindows: [burst(10, 20)],
    ownerCooldowns: [],
    isHealer: true,
    ownerIsMelee: false,
    ...(friends ? { friends } : {}),
    ...extra,
  });
const stayed = (evs: IPositionEvent[]) =>
  evs.filter((e) => e.type === "STAYED_IN");
const spike = (fromSeconds: number, targetName = "Mate-R-US") => ({
  fromSeconds,
  toSeconds: fromSeconds + 10,
  targetName,
});

describe("burst target of a POSITIONING line (F-L2 + F-L2b)", () => {
  it("the share is one half (signed A′12)", () => {
    expect(SPIKE_SPAN_MIN_SHARE).toBe(0.5);
  });

  it("mostPressuredInSpan: the hardest-hit friendly inside the span, nobody when nobody was hit", () => {
    const o = OWNER(50_000);
    const m = MATE(10_000);
    expect(mostPressuredInSpan([m, o], T0 + 10_000, T0 + 20_000)).toBe(
      "Owner-R-US",
    );
    expect(mostPressuredInSpan([m, o], T0 + 30_000, T0 + 40_000)).toBe(
      undefined,
    );
    expect(mostPressuredInSpan(undefined, T0, END)).toBe(undefined);
  });

  it("a spike that starts after the span ended yields to the span's own pressure (f4eb8c87 shape)", () => {
    // ±5 s rule admits the 22–32 spike on the mate; the owner took the damage in 10–20
    const o = OWNER(50_000);
    const [e] = stayed(
      run(o, [o, MATE(10_000)], { spikeWindows: [spike(22)] }),
    );
    expect(e!.burstTargetsOwner).toBe(true);
    expect(e!.burstTargetName).toBeUndefined();
  });

  it("a spike covering at least half of the span is kept, whatever the span pressure says", () => {
    // 15–25 covers 5 of 10 s
    const o = OWNER(50_000);
    const [e] = stayed(
      run(o, [o, MATE(10_000)], { spikeWindows: [spike(15)] }),
    );
    expect(e!.burstTargetsOwner).toBe(false);
    expect(e!.burstTargetName).toBe("Mate-R-US");
  });

  it("a spike covering less than half of the span yields (4446729d shape: 1.26 s of 10 s)", () => {
    const o = OWNER(50_000);
    const [e] = stayed(
      run(o, [o, MATE(10_000)], { spikeWindows: [spike(18.74)] }),
    );
    expect(e!.burstTargetsOwner).toBe(true);
  });

  it("no spike at all: the span's pressure replaces the whole-window pick", () => {
    const o = OWNER(50_000);
    const [e] = stayed(run(o, [o, MATE(10_000)]));
    expect(e!.burstTargetsOwner).toBe(true);
  });

  it("nobody hit in the span → the product's pick stands (spike, then the window's most pressured)", () => {
    const o = OWNER(0);
    expect(
      stayed(run(o, [o, MATE(0)], { spikeWindows: [spike(22)] }))[0]!
        .burstTargetName,
    ).toBe("Mate-R-US");
    expect(stayed(run(o, [o, MATE(0)]))[0]!.burstTargetName).toBe("Mate-R-US");
  });

  it("no friendlies passed (old callers) → unchanged behaviour", () => {
    const [e] = stayed(
      run(OWNER(50_000), undefined, { spikeWindows: [spike(22)] }),
    );
    expect(e!.burstTargetName).toBe("Mate-R-US");
  });

  it("a melee owner whose span target is a teammate loses the STAYED IN line; as the target they keep it", () => {
    const melee = (dmg: number) => OWNER(dmg, CombatUnitSpec.DemonHunter_Havoc);
    const args = { isHealer: false, ownerIsMelee: true };
    const hitMate = melee(10_000);
    expect(
      stayed(
        run(hitMate, [hitMate, MATE(50_000)], {
          ...args,
          spikeWindows: [spike(18.74, "Owner-R-US")],
        }),
      ),
    ).toHaveLength(0);
    const hitOwner = melee(50_000);
    expect(
      stayed(
        run(hitOwner, [hitOwner, MATE(10_000)], {
          ...args,
          spikeWindows: [spike(22)],
        }),
      ),
    ).toHaveLength(1);
  });
});

describe("STAYED IN: CC / root seconds and the skip rule (F-S2)", () => {
  const cc = (atSeconds: number, durationSeconds: number) => ({
    atSeconds,
    durationSeconds,
  });

  it("no summary passed → the seconds are unknown, not 0", () => {
    const o = OWNER();
    const [e] = stayed(run(o, [o]));
    expect(e!.ownerCcSeconds).toBeUndefined();
    expect(e!.ownerRootSeconds).toBeUndefined();
  });

  it("carries merged CC and root seconds of the span", () => {
    const o = OWNER();
    const [e] = stayed(
      run(o, [o], {
        ownerCCSummary: {
          ccInstances: [cc(11, 2), cc(12, 2)],
          rootInstances: [cc(18.5, 5)],
        },
      }),
    );
    expect(e!.ownerCcSeconds).toBe(3);
    expect(e!.ownerRootSeconds).toBe(1.5);
    expect(e!.ownerCcOrRootSeconds).toBe(4.5);
  });

  it("a root inside a stun counts in both figures; the union says how long in all", () => {
    const o = OWNER();
    const [e] = stayed(
      run(o, [o], {
        ownerCCSummary: {
          ccInstances: [cc(11, 4)],
          rootInstances: [cc(11, 4)],
        },
      }),
    );
    expect(e!.ownerCcSeconds).toBe(4);
    expect(e!.ownerRootSeconds).toBe(4);
    expect(e!.ownerCcOrRootSeconds).toBe(4);
    const text = formatPositionEventsForContext([e!]).join("\n");
    expect(text).toContain("CC'd 4s of ");
    expect(text).toContain(" — rooted 4s (4s in all)");
  });

  it("CC alone under half, CC + root reaching half → the window is dropped (b12bfef4 shape)", () => {
    const o = OWNER();
    expect(
      stayed(run(o, [o], { ownerCCSummary: { ccInstances: [cc(10, 4.4)] } })),
    ).toHaveLength(1);
    expect(
      stayed(
        run(o, [o], {
          ownerCCSummary: {
            ccInstances: [cc(10, 4.4)],
            rootInstances: [cc(15, 1.4)],
          },
        }),
      ),
    ).toHaveLength(0);
  });

  it("the owner's OWN immunity counts toward the skip; a teammate's on the owner does not", () => {
    const withAura = (srcName: string, spellId = "45438" /* Ice Block */) => {
      const o = OWNER();
      const ev = (event: LogEvent, s: number) => ({
        logLine: { event, timestamp: T0 + s * 1000 },
        timestamp: T0 + s * 1000,
        spellId,
        spellName: "x",
        srcUnitId: srcName === o.name ? o.id : "m",
        srcUnitName: srcName,
        destUnitId: o.id,
        destUnitName: o.name,
      });
      o.auraEvents = [
        ev(LogEvent.SPELL_AURA_APPLIED, 12),
        ev(LogEvent.SPELL_AURA_REMOVED, 18),
      ];
      return o;
    };
    const own = withAura("Owner-R-US");
    expect(stayed(run(own, [own]))).toHaveLength(0);
    const other = withAura("Mate-R-US");
    expect(stayed(run(other, [other]))).toHaveLength(1);
    // a school-limited immunity is not "nothing to kite from" (A30 / E24:
    // only by the damage-share test, not landed): Cloak of Shadows, Blessing
    // of Protection and Spellwarding on oneself keep the window
    for (const id of ["31224", "1022", "204018"]) {
      const limited = withAura("Owner-R-US", id);
      expect(stayed(run(limited, [limited])), id).toHaveLength(1);
    }
  });
});

describe("STAYED IN line template (F-S2 + F-S4 + F-S5)", () => {
  const ev = (over: Partial<IPositionEvent>): IPositionEvent => ({
    type: "STAYED_IN",
    atSeconds: 174,
    toSeconds: 184,
    startDistanceYards: 7.7,
    endDistanceYards: 2.9,
    nearestEnemyName: "Shalamayne-Proudmoore-US",
    dangerLabel: "High",
    burstTargetsOwner: true,
    ownerMovedYards: 6.5,
    ownerHpStartPct: 64,
    ownerHpMinPct: 9,
    ownerDefensiveAvailable: true,
    ...over,
  });
  const line = (e: IPositionEvent) =>
    formatPositionEventsForContext([e]).find((l) => l.includes(" burst] "))!;

  it("orders the parts: moved, lock, target, HP, defensive", () => {
    expect(
      line(
        ev({
          ownerCcSeconds: 3,
          ownerRootSeconds: 2.2,
          ownerCannotCastSeconds: 3.02,
        }),
      ),
    ).toBe(
      "    2:54–3:04 [High burst] 7.7→2.9yd from Shalamayne-Proudmoore-US — you moved 6.5 yd yourself (span start→end) — CC'd 3s of 10s — rooted 2s — you were the burst target — your HP 64%→9% (min over window) (near-death — the stay was costly) — a defensive CD was available (you could not cast for 3s of it)",
    );
  });

  it("no CC, no root, under a second blocked → no extra parts", () => {
    const l = line(
      ev({
        ownerCcSeconds: 0,
        ownerRootSeconds: 0,
        ownerCannotCastSeconds: 0.9,
      }),
    );
    expect(l).not.toContain("CC'd");
    expect(l).not.toContain("rooted");
    expect(l.endsWith("— a defensive CD was available")).toBe(true);
  });

  it("a sub-half-second CC prints <1", () => {
    expect(line(ev({ ownerCcSeconds: 0.3 }))).toContain("— CC'd <1s of 10s");
  });

  it("'no defensive CD available' never carries the cannot-cast clause", () => {
    const l = line(
      ev({ ownerDefensiveAvailable: false, ownerCannotCastSeconds: 6 }),
    );
    expect(l.endsWith("— no defensive CD available")).toBe(true);
  });

  it("the tag is the gate's predicate: 34 near-death, 35 and above the fact (A60 = B)", () => {
    expect(line(ev({ ownerHpMinPct: STAYED_IN_NEAR_DEATH_PCT - 1 }))).toContain(
      "(near-death — the stay was costly)",
    );
    for (const hp of [STAYED_IN_NEAR_DEATH_PCT, 80]) {
      const l = line(ev({ ownerHpMinPct: hp }));
      expect(l).toContain("(HP stayed at or above 35%)");
      expect(l).not.toContain("near-death");
      expect(l).not.toContain("no real cost");
    }
  });

  it("keeps the positioning gate's anchors", () => {
    const l = line(ev({ ownerCcSeconds: 3, ownerRootSeconds: 2 }));
    expect(l).toMatch(
      /^ +(\d+:\d{2})(?:–\d+:\d{2})? \[[^\]]+ burst\] (?:opened )?([\d.]+)→([\d.]+)yd from (\S+)/,
    );
    expect(l).toContain("you moved 6.5 yd yourself (span start→end) — CC'd");
  });
});

describe("ownerCannotCastSeconds (F-S5)", () => {
  it("is 0 for an owner with no blocking aura, and is always present on STAYED_IN", () => {
    const o = OWNER();
    const [e] = stayed(run(o, [o]));
    expect(e!.ownerCannotCastSeconds).toBe(0);
  });
});

describe("isOwnImmunityInterval — the skip rule's immunity leg", () => {
  const me = { name: "Owner" };
  it("is the self-applied FULL half (the shared F-K9b-B split) of the [ENEMY DEF] immune test", () => {
    // Divine Shield, Ice Block, Aspect of the Turtle — pinned in
    // immunityTables.test.ts; here only that the skip rule reads that set
    expect(FULL_IMMUNITY_IDS.size).toBeGreaterThan(0);
    for (const id of FULL_IMMUNITY_IDS) {
      expect(IMMUNITY_IDS.has(id), id).toBe(true);
      expect(isImmunitySaveAura(id), id).toBe(true);
      expect(
        isOwnImmunityInterval(me, { spellId: id, srcUnitName: "Owner" }),
        id,
      ).toBe(true);
      // somebody else's immunity on the owner is not the owner's choice
      expect(
        isOwnImmunityInterval(me, { spellId: id, srcUnitName: "Other" }),
        id,
      ).toBe(false);
    }
  });

  it("a school-limited immunity is not one here (ruling F-K9b-B)", () => {
    // Blessing of Protection (physical), Spellwarding and Cloak (magic)
    expect([...SCHOOL_LIMITED_IMMUNITY_IDS].sort()).toEqual(
      ["1022", "204018", "31224"].sort(),
    );
    for (const id of SCHOOL_LIMITED_IMMUNITY_IDS) {
      expect(IMMUNITY_IDS.has(id), id).toBe(true);
      expect(
        isOwnImmunityInterval(me, { spellId: id, srcUnitName: "Owner" }),
        id,
      ).toBe(false);
    }
  });

  it("does not take the immunity-kind saves (Vanish, Cheat Death, Cauterize, …)", () => {
    expect(IMMUNITY_SAVE_AURA_NAMES.size).toBeGreaterThan(0);
    for (const id of IMMUNITY_SAVE_AURA_NAMES.keys()) {
      if (IMMUNITY_IDS.has(id)) continue;
      expect(
        isOwnImmunityInterval(me, { spellId: id, srcUnitName: "Owner" }),
        id,
      ).toBe(false);
    }
  });
});
