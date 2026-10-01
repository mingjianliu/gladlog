import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  annotateDefensiveTimings,
  extractMajorCooldowns,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  hpAtPress,
  PRESS_EFFECT_LEAD_MS,
  PRESS_HP_LINE_TAGS,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

/**
 * Triage 2026-09-29, pair G7-P8 (hp-state F-R8 + enemy-def F-E11; user ruling
 * 2026-09-30, A21): HP on a press line is the HP at the press, just before
 * the press's own heal — the one signed exception to the whole-second grid.
 * The eval gate cannot re-derive it from text (the press ms is not rendered),
 * so this is the analysis-side guarantee.
 */

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const sample = (id: string, s: number, cur: number, max = 1000) => ({
  logLine: { timestamp: T0 + Math.round(s * 1000), parameters: [] },
  timestamp: T0 + Math.round(s * 1000),
  advancedActorId: id,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: max,
});
const heal = (spellId: string, srcUnitId: string, s: number) => ({
  spellId,
  srcUnitId,
  logLine: { timestamp: T0 + Math.round(s * 1000), parameters: [] },
});
/** `makeUnit` stamps every advanced action with the unit's id and has no
 * healIn override, so the two arrays are set on the built unit. */
const unit = (advancedActions: unknown[], healIn: unknown[] = []) => ({
  ...makeUnit("P"),
  advancedActions: advancedActions as never,
  healIn: healIn as never,
});
const LOH = "633";
const press = { spellId: LOH, srcUnitId: "P" };

describe("hpAtPress", () => {
  it("reads the last sample before the press's own heal, not the healed one (06bb9860 Lay on Hands)", () => {
    // SPELL_HEAL 18.487 (the healed sample, 89.2 %), SUCCESS 18.488; the last
    // sample before the effect is 18.464 = 32.2 %
    const u = unit(
      [
        sample("P", 18.464, 322),
        sample("P", 18.487, 892),
        sample("P", 18.6, 900),
      ],
      [heal(LOH, "P", 18.487)],
    );
    const pressMs = T0 + 18_488;
    expect(hpAtPress(u, pressMs, press)).toBe(32);
    // the nearest-sample reader the grid uses reads the press's own effect
    expect(getUnitHpAtTimestamp(u, pressMs)).toBe(89);
  });

  it("without an own heal: the last sample strictly before the press", () => {
    const u = unit([
      sample("P", 10.0, 500),
      sample("P", 10.9, 80),
      sample("P", 11.0, 700), // logged in the press millisecond
    ]);
    expect(hpAtPress(u, T0 + 11_000, press)).toBe(8);
  });

  it("another spell's heal, another caster's heal, or one outside the lead does not move the cut", () => {
    const base = [sample("P", 10.0, 500), sample("P", 10.97, 950)];
    const at = T0 + 11_000;
    const withHeal = (h: unknown) => hpAtPress(unit(base, [h]), at, press);
    expect(withHeal(heal("2061", "P", 10.97))).toBe(95);
    expect(withHeal(heal(LOH, "Q", 10.97))).toBe(95);
    expect(
      withHeal(heal(LOH, "P", 11 - PRESS_EFFECT_LEAD_MS / 1000 - 0.01)),
    ).toBe(95);
    // the press's own heal: the sample logged with it is skipped
    expect(withHeal(heal(LOH, "P", 10.97))).toBe(50);
  });

  it("a periodic tick of an earlier application of the same spell does not move the cut", () => {
    // a HoT tick 30 ms before a refresh raises 40 % → 60 %; the refresh's own
    // heal is not logged in the lead here, so the press reads the last sample
    const tick = {
      ...heal(LOH, "P", 9.97),
      logLine: {
        event: LogEvent.SPELL_PERIODIC_HEAL,
        timestamp: T0 + 9_970,
        parameters: [],
      },
    };
    const u = unit([sample("P", 9.0, 400), sample("P", 9.97, 600)], [tick]);
    expect(hpAtPress(u, T0 + 10_000, press)).toBe(60);
  });

  it("freshness is measured from the press, not from the heal cut", () => {
    // press 10.000, its heal 9.950, last pre-heal sample 6.975 = 3,025 ms
    // before the press — older than the radius
    const u = unit([sample("P", 6.975, 300)], [heal(LOH, "P", 9.95)]);
    expect(hpAtPress(u, T0 + 10_000, press)).toBeNull();
  });

  it("skips samples of other actors, clamps to 0–100, and is bounded by the HP sampling radius", () => {
    const u = unit([sample("P", 5.0, 1200), sample("other", 5.5, 10)]);
    expect(hpAtPress(u, T0 + 6_000, press)).toBe(100);
    expect(
      hpAtPress(u, T0 + 5_000 + HP_SAMPLE_RADIUS_MS + 600, press),
    ).toBeNull();
    expect(hpAtPress(unit([]), T0 + 6_000, press)).toBeNull();
  });
});

