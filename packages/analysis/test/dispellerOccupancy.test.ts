/**
 * Triage 2026-09-29 missed-cleanse F-C11 (ruling A43 = B): one occupancy
 * predicate — hard casts ∪ a channel shown only as a self-aura (Ultimate
 * Penitence 421453) ∪ drinking (1291791) — for the owner and the teammate
 * dispellers; with ownerCanDispel=no the least-occupied eligible dispeller
 * is rendered.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { missedCleanseEvents } from "../src/analysis/candidateFindings";
import { ensureAnalysisData } from "../src/data/ensure";
import { occupancyWithin } from "../src/utils/dispelAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const aura = (id: string, spellId: string, name: string, event: string, s: number) => ({
  spellId,
  spellName: name,
  srcUnitId: id,
  destUnitId: id,
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const unit = (id: string, spec: CombatUnitSpec, cls: CombatUnitClass, auras: unknown[] = []): any => ({
  id,
  name: `${id}-R-US`,
  spec,
  class: cls,
  reaction: CombatUnitReaction.Friendly,
  info: { specId: spec },
  castStartEvents: [],
  spellCastEvents: [],
  auraEvents: auras,
  deathRecords: [],
});

describe("occupancyWithin", () => {
  it("ae9d6fbc 313: the Ultimate Penitence self-aura 310.254–316.763 covers 3.0 s of the 313.145–316.151 Coil, pre-committed", () => {
    const p = unit("P", CombatUnitSpec.Priest_Discipline, CombatUnitClass.Priest, [
      aura("P", "421453", "终极苦修", LogEvent.SPELL_AURA_APPLIED, 310.254),
      aura("P", "421453", "终极苦修", LogEvent.SPELL_AURA_REMOVED, 316.763),
    ]);
    const o = occupancyWithin(p, new Set(), T0 + 313_145, T0 + 316_151)!;
    expect((o.occupiedMs / 1000).toFixed(1)).toBe("3.0");
    expect(o.spellNames).toEqual(["Ultimate Penitence"]);
    expect(o.startedBeforeWindow).toBe(true);
    expect(o.kinds).toEqual(["proxy"]);
  });
  it("ae9d6fbc 163: Drink 164.169–168.668 covers 1.9 s of 163.036–166.045, not pre-committed", () => {
    const p = unit("P", CombatUnitSpec.Priest_Discipline, CombatUnitClass.Priest, [
      aura("P", "1291791", "饮水", LogEvent.SPELL_AURA_APPLIED, 164.169),
      aura("P", "1291791", "饮水", LogEvent.SPELL_AURA_REMOVED, 168.668),
    ]);
    const o = occupancyWithin(p, new Set(), T0 + 163_036, T0 + 166_045)!;
    expect((o.occupiedMs / 1000).toFixed(1)).toBe("1.9");
    expect(o.spellNames).toEqual(["Drink"]);
    expect(o.startedBeforeWindow).toBe(false);
  });
});

describe("missedCleanseEvents — dispellerCasting* (least-occupied eligible dispeller)", () => {
  it("two eligible dispellers: the free one wins → no fact; both busy → the lesser", () => {
    const owner = unit("O", CombatUnitSpec.Warrior_Arms, CombatUnitClass.Warrior);
    const drinker = unit("D", CombatUnitSpec.Priest_Discipline, CombatUnitClass.Priest, [
      aura("D", "1291791", "Drink", LogEvent.SPELL_AURA_APPLIED, 9),
      aura("D", "1291791", "Drink", LogEvent.SPELL_AURA_REMOVED, 20),
    ]);
    const free = unit("F", CombatUnitSpec.Paladin_Holy, CombatUnitClass.Paladin);
    const w = {
      timeSeconds: 10,
      durationSeconds: 4,
      targetName: "O-R-US",
      spellName: "Polymorph",
      spellId: "118",
      priority: "Critical",
      postCcDamage: 10_000,
      cleanseWasOnCD: false,
      dispellersLockedOut: false,
      losReachable: true,
      drChainRisk: false,
      dispelType: "Magic",
    } as any;
    const occ = { enemyIds: new Set<string>(), matchStartMs: T0 };
    const run = (friends: any[]) =>
      missedCleanseEvents([w], owner, friends, false, occ)[0]!.facts;
    expect(run([owner, drinker, free]).dispellerCastingS).toBeUndefined();
    const busyToo = unit("F", CombatUnitSpec.Paladin_Holy, CombatUnitClass.Paladin, [
      aura("F", "1291791", "Drink", LogEvent.SPELL_AURA_APPLIED, 12),
      aura("F", "1291791", "Drink", LogEvent.SPELL_AURA_REMOVED, 30),
    ]);
    const f = run([owner, drinker, busyToo]);
    expect(f.ownerCanDispel).toBe("no");
    expect(f.dispellerCastingS).toBe("2.0");
    expect(f.dispellerCastingPreCommitted).toBe("no");
  });
});
