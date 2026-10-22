import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "../src/utils/castRowLag";
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

  it("fact2: a HoT's first tick right after its own fresh APPLIED is the press's heal (0457a45e Frenzied Regeneration)", () => {
    const FR = "22842";
    const tick = { ...heal(FR, "P", 49.805), logLine: { timestamp: T0 + 49_805, parameters: [], event: LogEvent.SPELL_PERIODIC_HEAL } };
    const applied = { spellId: FR, srcUnitId: "P", logLine: { timestamp: T0 + 49_804, event: LogEvent.SPELL_AURA_APPLIED } };
    const mk = (withApplied: boolean) => ({
      ...unit([sample("P", 49.7, 587), sample("P", 49.805, 620)], [tick]),
      auraEvents: (withApplied ? [applied] : []) as never,
    });
    expect(hpAtPress(mk(true), T0 + 49_806, { spellId: FR, srcUnitId: "P" })).toBe(59);
    // control: a tick of an earlier application is not this press
    expect(hpAtPress(mk(false), T0 + 49_806, { spellId: FR, srcUnitId: "P" })).toBe(62);
  });

  it("fact2-retest idx 6: the first tick rides its aura up to the aura-before-cast lag ahead of the cast row (Frenzied Regeneration 55 ms)", () => {
    const FR = "22842";
    const at = (ms: number, event: LogEvent) => ({ timestamp: T0 + ms, parameters: [], event });
    const tick = { ...heal(FR, "P", 31.49), logLine: at(31_490, LogEvent.SPELL_PERIODIC_HEAL) };
    const applied = { spellId: FR, srcUnitId: "P", logLine: at(31_490, LogEvent.SPELL_AURA_APPLIED) };
    const u = {
      ...unit([sample("P", 31.3, 337), sample("P", 31.49, 424)], [tick]),
      auraEvents: [applied] as never,
    };
    const fr = { spellId: FR, srcUnitId: "P" };
    // cast row 55 ms after the tick: the press read before its own heal
    expect(hpAtPress(u, T0 + 31_545, fr)).toBe(34);
    // past the lag the tick is no longer this press's
    expect(hpAtPress(u, T0 + 31_490 + AURA_BEFORE_CAST_ROW_MAX_MS + 1, fr)).toBe(42);
  });

  it("fact2: a second charge refreshes the HoT — the REFRESH and its tick in the press's lead are the press's (7-2 1:56)", () => {
    const FR = "22842";
    const u = {
      ...unit(
        [sample("P", 57.5, 204), sample("P", 57.644, 243)],
        [{ ...heal(FR, "P", 57.644), logLine: { timestamp: T0 + 57_644, parameters: [], event: LogEvent.SPELL_PERIODIC_HEAL } }],
      ),
      auraEvents: [{ spellId: FR, srcUnitId: "P", logLine: { timestamp: T0 + 57_644, event: LogEvent.SPELL_AURA_REFRESH } }] as never,
    };
    expect(hpAtPress(u, T0 + 57_647, { spellId: FR, srcUnitId: "P" })).toBe(20);
  });

  it("fact2: a direct heal of the press's own name (Holy Prism 114165 heals as 114871)", () => {
    const u = unit([sample("P", 21.9, 731), sample("P", 22.0, 800)], [heal("114871", "P", 22.0)]);
    expect(hpAtPress(u, T0 + 22_001, { spellId: "114165", srcUnitId: "P" })).toBe(73);
  });

  it("fact2 C10: the press's heal under its effect id (Dream Breath 355936 heals as 355941)", () => {
    const u = unit([sample("P", 10.9, 860), sample("P", 11.0, 910)], [heal("355941", "P", 11.0)]);
    expect(hpAtPress(u, T0 + 11_001, { spellId: "355936", srcUnitId: "P" })).toBe(86);
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
