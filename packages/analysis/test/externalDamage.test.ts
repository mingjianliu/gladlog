/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitReaction, CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  DURING_NO_SHARE,
  eligibleExternalMitigation,
  EXTERNAL_DAMAGE_PRE_HIT_S,
  externalDamageForApplication,
  externalDamageObservations,
  formatDuringExternal,
  formatDuringExternalForOwner,
  isImmuneHitRow,
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
      spellId: "12294", spellName: "Mortal Strike", destUnitId: "E1", destUnitName: "E1", missType: "IMMUNE", amount: 0,
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

  it("fact7 D6 / D29: the share holds what shields ate, on the target and on any other enemy; a Fel Armor row nets out", () => {
    const shield = (atS: number, amount: number, spellId = "17"): any => ({
      attackerId: "A1",
      spellId,
      absorbedAmount: amount,
      timestamp: ms(atS),
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: ms(atS), parameters: [] },
    });
    const shielded = (id: string, rows: any[], over: any[] = psOn(id)) => ({
      ...enemy(id, over),
      absorbsIn: rows,
    });
    const preHit = dmg(LogEvent.SPELL_DAMAGE, 18.5, "E1", 50_000); // qualifies the ally
    const e1 = shielded("E1", [shield(21, 20_000)]);
    const e3 = shielded("E3", [shield(23, 30_000)], []);
    const a1 = ally("A1", [
      preHit,
      dmg(LogEvent.SPELL_DAMAGE, 21, "E1", 30_000),
      dmg(LogEvent.SPELL_DAMAGE, 22, "E3", 20_000),
    ]);
    const [o] = externalDamageObservations(e1, [a1], [e1, e3], combat);
    // 50k of 100k (30 + 20 on the target, 20 + 30 on the other enemy): landed
    // alone read 60 %
    expect(o).toMatchObject({ nDirect: 30_000, absorbed: 20_000, dAll: 100_000 });
    expect(o!.X).toBeCloseTo(50, 5);

    const e1Whole = shielded("E1", [shield(21, 70_000)]);
    const [whole] = externalDamageObservations(e1Whole, [ally("A1", [preHit])], [e1Whole], combat);
    expect(formatDuringExternal(whole!, (n) => n)).toContain(
      "0k on target (+70k absorbed) · 100% of their enemy-player damage",
    );

    const FEL_ARMOR = "386124";
    const e1Net = shielded("E1", [shield(21, 40_000, FEL_ARMOR), shield(21.5, -40_000, FEL_ARMOR)]);
    const [net] = externalDamageObservations(
      e1Net,
      [
        ally("A1", [
          preHit,
          dmg(LogEvent.SPELL_DAMAGE, 21, "E1", 10_000),
          dmg(LogEvent.SPELL_DAMAGE, 22, "E3", 10_000),
        ]),
      ],
      [e1Net, enemy("E3")],
      combat,
    );
    expect(net!.X).toBeCloseTo(50, 5);
  });

  it("fact9 D2: a hit logged in the removal's millisecond, before the REMOVED row, is under the aura", () => {
    const at = (row: any, lineIndex: number) => ({ ...row, logLine: { ...row.logLine, lineIndex } });
    const ps = [
      at(aura(PAIN_SUPPRESSION, "Pain Suppression", "E2", "E1", 20, LogEvent.SPELL_AURA_APPLIED), 10),
      at(aura(PAIN_SUPPRESSION, "Pain Suppression", "E2", "E1", 28, LogEvent.SPELL_AURA_REMOVED), 50),
    ];
    const rows = (tickIx: number) => [
      dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000),
      dmg(LogEvent.SPELL_DAMAGE, 21, "E1", 10_000),
      at(dmg(LogEvent.SPELL_PERIODIC_DAMAGE, 28, "E1", 9_000), tickIx),
    ];
    const [before] = externalDamageObservations(enemy("E1", ps), [ally("A1", rows(49))], [enemy("E1", ps)], combat);
    expect(before).toMatchObject({ nDirect: 10_000, nPeriodic: 9_000 });
    // …one logged after the REMOVED row is not
    const [after] = externalDamageObservations(enemy("E1", ps), [ally("A1", rows(51))], [enemy("E1", ps)], combat);
    expect(after).toMatchObject({ nDirect: 10_000, nPeriodic: 0 });
    // a window the combat's end closed first keeps none of the later
    // removal's millisecond (codex 20-F24-15 #2)
    const short = { ...combat, endTime: ms(25) };
    const [cut] = externalDamageObservations(enemy("E1", ps), [ally("A1", rows(49))], [enemy("E1", ps)], short);
    expect(cut).toMatchObject({ nDirect: 10_000, nPeriodic: 0 });
  });

  it("fact9 D15: a control the target refused is no immune hit (Binding Shot's stun into a wall)", () => {
    const BOP = "1022";
    const bop = enemy("E1", [
      aura(BOP, "Blessing of Protection", "E2", "E1", 20, LogEvent.SPELL_AURA_APPLIED),
      aura(BOP, "Blessing of Protection", "E2", "E1", 28, LogEvent.SPELL_AURA_REMOVED),
    ]);
    const miss = (spellId: string, atS: number): any => ({
      spellId, spellName: spellId, destUnitId: "E1", destUnitName: "E1", missType: "IMMUNE", amount: 0,
      timestamp: ms(atS), logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms(atS), parameters: [] },
    });
    const hunter = {
      ...ally("A1", [dmg(LogEvent.SWING_DAMAGE, 19, "E1", 40_000)]),
      // Binding Shot's stun 117526 and Shadowy Apparition's damage-less row
      // 341263: no hit; the apparition's hit 148859 is one
      missesOut: [miss("117526", 21), miss("341263", 22), miss("148859", 22.2)],
    };
    const [o] = externalDamageObservations(bop, [hunter], [bop], combat);
    expect(o!.immuneHits).toBe(1);
    expect(isImmuneHitRow(miss("117526", 21))).toBe(false);
    expect(isImmuneHitRow(miss("148859", 21))).toBe(true);
    expect(isImmuneHitRow({ ...miss("148859", 21), missType: "ABSORB" })).toBe(false);
    // a melee swing's SWING_MISSED row (spellId "0") is a hit
    const swing = { ...miss("0", 23), logLine: { event: LogEvent.SWING_MISSED, timestamp: ms(23), parameters: [] } };
    expect(isImmuneHitRow(swing)).toBe(true);
    expect(isImmuneHitRow(miss("0", 23))).toBe(false);
    const [o2] = externalDamageObservations(bop, [{ ...hunter, missesOut: [...hunter.missesOut, swing] }], [bop], combat);
    expect(o2!.immuneHits).toBe(2);
  });

  it("fact7 D29: a unit with nothing dealt has no share, not `0%`", () => {
    const BOP = "1022";
    const bop = enemy("E1", [
      aura(BOP, "Blessing of Protection", "E2", "E1", 20, LogEvent.SPELL_AURA_APPLIED),
      aura(BOP, "Blessing of Protection", "E2", "E1", 28, LogEvent.SPELL_AURA_REMOVED),
    ]);
    const miss: any = {
      spellId: "12294", spellName: "Mortal Strike", destUnitId: "E1", destUnitName: "E1", missType: "IMMUNE", amount: 0,
      timestamp: ms(21), logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms(21), parameters: [] },
    };
    const warrior = ally("A1", [dmg(LogEvent.SWING_DAMAGE, 19, "E1", 40_000)]);
    const [o] = externalDamageObservations(bop, [{ ...warrior, missesOut: [miss, { ...miss, timestamp: ms(22) }, { ...miss, timestamp: ms(23) }] }], [bop], combat);
    expect(o!.X).toBeNull();
    expect(formatDuringExternal(o!, (n) => n)).toContain(`· ${DURING_NO_SHARE} ·`);
    expect(formatDuringExternalForOwner(o!)).toContain(`· ${DURING_NO_SHARE} ·`);
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
      prePeriodic: 0,
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

  it("an ally without a hit on the target in the PRE_HIT_S before the application does not qualify", () => {
    const e1 = enemy("E1", psOn("E1"));
    const late = ally("A2", [
      dmg(LogEvent.SPELL_DAMAGE, 20 - EXTERNAL_DAMAGE_PRE_HIT_S - 0.5, "E1", 50_000),
      dmg(LogEvent.SPELL_DAMAGE, 22, "E1", 30_000),
    ]);
    expect(externalDamageObservations(e1, [late], [e1], combat)).toEqual([]);
  });

  it("F-E14 (A30, 2026-09-30): a periodic hit in the PRE_HIT_S qualifies — a DoT ticking is the ally hitting the target", () => {
    const e1 = enemy("E1", psOn("E1"));
    const dotOnly = ally("A3", [
      dmg(LogEvent.SPELL_PERIODIC_DAMAGE, 19, "E1", 50_000),
      dmg(LogEvent.SPELL_DAMAGE, 22, "E1", 30_000),
    ]);
    const [o] = externalDamageObservations(e1, [dotOnly], [e1], combat);
    expect(o).toMatchObject({ allyId: "A3", preDirect: 0, prePeriodic: 50_000, nDirect: 30_000 });
  });

  it("a qualifying ally with no damage on anyone in the window is the 'empty' shape", () => {
    const e1 = enemy("E1", psOn("E1"));
    const a1 = ally("A1", [dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000)]);
    const [o] = externalDamageObservations(e1, [a1], [e1], combat);
    expect(o).toMatchObject({ kind: "empty", dAll: 0, X: null, K: 0, M: 8, G: 8 });
    expect(formatDuringExternal(o!, (n) => n)).toBe("A1 0k on target · no damage on any enemy player · 0 of 8 s");
  });

  it("absorbed hits are reported separately, count as seconds with damage and in the share (fact7 D6 / D29)", () => {
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
      dmg(LogEvent.SPELL_DAMAGE, 21, "E1", 1), // a fully absorbed hit: its damage row is the ≈ 0 health it removed
      dmg(LogEvent.SPELL_DAMAGE, 25, "E3", 20_000),
    ]);
    const [o] = externalDamageObservations(e1, [a1], [e1, enemy("E3")], combat);
    // The effective −1 residual at 21 s does not make a bin by itself (EXTERNAL_DAMAGE_BIN_MIN_HIT);
    // the two absorbed hits do → K = 2.
    expect(o).toMatchObject({ nDirect: 1, nPeriodic: 0, dAll: 75_001, absorbed: 55_000, K: 2, M: 8, kind: "stops" });
    expect(formatDuringExternal(o!, (n) => n)).toBe(
      "A1 0k on target (+55k absorbed) · 73% of their enemy-player damage · direct 0k / periodic 0k · damage in 2 of 8 s · longest gap 4 s",
    );
  });

  it("FT-T02b:Time Dilation 推迟的部分不算 absorbed,单独写 deferred,仍算有伤害的秒", () => {
    const row = (atS: number, amt: number, shieldId: string): any => ({
      spellId: shieldId,
      spellName: shieldId === "357170" ? "Time Dilation" : "Power Word: Shield",
      srcUnitId: "E2",
      srcUnitName: "E2",
      destUnitId: "E1",
      destUnitName: "E1",
      attackerId: "A1",
      absorbedAmount: amt,
      timestamp: ms(atS),
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: ms(atS), parameters: [] },
    });
    const e1 = makeUnit("E1", {
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: psOn("E1"),
      absorbsIn: [row(21.0, 30_000, "357170"), row(23.5, 25_000, "17")],
    });
    const a1 = ally("A1", [dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000)]);
    const [o] = externalDamageObservations(e1, [a1], [e1], combat);
    expect(o).toMatchObject({ absorbed: 25_000, deferred: 30_000, K: 2 });
    expect(formatDuringExternal(o!, (n) => n)).toContain(
      "A1 0k on target (+25k absorbed, +30k deferred)",
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
    // the aura's own span, cut at the death (24.6 s): seconds 20–24 touched
    expect(o).toMatchObject({ wFrom: 20, wTo: 24.6, M: 5 });
    const dead = makeUnit("A1", { spec: CombatUnitSpec.Warrior_Arms, damageOut: a1.damageOut, deathRecords: [{ timestamp: ms(23.2) }] });
    const [o2] = externalDamageObservations(enemy("E1", psOn("E1")), [dead], [enemy("E1")], combat);
    expect(o2).toMatchObject({ wFrom: 20, wTo: 23.2, M: 4 });
  });

  // round-3 audit D31 (46a55085 0:15): the press second is inside the window
  it("a hit in the aura's first (press) second counts", () => {
    const a1 = ally("A1", [dmg(LogEvent.SPELL_DAMAGE, 19, "E1", 40_000), dmg(LogEvent.SPELL_DAMAGE, 20.5, "E1", 30_000)]);
    const [o] = externalDamageObservations(enemy("E1", psOn("E1", "E2", 20.03, 28.04)), [a1], [enemy("E1")], combat);
    expect(o!.nDirect).toBe(30_000);
    expect(o!.M).toBe(9);
  });
});