describe("PRESS_HP_LINE_TAGS", () => {
  it("is the one list of press-line tags the gate exempts", () => {
    expect([...PRESS_HP_LINE_TAGS]).toEqual([
      "[YOU] [CD]",
      "[YOU] [CC]",
      "[YOU] [PROC]",
      "[YOU] [CAST]",
      "[ENEMY DEF]",
      "[ENEMY TRINKET]",
    ]);
  });
});

// A21 extension (user ruling 2026-10-01, RULINGS P-R8b): the ledger's
// `cast.targetHpPct` — the [UNNECESSARY] threshold and the
// questionable-external facts read it — is the same press reading.
describe("cast.targetHpPct is the target's HP at the press (A21 extension)", () => {
  const PAIN_SUPPRESSION = "33206";
  const ledgerCast = (targetSamples: unknown[]) => {
    const target = {
      ...makeUnit("mate"),
      name: "Mate-R",
      advancedActions: targetSamples as never,
    };
    const priest = makeUnit("priest", {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [
        makeSpellCastEvent(
          PAIN_SUPPRESSION,
          T0 + 20_400,
          "mate",
          "Mate-R",
          "priest",
        ),
      ] as never,
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 120_000,
      units: { priest, mate: target },
    } as never;
    return extractMajorCooldowns(priest, combat).find(
      (c) => c.spellId === PAIN_SUPPRESSION,
    )!.casts[0]!;
  };

  it("a target dropping inside the second: the press reading, not the grid's", () => {
    // 20.0 s 92 % (what the 0:20 [STATE] tick prints), 20.35 s 61 % — the
    // last reading before the 20.4 s press
    const cast = ledgerCast([
      sample("mate", 19.9, 920),
      sample("mate", 20.0, 920),
      sample("mate", 20.35, 610),
      sample("mate", 20.8, 580),
    ]);
    expect(cast.targetHpPct).toBe(61);
  });

  it("no reading near the press → undefined (the readers print n/a and do not accuse)", () => {
    expect(ledgerCast([sample("mate", 5, 900)]).targetHpPct).toBeUndefined();
  });

  // the accusation layer reads that field: the [UNNECESSARY] tier flips with
  // the press reading, not with what the [STATE] tick of the second shows
  const timingOf = (targetSamples: unknown[]) => {
    const target = {
      ...makeUnit("mate"),
      name: "Mate-R",
      advancedActions: targetSamples as never,
    };
    const priest = makeUnit("priest", {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [
        makeSpellCastEvent(
          PAIN_SUPPRESSION,
          T0 + 20_400,
          "mate",
          "Mate-R",
          "priest",
        ),
      ] as never,
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 120_000,
      units: { priest, mate: target },
    } as never;
    const cds = annotateDefensiveTimings(
      extractMajorCooldowns(priest, combat),
      priest,
      combat,
      { players: [], alignedBurstWindows: [] } as never,
    );
    return cds.find((c) => c.spellId === PAIN_SUPPRESSION)!.casts[0]!;
  };

  it("grid 92 % but 78 % at the press → not [UNNECESSARY] (threshold 80)", () => {
    const cast = timingOf([
      sample("mate", 20.0, 920),
      sample("mate", 20.35, 780),
    ]);
    expect(cast.targetHpPct).toBe(78);
    expect(cast.timingLabel).not.toBe("Unnecessary");
  });

  it("92 % at the press and no pressure → [UNNECESSARY], and the note prints that number", () => {
    const cast = timingOf([
      sample("mate", 20.0, 950),
      sample("mate", 20.35, 920),
    ]);
    expect(cast.timingLabel).toBe("Unnecessary");
    expect(cast.timingContext).toContain("at 92% HP");
  });
});
