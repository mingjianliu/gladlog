/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitReaction, CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  eligibleExternalMitigation,
  EXTERNAL_DAMAGE_PRE_HIT_S,
  externalDamageForApplication,
  externalDamageObservations,
  formatDuringExternal,
  formatDuringExternalForOwner,
} from "../src/utils/externalDamage";
import { makeUnit } from "./ported/testHelpers";

// GH #91 — the pre-registered measurement contract, pinned on synthetic
// events so the timeline annotation, the candidate fact and the gate all
// rest on one arithmetic.
const START = 1_000_000;
const ms = (s: number) => START + s * 1000;
const combat = { startTime: START, endTime: ms(120) };
const PAIN_SUPPRESSION = "33206";
const GUARDIAN_SPIRIT = "47788";

function dmg(ev: LogEvent, atS: number, dest: string, amount: number): any {
  return {
    spellId: "1",
    spellName: "x",
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    amount: -amount,
    effectiveAmount: -amount,
    logLine: { event: ev, timestamp: ms(atS), parameters: [] },
  };
}
function aura(spellId: string, name: string, src: string, dest: string, atS: number, event: LogEvent): any {
  return {
    spellId,
    spellName: name,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    logLine: { event, timestamp: ms(atS), parameters: [] },
    auraType: "BUFF",
  };
}
const enemy = (id: string, auraEvents: any[] = []) =>
  makeUnit(id, { spec: CombatUnitSpec.Hunter_Marksmanship, reaction: CombatUnitReaction.Hostile, auraEvents });
const ally = (id: string, damageOut: any[]) =>
  makeUnit(id, { spec: CombatUnitSpec.Warrior_Arms, damageOut });

const psOn = (dest: string, src = "E2", from = 20, to = 28) => [
  aura(PAIN_SUPPRESSION, "Pain Suppression", src, dest, from, LogEvent.SPELL_AURA_APPLIED),
  aura(PAIN_SUPPRESSION, "Pain Suppression", src, dest, to, LogEvent.SPELL_AURA_REMOVED),
];

