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

import { creditedAnswer } from "../src/context/burstAnswered";

describe("[BURST ANSWERED] credits an answer that reached the pressured unit through its trough (round 3 4446 / 6954)", () => {
  const base = {
    pressured: { unitId: "p", name: "Pressured", minHpPct: 20, minHpSec: 30, startHpPct: 90, startHpSec: 20, died: false },
    responseCasts: [] as unknown[],
  };
  const gs = (over: Record<string, unknown>) => ({ category: "external", spellId: "47788", spellName: "Guardian Spirit", casterName: "Priest", tSec: 22, latencySec: 2, casterId: "h", ...over });
  it("an external on ANOTHER unit is not the answer", () => {
    expect(creditedAnswer({ ...base, responseCasts: [gs({ destId: "other", effectEndSec: 34 })] } as never)).toBeUndefined();
  });
  it("an external that expired before the trough is not the answer", () => {
    expect(creditedAnswer({ ...base, responseCasts: [gs({ destId: "p", effectEndSec: 29 })] } as never)).toBeUndefined();
  });
  it("an external on the pressured unit, still up at the trough, is", () => {
    expect(creditedAnswer({ ...base, responseCasts: [gs({ destId: "p", effectEndSec: 34 })] } as never)).toBeDefined();
  });
});

import { AURA_REBROADCAST_GAP_MS, buildAuraIntervals, dropAuraRebroadcasts } from "../src/utils/auraIntervals";

describe("aura re-broadcasts are one aura (rounds 2–3 W2e / N6)", () => {
  const ev = (event: string, spellId: string, ts: number, src = "s", dest = "d") =>
    ({ logLine: { event, timestamp: ts, parameters: [] }, timestamp: ts, spellId, spellName: spellId, srcUnitId: src, srcUnitName: src, destUnitId: dest, destUnitName: dest }) as never;
  it("a same-ms REMOVED → APPLIED pair is dropped; a real removal stays", () => {
    const evs = [
      ev("SPELL_AURA_APPLIED", "363916", 1_000),
      ev("SPELL_AURA_REMOVED", "363916", 5_000),
      ev("SPELL_AURA_APPLIED", "363916", 5_000),
      ev("SPELL_AURA_REMOVED", "363916", 9_000),
    ];
    const out = dropAuraRebroadcasts(evs);
    expect(out).toHaveLength(2);
  });
  it("FT-T08:REMOVED → APPLIED 隔 1 ms(跨毫秒边界的同一次重播)也是同一个光环;隔 2 ms 不是", () => {
    // f4da82c5: one Sleep Walk cast, REMOVED 10.1853 / APPLIED 10.1863.
    const oneMs = [
      ev("SPELL_AURA_APPLIED", "360806", 9_964),
      ev("SPELL_AURA_REMOVED", "360806", 10_185),
      ev("SPELL_AURA_APPLIED", "360806", 10_186),
      ev("SPELL_AURA_REMOVED", "360806", 10_571),
    ];
    expect(dropAuraRebroadcasts(oneMs).map((e: any) => e.timestamp)).toEqual([9_964, 10_571]);
    const unit = { id: "d", auraEvents: oneMs } as never;
    const iv = buildAuraIntervals(unit, { startTime: 0, endTime: 60_000 }).filter((i) => i.spellId === "360806");
    expect(iv.map((i) => [i.fromS, i.toS])).toEqual([[9.964, 10.571]]);

    const twoMs = [
      ev("SPELL_AURA_APPLIED", "8680", 1_000),
      ev("SPELL_AURA_REMOVED", "8680", 5_000),
      ev("SPELL_AURA_APPLIED", "8680", 5_002),
      ev("SPELL_AURA_REMOVED", "8680", 9_000),
    ];
    expect(dropAuraRebroadcasts(twoMs)).toHaveLength(4);
    expect(AURA_REBROADCAST_GAP_MS).toBe(1);
  });
  it("FT-T08:更早的 REMOVED 不会和后来的 APPLIED 配成重播;APPLIED 在 REMOVED 之前 1 ms 也不是", () => {
    const stale = [
      ev("SPELL_AURA_APPLIED", "360806", 1_000),
      ev("SPELL_AURA_REMOVED", "360806", 2_000),
      ev("SPELL_AURA_APPLIED", "360806", 8_000),
      ev("SPELL_AURA_REMOVED", "360806", 9_000),
    ];
    expect(dropAuraRebroadcasts(stale)).toHaveLength(4);
    // log order REMOVED@5_001 then APPLIED@5_000 (a timestamp stepping back): not a re-broadcast
    const backwards = [
      ev("SPELL_AURA_APPLIED", "360806", 1_000),
      ev("SPELL_AURA_REMOVED", "360806", 5_001),
      ev("SPELL_AURA_APPLIED", "360806", 5_000),
    ];
    expect(dropAuraRebroadcasts(backwards)).toHaveLength(3);
  });
  it("a second APPLIED inside the duration with no recast (leaving stealth) keeps one interval", () => {
    const unit = {
      id: "d",
      auraEvents: [ev("SPELL_AURA_APPLIED", "102342", 10_000, "s", "d"), ev("SPELL_AURA_APPLIED", "102342", 14_000, "s", "d"), ev("SPELL_AURA_REMOVED", "102342", 22_000, "s", "d")],
    } as never;
    const caster = { spec: "105", info: undefined, spellCastEvents: [{ spellId: "102342", logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 10_000 } }] } as never;
    const iv = buildAuraIntervals(unit, { startTime: 0, endTime: 60_000 }, new Map([["s", caster]])).filter((i) => i.spellId === "102342");
    expect(iv).toHaveLength(1);
    expect(iv[0]!.fromS).toBe(10);
    expect(iv[0]!.toS).toBe(22);
  });
});
