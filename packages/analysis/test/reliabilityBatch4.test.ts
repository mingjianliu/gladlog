/**
 * Reliability leftovers batch 4 (2026-09-26): spec-passive range modifiers
 * apply by spec; Cauterizing Flame is not a save cooldown (user ruling).
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import roster from "../src/data/healerSaveCdGenerated.json";
import { spellRangeForCaster, spellReachToAccuse } from "../src/utils/spellRange";

beforeAll(async () => {
  await ensureAnalysisData();
});

const caster = (spec: CombatUnitSpec) =>
  ({ spec, info: undefined, spellCastEvents: [] }) as never;

describe("spec-passive range modifiers apply by spec (GH #120 §1)", () => {
  it("Preservation's +5 reaches Living Flame / Verdant Embrace; Holy Paladin's +10 reaches Divine Toll; other specs unchanged", () => {
    expect(spellRangeForCaster(caster(CombatUnitSpec.Evoker_Preservation), "361469")).toBe(30);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Evoker_Preservation), "360995")).toBe(30);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Evoker_Devastation), "361469")).toBe(25);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Paladin_Holy), "375576")).toBe(40);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Paladin_Retribution), "375576")).toBe(30);
  });
  it("a spec passive is never 'unknown ownership' for the accusation reach", () => {
    expect(spellReachToAccuse(caster(CombatUnitSpec.Evoker_Preservation), "361469")).not.toBeNull();
  });
});

describe("Cauterizing Flame 374251 is out of the save roster (user ruling 2026-09-26)", () => {
  it("no spec lists it as a save; Preservation's rejectedForReview carries the ruling", () => {
    const specs = (roster as { specs: Record<string, { spells: { spellId: string }[] }> }).specs;
    for (const [spec, s] of Object.entries(specs))
      expect(s.spells.some((x) => x.spellId === "374251"), spec).toBe(false);
    const rej = (roster as { rejectedForReview: Record<string, { spellId: string; reason: string }[]> }).rejectedForReview["Preservation Evoker"];
    expect(rej.find((r) => r.spellId === "374251")?.reason).toContain("not_save_role, 2026-09-26");
  });
});

import { externalUnusedEvents, ZONE_EXTERNAL_RADIUS_YD } from "../src/analysis/candidates/death";

describe("external-unused needs the external to reach the victim (round 3 W1f, 4446)", () => {
  const base = {
    deathT: 91,
    victim: { id: "h", name: "Hunter" },
    owner: { id: "d", name: "DemonHunter" },
    ownerExternals: [{ spellId: "196718", spellName: "Darkness", cooldownSeconds: 300, casts: [], neverUsed: true }],
    ownerCC: [],
    ownerAliveAt: () => true,
  };
  it("Darkness is a caster-centred 8 yd zone (tooltip), registered", () => {
    expect(ZONE_EXTERNAL_RADIUS_YD["196718"]).toBe(8);
  });
  it("unreachable → no accusation; reachable or unknown → as before", () => {
    expect(externalUnusedEvents({ ...base, canReachVictim: () => false })).toEqual([]);
    expect(externalUnusedEvents({ ...base, canReachVictim: () => true })).toHaveLength(1);
    expect(externalUnusedEvents(base)).toHaveLength(1);
  });
});

import { getTopDamageSourcesInWindow, playerKillingBlow } from "../src/context/timelineHelpers";
import { formatMitigationAuditLine } from "../src/context/matchTimelineSections";
import { CombatUnitReaction, LogEvent as LE } from "@gladlog/parser-compat";

describe("death block (round 3 N13)", () => {
  const dmg = (ms: number, src: string, srcName: string, spellId: string, spellName: string, eff: number, overkill?: number) => ({
    logLine: { event: LE.SPELL_DAMAGE, timestamp: ms, parameters: [] },
    timestamp: ms, srcUnitId: src, srcUnitName: srcName, srcUnitFlags: src === "v" ? 0x511 : 0x548,
    destUnitId: "v", destUnitName: "Victim", destUnitFlags: 0x511,
    spellId, spellName, amount: eff, effectiveAmount: eff, ...(overkill ? { overkill } : {}),
  });
  const victim = {
    id: "v", name: "Victim", reaction: CombatUnitReaction.Friendly,
    damageIn: [
      dmg(1_000, "m", "Mage", "2948", "Scorch", 93_000),
      dmg(2_500, "v", "Victim", "361029", "Time Dilation", 40_000),
      dmg(2_900, "d", "DK", "343294", "Soul Reaper", 17_000, 5_000),
    ],
  } as never;
  it("the killing blow is the overkill hit, not the largest source", () => {
    expect((playerKillingBlow(victim, 3_000) as { spellId: string }).spellId).toBe("343294");
  });
  it("the unit's own deferred damage (Time Dilation) is counted and labelled", () => {
    const top = getTopDamageSourcesInWindow(victim, 3_000, 10_000, 3);
    expect(top.some((t) => t.startsWith("deferred Time Dilation (own)"))).toBe(true);
  });
  it("a school-limited immunity reports all damage taken and the off-school part", () => {
    const line = formatMitigationAuditLine({
      spellId: "1022", spellName: "Blessing of Protection", kind: "immunity", activeOverlapS: 1.6,
      damageTakenDuringImmunity: 115_220, damageOutsideImmunitySchool: 115_220,
    });
    expect(line).toContain("still took ~115k during it");
    expect(line).toContain("~115k of it outside the immunity's school");
  });
});

import { isTeamSaveCD } from "../src/utils/cooldowns";

describe("team saves answer cd-hoarded (codex review of a75d53a2)", () => {
  it("the group walls the ruling named are team saves, as are the team heals", () => {
    for (const id of ["98008", "62618", "31821", "51052", "97462", "196718", "374227", "64843", "115310"])
      expect(isTeamSaveCD(id), id).toBe(true);
    expect(isTeamSaveCD("33206")).toBe(false); // Pain Suppression is single-target
  });
});