describe("externalDamage — damage kept on a target under an ally-applied external (GH #91)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("eligibility follows the round-2 contract: % mitigation (any school), immunities, Life Cocoon; transfers and positional walls stay out", () => {
    expect(eligibleExternalMitigation(PAIN_SUPPRESSION)).toEqual({ pct: 40, schoolMask: 0x7f, kind: "mitigation" });
    expect(eligibleExternalMitigation("51052")).toEqual({ pct: 30, schoolMask: 0x7e, kind: "mitigation" }); // Anti-Magic Zone
    expect(eligibleExternalMitigation("1022")).toEqual({ pct: 100, schoolMask: 0x1, kind: "immunity" }); // Blessing of Protection
    expect(eligibleExternalMitigation("116849")).toEqual({ pct: 0, schoolMask: 0x7f, kind: "shield" }); // Life Cocoon
    expect(eligibleExternalMitigation(GUARDIAN_SPIRIT)).toBeNull(); // NO_MITIGATION_IDS
    expect(eligibleExternalMitigation("6940")).toBeNull(); // Blessing of Sacrifice
    expect(eligibleExternalMitigation("196718")).toBeNull(); // Darkness: positional
    expect(eligibleExternalMitigation("0")).toBeNull();
  });

  it("round 2: immune hits on the target count as seconds and render; a school-limited wall reports the in-school share", () => {
    const BOP = "1022";
    const bop = enemy("E1", [
      aura(BOP, "Blessing of Protection", "E2", "E1", 20, LogEvent.SPELL_AURA_APPLIED),
      aura(BOP, "Blessing of Protection", "E2", "E1", 28, LogEvent.SPELL_AURA_REMOVED),
    ]);
    const miss = (atS: number): any => ({
      spellId: "1", spellName: "x", destUnitId: "E1", destUnitName: "E1", missType: "IMMUNE", amount: 0,
      timestamp: ms(atS), logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms(atS), parameters: [] },
    });
    const warrior = { ...ally("A1", [dmg(LogEvent.SWING_DAMAGE, 19, "E1", 40_000), dmg(LogEvent.SPELL_DAMAGE, 25, "E3", 20_000)]), missesOut: [miss(21), miss(22.5), miss(26)] };
    const [o] = externalDamageObservations(bop, [warrior], [bop, enemy("E3")], combat);
    expect(o).toMatchObject({ wallKind: "immunity", immuneHits: 3, K: 3, nDirect: 0, dAll: 20_000, M: 8, kind: "stops" });
    expect(formatDuringExternal(o!, (n) => n)).toBe(
      "A1 0k on target · 0% of their enemy-player damage · direct 0k / periodic 0k · 3 hits immune · damage in 3 of 8 s · longest gap 3 s",
    );
    const AMZ = "51052";
    const amz = enemy("E1", [
      aura(AMZ, "Anti-Magic Zone", "E2", "E1", 20, LogEvent.SPELL_AURA_APPLIED),
      aura(AMZ, "Anti-Magic Zone", "E2", "E1", 28, LogEvent.SPELL_AURA_REMOVED),
    ]);
    const mixed = ally("A1", [
      dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000),
      { ...dmg(LogEvent.SPELL_DAMAGE, 21, "E1", 30_000), spellSchoolId: "0x20" }, // shadow
      { ...dmg(LogEvent.SWING_DAMAGE, 22, "E1", 10_000), spellSchoolId: "0x1" }, // physical
    ]);
    const [o2] = externalDamageObservations(amz, [mixed], [amz], combat);
    expect(o2).toMatchObject({ wallKind: "mitigation", wallSchoolMask: 0x7e, inSchool: 30_000, nDirect: 40_000 });
    expect(formatDuringExternal(o2!, (n) => n)).toBe(
      "A1 40k on target · 100% of their enemy-player damage · direct 40k / periodic 0k · 30k (75%) of it in the wall's school · damage in 2 of 8 s · longest gap 5 s",
    );
  });

  it("computes N / D / X / K / M / G on the render grid for a qualifying ally", () => {
    const e1 = enemy("E1", psOn("E1"));
    const e3 = enemy("E3");
    const a1 = ally("A1", [
      dmg(LogEvent.SPELL_DAMAGE, 18.5, "E1", 50_000), // pre-hit inside PRE_HIT_S
      dmg(LogEvent.SPELL_DAMAGE, 21.2, "E1", 30_000),
      dmg(LogEvent.SWING_DAMAGE, 22.1, "E1", 30_000),
      dmg(LogEvent.SPELL_DAMAGE, 23.7, "E1", 30_000),
      dmg(LogEvent.SPELL_PERIODIC_DAMAGE, 25.0, "E1", 10_000),
      dmg(LogEvent.SPELL_DAMAGE, 26.4, "E3", 20_000), // other enemy: counts in D only
      dmg(LogEvent.SPELL_DAMAGE, 29.0, "E1", 99_000), // after removal: ignored
    ]);
    const [o] = externalDamageObservations(e1, [a1], [e1, e3], combat);
    expect(o).toMatchObject({
      allyName: "A1",
      targetName: "E1",
      mitName: "Pain Suppression",
      mitPct: 40,
      srcName: "E2",
      wFrom: 20,
      wTo: 28,
      M: 8,
      K: 4,
      G: 2,
      nDirect: 90_000,
      nPeriodic: 10_000,
      dAll: 120_000,
      preDirect: 50_000,
      kind: "continues",
    });
    expect(o!.X).toBeCloseTo(83.33, 1);
    expect(formatDuringExternal(o!, (n) => `1(${n})`)).toBe(
      "1(A1) 100k on target · 83% of their enemy-player damage · direct 90k / periodic 10k · damage in 4 of 8 s · longest gap 2 s",
    );
    expect(formatDuringExternalForOwner(o!)).toBe(
      "100k on target · 83% of your enemy-player damage · direct 90k / periodic 10k · damage in 4 of 8 s",
    );
  });

  it("an ally without a direct hit in the PRE_HIT_S before the application does not qualify", () => {
    const e1 = enemy("E1", psOn("E1"));
    const late = ally("A2", [
      dmg(LogEvent.SPELL_DAMAGE, 20 - EXTERNAL_DAMAGE_PRE_HIT_S - 0.5, "E1", 50_000),
      dmg(LogEvent.SPELL_DAMAGE, 22, "E1", 30_000),
    ]);
    const dotOnly = ally("A3", [
      dmg(LogEvent.SPELL_PERIODIC_DAMAGE, 19, "E1", 50_000), // periodic pre-hit does not qualify
      dmg(LogEvent.SPELL_DAMAGE, 22, "E1", 30_000),
    ]);
    expect(externalDamageObservations(e1, [late, dotOnly], [e1], combat)).toEqual([]);
  });

  it("a qualifying ally with no damage on anyone in the window is the 'empty' shape", () => {
    const e1 = enemy("E1", psOn("E1"));
    const a1 = ally("A1", [dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000)]);
    const [o] = externalDamageObservations(e1, [a1], [e1], combat);
    expect(o).toMatchObject({ kind: "empty", dAll: 0, X: null, K: 0, M: 8, G: 8 });
    expect(formatDuringExternal(o!, (n) => n)).toBe("A1 0k on target · no damage on any enemy player · 0 of 8 s");
  });

  it("absorbed hits are reported separately and count as seconds with damage; N / D / X unchanged", () => {
    // Victim-keyed absorbs on the TARGET: attackerId names the ally.
    const absorbedRow = (atS: number, amt: number, attacker: string): any => ({
      spellId: "17",
      spellName: "Power Word: Shield",
      srcUnitId: "E2",
      srcUnitName: "E2",
      destUnitId: "E1",
      destUnitName: "E1",
      attackerId: attacker,
      absorbedAmount: amt,
      timestamp: ms(atS),
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: ms(atS), parameters: [] },
    });
    const e1 = makeUnit("E1", {
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: psOn("E1"),
      absorbsIn: [absorbedRow(21.0, 30_000, "A1"), absorbedRow(23.5, 25_000, "A1"), absorbedRow(22.0, 9_000, "A9")],
    });
    const a1 = ally("A1", [
      dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000),
      dmg(LogEvent.SPELL_DAMAGE, 21, "E1", 1), // a fully absorbed hit leaves an effective −1
      dmg(LogEvent.SPELL_DAMAGE, 25, "E3", 20_000),
    ]);
    const [o] = externalDamageObservations(e1, [a1], [e1, enemy("E3")], combat);
    // The effective −1 residual at 21 s does not make a bin by itself (EXTERNAL_DAMAGE_BIN_MIN_HIT);
    // the two absorbed hits do → K = 2.
    expect(o).toMatchObject({ nDirect: 1, nPeriodic: 0, dAll: 20_001, absorbed: 55_000, K: 2, M: 8, kind: "stops" });
    expect(formatDuringExternal(o!, (n) => n)).toBe(
      "A1 0k on target (+55k absorbed) · 0% of their enemy-player damage · direct 0k / periodic 0k · damage in 2 of 8 s · longest gap 4 s",
    );
  });

  it("self-applied, inferred-endpoint and ineligible auras yield nothing", () => {
    const a1 = ally("A1", [dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000), dmg(LogEvent.SPELL_DAMAGE, 22, "E1", 30_000)]);
    const selfApplied = enemy("E1", psOn("E1", "E1"));
    expect(externalDamageObservations(selfApplied, [a1], [selfApplied], combat)).toEqual([]);
    const gs = enemy("E1", [
      aura(GUARDIAN_SPIRIT, "Guardian Spirit", "E2", "E1", 20, LogEvent.SPELL_AURA_APPLIED),
      aura(GUARDIAN_SPIRIT, "Guardian Spirit", "E2", "E1", 28, LogEvent.SPELL_AURA_REMOVED),
    ]);
    expect(externalDamageObservations(gs, [a1], [gs], combat)).toEqual([]);
    const iv = { spellId: PAIN_SUPPRESSION, spellName: "Pain Suppression", srcUnitName: "E2", fromS: 20, toS: 28, inferredStart: false, inferredEnd: true };
    expect(externalDamageForApplication(iv, enemy("E1"), [a1], [enemy("E1")], combat)).toEqual([]);
  });

  it("the window is truncated at the target's death and the ally's own death", () => {
    const a1 = ally("A1", [dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000), dmg(LogEvent.SPELL_DAMAGE, 22, "E1", 30_000)]);
    const e1 = makeUnit("E1", {
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: psOn("E1"),
      deathRecords: [{ timestamp: ms(24.6) }],
    });
    const [o] = externalDamageObservations(e1, [a1], [e1], combat);
    expect(o).toMatchObject({ wFrom: 20, wTo: 24, M: 4 });
    const dead = makeUnit("A1", { spec: CombatUnitSpec.Warrior_Arms, damageOut: a1.damageOut, deathRecords: [{ timestamp: ms(23.2) }] });
    const [o2] = externalDamageObservations(enemy("E1", psOn("E1")), [dead], [enemy("E1")], combat);
    expect(o2).toMatchObject({ wFrom: 20, wTo: 23, M: 3 });
  });
});
