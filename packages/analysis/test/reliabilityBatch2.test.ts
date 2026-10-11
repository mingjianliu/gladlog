/**
 * Reliability leftovers batch 2 (2026-09-26): shapeshift-ended buffs, the
 * owner's rating beside the ≥2100 baselines, hard-cast occupancy bounds.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { hardCastOccupancyWithin } from "../src/utils/dispelAnalysis";
import { BASELINE_RATING_FLOOR, formatDTPSBaselines, formatSpecBaselines } from "../src/utils/specBaselines";
import { makeAuraEvent, makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("[BUFF FADED] — a buff removed with the druid's own form is 'form_shift'", () => {
  const FR = "22842"; // Frenzied Regeneration (Bear Form only)
  function druid(withFormRemoval: boolean) {
    const auraEvents = [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FR, T0 + 10_000, "player-1", "player-1", "BUFF"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, FR, T0 + 10_400, "player-1", "player-1", "BUFF"),
      ...(withFormRemoval
        ? [makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "5487", T0 + 10_410, "player-1", "player-1", "BUFF")]
        : []),
    ];
    return makeUnit("player-1", {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      spellCastEvents: [makeSpellCastEvent(FR, T0 + 10_000, "player-1")],
      auraEvents,
    }) as ICombatUnit;
  }
  const cds = [
    { spellId: FR, spellName: "Frenzied Regeneration", tag: "Defensive", casts: [{ timeSeconds: 10 }], cooldownSeconds: 36, neverUsed: false, availableWindows: [] },
  ] as never;
  it("a non-form-bound buff on a TEAMMATE removed at the form's instant stays ended_early (codex)", () => {
    const owner = druid(true);
    const mate = makeUnit("player-2", {
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "102342", T0 + 10_000, "player-1", "player-2", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "102342", T0 + 10_400, "player-1", "player-2", "BUFF"),
      ],
    }) as ICombatUnit;
    const ironbark = [
      { spellId: "102342", spellName: "Ironbark", tag: "Defensive", casts: [{ timeSeconds: 10 }], cooldownSeconds: 90, neverUsed: false, availableWindows: [] },
    ] as never;
    const r = extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, mate], T0, owner);
    expect(r.map((e) => e.cause)).toEqual(["ended_early"]);
  });
  it("form removal within 250 ms → form_shift; without it → ended_early", () => {
    const withForm = druid(true);
    const a = extractOwnerCDBuffExpiry(cds, "player-1", [withForm], T0, withForm);
    expect(a.map((e) => e.cause)).toEqual(["form_shift"]);
    const noForm = druid(false);
    const b = extractOwnerCDBuffExpiry(cds, "player-1", [noForm], T0, noForm);
    expect(b.map((e) => e.cause)).toEqual(["ended_early"]);
  });
  // triage 2026-09-29 death-kill F-B1: the death cascade
  it("F-B1: removed from the owner ≤ 100 ms before the owner's death → death (before the form reading)", () => {
    const withForm = druid(true);
    (withForm as { deathRecords: unknown[] }).deathRecords = [{ timestamp: T0 + 10_445 }];
    const r = extractOwnerCDBuffExpiry(cds, "player-1", [withForm], T0, withForm);
    expect(r.map((e) => e.cause)).toEqual(["death"]);
    const late = druid(false);
    (late as { deathRecords: unknown[] }).deathRecords = [{ timestamp: T0 + 10_790 }];
    expect(extractOwnerCDBuffExpiry(cds, "player-1", [late], T0, late).map((e) => e.cause)).toEqual(["ended_early"]);
  });
  // FT-T08 step 3: the causes the log itself states
  describe("FT-T08: the end cause is read off the log", () => {
    const IRONBARK = "102342";
    const ironbark = [
      { spellId: IRONBARK, spellName: "Ironbark", tag: "Defensive", casts: [{ timeSeconds: 10 }], cooldownSeconds: 90, neverUsed: false, availableWindows: [] },
    ] as never;
    const mateWith = (removedAtMs: number, extra: Partial<ICombatUnit> = {}, amounts?: { applied: number; left: number; absorbed?: number }) => {
      const applied = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, IRONBARK, T0 + 10_000, "player-1", "player-2", "BUFF") as any;
      const removed = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, IRONBARK, removedAtMs, "player-1", "player-2", "BUFF") as any;
      if (amounts) {
        applied.amount = amounts.applied;
        removed.amount = amounts.left;
      }
      return makeUnit("player-2", {
        class: CombatUnitClass.Warrior,
        spec: CombatUnitSpec.Warrior_Arms,
        auraEvents: [applied, removed],
        absorbsIn: amounts?.absorbed
          ? ([
              {
                logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: removedAtMs - 500, parameters: [] },
                timestamp: removedAtMs - 500,
                spellId: IRONBARK,
                srcUnitId: "player-1",
                destUnitId: "player-2",
                absorbedAmount: amounts.absorbed,
              },
            ] as never)
          : [],
        ...extra,
      }) as ICombatUnit;
    };
    const dispel = (event: LogEvent, atMs: number) =>
      ({
        logLine: { event, timestamp: atMs, parameters: [] },
        timestamp: atMs,
        spellId: "378773",
        spellName: "Greater Purge",
        srcUnitId: "enemy-1",
        srcUnitName: "Shammy",
        destUnitId: "player-2",
        extraSpellId: IRONBARK,
      }) as never;

    it("a SPELL_DISPEL of the aura on its holder at the removal → dispelled, even inside the expiry tolerance", () => {
      const owner = druid(false);
      // removed at 21.2 s of a 12 s Ironbark cast at 10 s → inside the 1.5 s tolerance ("expired" before)
      const at = T0 + 21_200;
      const mate = mateWith(at, { actionIn: [dispel(LogEvent.SPELL_DISPEL, at)] as never });
      const [e] = extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, mate], T0, owner);
      expect(e).toMatchObject({
        cause: "dispelled",
        endedBy: { unitId: "enemy-1", unitName: "Shammy", spellName: "Greater Purge" },
      });
      // a dispel of ANOTHER aura, or one a second away, is not this buff's end
      const other = mateWith(at, { actionIn: [{ ...(dispel(LogEvent.SPELL_DISPEL, at) as object), extraSpellId: "1" }] as never });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, other], T0, owner)[0]!.cause).toBe("expired");
      const far = mateWith(at, { actionIn: [dispel(LogEvent.SPELL_DISPEL, at - 1_000)] as never });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, far], T0, owner)[0]!.cause).toBe("expired");
    });

    it("SPELL_STOLEN → stolen", () => {
      const owner = druid(false);
      const at = T0 + 13_000;
      const mate = mateWith(at, { actionIn: [dispel(LogEvent.SPELL_STOLEN, at)] as never });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, mate], T0, owner)[0]).toMatchObject({ cause: "stolen" });
    });

    it("the teammate it was on died at the removal → target_death, not \"ended early\"", () => {
      const owner = druid(false);
      const at = T0 + 13_000;
      const mate = mateWith(at, { deathRecords: [{ timestamp: at + 40 }] as never });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, mate], T0, owner)[0]!.cause).toBe("target_death");
    });

    it("an absorb whose REMOVED line has 0 left → absorbed; one with some left keeps its timing cause and carries the amounts", () => {
      const owner = druid(false);
      const usedUp = mateWith(T0 + 13_000, {}, { applied: 247_413, left: 0, absorbed: 247_413 });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, usedUp], T0, owner)[0]).toMatchObject({
        cause: "absorbed",
        absorb: { absorbed: 247_413, left: 0 },
      });
      const partly = mateWith(T0 + 22_000, {}, { applied: 210_600, left: 136_990, absorbed: 73_610 });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, partly], T0, owner)[0]).toMatchObject({
        cause: "expired",
        absorb: { absorbed: 73_610, left: 136_990 },
      });
      // untouched, or an amount on a line that no absorb line backs: nothing is claimed
      const untouched = mateWith(T0 + 22_000, {}, { applied: 247_413, left: 247_413 });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, untouched], T0, owner)[0]!.absorb).toBeUndefined();
      const amountOnly = mateWith(T0 + 13_000, {}, { applied: 90_000, left: 0 });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, amountOnly], T0, owner)[0]).toMatchObject({ cause: "ended_early" });
    });

    it("codex 3a P2-3: a dispel line is read before the holder's death right after it", () => {
      const owner = druid(false);
      const at = T0 + 13_000;
      const mate = mateWith(at, {
        actionIn: [dispel(LogEvent.SPELL_DISPEL, at)] as never,
        deathRecords: [{ timestamp: at + 40 }] as never,
      });
      expect(extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, mate], T0, owner)[0]!.cause).toBe("dispelled");
    });
  });

  it("F-B1 negative (codex c2): an owner-cast external removed from a TEAMMATE just before the owner dies stays ended_early", () => {
    const owner = druid(false);
    (owner as { deathRecords: unknown[] }).deathRecords = [{ timestamp: T0 + 10_450 }];
    const mate = makeUnit("player-2", {
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "102342", T0 + 10_000, "player-1", "player-2", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "102342", T0 + 10_400, "player-1", "player-2", "BUFF"),
      ],
    }) as ICombatUnit;
    const ironbark = [
      { spellId: "102342", spellName: "Ironbark", tag: "Defensive", casts: [{ timeSeconds: 10 }], cooldownSeconds: 90, neverUsed: false, availableWindows: [] },
    ] as never;
    const r = extractOwnerCDBuffExpiry(ironbark, "player-1", [owner, mate], T0, owner);
    expect(r.map((e) => e.cause)).toEqual(["ended_early"]);
  });

  // F02a: Touch of Karma's shield is its own aura (125174); the cast id's
  // buff (122470) is a 10 s marker. 2abc9185: pressed 1:12.71, the absorb
  // aura REMOVED 3.04 s in with a hit it took part of, the marker at 10.0 s.
  describe("F02a: Touch of Karma ends with its absorb aura, not the 10 s buff", () => {
    const KARMA = "122470";
    const ABSORB = "125174";
    const karma = [
      { spellId: KARMA, spellName: "Touch of Karma", tag: "Defensive", casts: [{ timeSeconds: 10 }], cooldownSeconds: 90, neverUsed: false, availableWindows: [] },
    ] as never;
    const hit = (atMs: number, amount: number) => ({
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: atMs, parameters: [] },
      timestamp: atMs,
      spellId: KARMA, // the absorb lines name the cast id as the shield
      srcUnitId: "player-1",
      destUnitId: "player-1",
      absorbedAmount: amount,
    });
    const monk = (absorbRemovedMs: number | null, hits: Array<[number, number]>) =>
      makeUnit("player-1", {
        class: CombatUnitClass.Monk,
        spec: CombatUnitSpec.Monk_Windwalker,
        spellCastEvents: [makeSpellCastEvent(KARMA, T0 + 10_000, "player-1")],
        auraEvents: [
          ...(absorbRemovedMs === null ? [] : [makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, ABSORB, T0 + 10_000, "player-1", "player-1", "BUFF")]),
          makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, KARMA, T0 + 10_000, "player-1", "player-1", "BUFF"),
          ...(absorbRemovedMs === null ? [] : [makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, ABSORB, absorbRemovedMs, "player-1", "player-1", "BUFF")]),
          makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, KARMA, T0 + 20_003, "player-1", "player-1", "BUFF"),
        ],
        absorbsIn: hits.map(([at, n]) => hit(at, n)) as never,
      }) as ICombatUnit;
    const target = (debuffRemovedMs: number, diedMs?: number) =>
      makeUnit("enemy-1", {
        name: "Mage",
        auraEvents: [
          makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, KARMA, T0 + 10_002, "player-1", "enemy-1", "DEBUFF"),
          makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, KARMA, debuffRemovedMs, "player-1", "enemy-1", "DEBUFF"),
        ],
        deathRecords: diedMs === undefined ? [] : ([{ timestamp: diedMs }] as never),
      }) as ICombatUnit;

    it("the absorb aura REMOVED early in the ms of a hit it absorbed → used up, at that time", () => {
      const owner = monk(T0 + 13_040, [[T0 + 10_500, 500_000], [T0 + 13_040, 81_820]]);
      const [e] = extractOwnerCDBuffExpiry(karma, "player-1", [owner], T0, owner, [target(T0 + 20_003)]);
      expect(e).toMatchObject({ cause: "absorbed", isEstimated: false, absorb: { absorbed: 581_820 } });
      expect(e!.expiresAtSeconds).toBeCloseTo(13.04, 3);
    });

    it("left with the 10 s buff → expired, with what it absorbed", () => {
      const owner = monk(T0 + 19_995, [[T0 + 12_000, 99_000]]);
      const [e] = extractOwnerCDBuffExpiry(karma, "player-1", [owner], T0, owner, [target(T0 + 20_003)]);
      expect(e).toMatchObject({ cause: "expired", absorb: { absorbed: 99_000 } });
      expect(e!.expiresAtSeconds).toBeCloseTo(19.995, 3);
    });

    it("left early with no hit at the removal, in the ms its debuff came off the enemy → says that, not 'used up'", () => {
      // b711d4ac: the mage it was cast on pressed Ice Block 0.77 s in
      const owner = monk(T0 + 10_770, [[T0 + 10_626, 184_707]]);
      const [e] = extractOwnerCDBuffExpiry(karma, "player-1", [owner], T0, owner, [target(T0 + 10_770)]);
      expect(e).toMatchObject({ cause: "target_debuff_off", lostOn: { unitId: "enemy-1", unitName: "Mage" }, absorb: { absorbed: 184_707 } });
      const [dead] = extractOwnerCDBuffExpiry(karma, "player-1", [owner], T0, owner, [target(T0 + 10_770, T0 + 10_800)]);
      expect(dead).toMatchObject({ cause: "target_death" });
      expect(dead!.lostOn).toBeUndefined();
      // neither in the log → what is left: ended early, no cause claimed
      const [bare] = extractOwnerCDBuffExpiry(karma, "player-1", [owner], T0, owner, [target(T0 + 20_003)]);
      expect(bare).toMatchObject({ cause: "ended_early" });
    });

    it("a log with no absorb aura keeps the cast id's end", () => {
      const owner = monk(null, [[T0 + 12_000, 99_000]]);
      const [e] = extractOwnerCDBuffExpiry(karma, "player-1", [owner], T0, owner);
      expect(e).toMatchObject({ cause: "expired" });
      expect(e!.expiresAtSeconds).toBeCloseTo(20.003, 3);
    });
  });
});

describe("SPEC BASELINES names the owner's rating against the reference bracket", () => {
  const data = {
    bySpec: {
      "Holy Priest": { sampleCount: 10, defensiveTiming: null, cdUsage: { "Guardian Spirit": { neverUsedRate: 0.1, medianFirstUseSeconds: 30, p75FirstUseSeconds: 60 } } },
    },
  };
  const cds = [{ spellId: "47788", spellName: "Guardian Spirit", tag: "Defensive", casts: [], cooldownSeconds: 180, neverUsed: true, availableWindows: [] }] as never;
  it("below 2100 → the header says so; above → rating only; unknown → nothing", () => {
    expect(formatSpecBaselines("Holy Priest", cds, data, 1650)[0]).toContain(
      "your personal rating in this bracket is 1650, below the reference bracket",
    );
    expect(formatSpecBaselines("Holy Priest", cds, data, 2350)[0]).toMatch(/your personal rating in this bracket is 2350:$/);
    expect(formatSpecBaselines("Holy Priest", cds, data, 0)[0]).toMatch(/\(n=10\):$/);
    // triage other F-O2: the number is COMBATANT_INFO personalRating — the
    // lobby MMR is a different number and the header must not call it that.
    for (const rating of [1650, 2350, 0])
      expect(formatSpecBaselines("Holy Priest", cds, data, rating).join("\n")).not.toMatch(/MMR/);
    expect(formatDTPSBaselines(["Holy Priest"], { bySpec: { "Holy Priest": { ...data.bySpec["Holy Priest"], pressureWindows: { p50: 1, p75: 2, p90: 3, p95: 4 } } } })[0]).toBe(
      `INCOMING DAMAGE BASELINES (per 10s window, ≥${BASELINE_RATING_FLOOR} personal rating):`,
    );
  });
});

describe("hardCastOccupancyWithin — instants and unbounded successes", () => {
  function caster(starts: { spellId: string; ms: number }[], successes: { spellId: string; ms: number }[]) {
    const u = makeUnit("player-1", {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: successes.map((s) => makeSpellCastEvent(s.spellId, s.ms, "player-1")),
    }) as ICombatUnit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (u as any).castStartEvents = starts.map((s) => ({ spellId: s.spellId, timestamp: s.ms, spellName: s.spellId }));
    return u;
  }
  it("a CAST_SUCCESS at the bar's own ms is an instant — zero occupancy, not 'until the next bar'", () => {
    const u = caster([{ spellId: "585", ms: T0 + 1_000 }, { spellId: "585", ms: T0 + 9_000 }], [{ spellId: "585", ms: T0 + 1_000 }]);
    const occ = hardCastOccupancyWithin(u, new Set(), T0, T0 + 10_000);
    expect(occ?.occupiedMs).toBe(0);
  });
  it("a bar with no success inside 12 s is not paired with the same spell a minute later", () => {
    const u = caster([{ spellId: "585", ms: T0 + 1_000 }], [{ spellId: "585", ms: T0 + 61_000 }]);
    const occ = hardCastOccupancyWithin(u, new Set(), T0, T0 + 30_000);
    expect(occ?.occupiedMs).toBe(0);
  });
  it("consecutive bars pair with their own successes — bar 2 is not an instant because bar 1 succeeded at its start ms (codex)", () => {
    const u = caster(
      [{ spellId: "585", ms: T0 + 1_000 }, { spellId: "585", ms: T0 + 3_000 }, { spellId: "585", ms: T0 + 5_000 }],
      [{ spellId: "585", ms: T0 + 3_000 }, { spellId: "585", ms: T0 + 5_000 }, { spellId: "585", ms: T0 + 7_000 }],
    );
    expect(hardCastOccupancyWithin(u, new Set(), T0 + 3_000, T0 + 5_000)?.occupiedMs).toBe(2_000);
  });
  it("an abandoned bar whose only end is the next start a minute later is dropped (codex)", () => {
    const u = caster(
      [{ spellId: "585", ms: T0 + 1_000 }, { spellId: "585", ms: T0 + 59_000 }],
      [{ spellId: "585", ms: T0 + 61_000 }],
    );
    expect(hardCastOccupancyWithin(u, new Set(), T0, T0 + 30_000)?.occupiedMs).toBe(0);
  });
  it("a cancelled bar does not consume the next bar's success (codex): fail 1.5 s, restart 3 s, succeed 5 s", () => {
    const u = caster(
      [{ spellId: "585", ms: T0 + 1_000 }, { spellId: "585", ms: T0 + 3_000 }],
      [{ spellId: "585", ms: T0 + 5_000 }],
    );
    const occ = hardCastOccupancyWithin(u, new Set(), T0 + 3_000, T0 + 5_000, [{ spellId: "585", ms: T0 + 1_500 }]);
    expect(occ?.occupiedMs).toBe(2_000);
  });
  it("consumption is by event, not by ms (codex): A succeeds at 3 s, B is an instant at 3 s", () => {
    const u = caster(
      [{ spellId: "585", ms: T0 + 1_000 }, { spellId: "17", ms: T0 + 3_000 }, { spellId: "585", ms: T0 + 5_000 }],
      [{ spellId: "585", ms: T0 + 3_000 }, { spellId: "17", ms: T0 + 3_000 }, { spellId: "585", ms: T0 + 7_000 }],
    );
    expect(hardCastOccupancyWithin(u, new Set(), T0 + 3_000, T0 + 5_000)?.occupiedMs).toBe(0);
  });
  it("a normal 2 s bar still counts", () => {
    const u = caster([{ spellId: "585", ms: T0 + 1_000 }], [{ spellId: "585", ms: T0 + 3_000 }]);
    const occ = hardCastOccupancyWithin(u, new Set(), T0, T0 + 10_000);
    expect(occ?.occupiedMs).toBe(2_000);
  });
});
