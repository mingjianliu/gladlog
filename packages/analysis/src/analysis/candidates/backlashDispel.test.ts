import { describe, expect, it } from "vitest";

import {
  BACKLASH_UA_MAX_STACKS,
  BACKLASH_UA_SAFE_HP_PCT,
  BACKLASH_VT_SAFE_HP_PCT,
  BACKLASH_WORTH_MIN_DOTS,
  backlashDispelEvents,
  backlashDispelWindowEvents,
  type IBacklashDispelPoint,
  isAccusableBacklashDispel,
  isImmuneWindow,
  isWorthWindow,
} from "./backlashDispel";

const UA = "1259790";
const VT = "34914";
const owner = { id: "P1", name: "Healer" };

function point(over: Partial<IBacklashDispelPoint> = {}): IBacklashDispelPoint {
  return {
    spellId: UA,
    spellName: "Unstable Affliction",
    casterId: "E1",
    targetId: "P2",
    targetName: "Dps",
    targetHealer: false,
    applyS: 60,
    auraEndS: 72,
    available: true,
    availableDispellerIds: [owner.id],
    dispelled: true,
    dispelS: 65,
    dispellerId: owner.id,
    dispellerName: owner.name,
    dispellerHealer: true,
    dispelSpellName: "Cleanse",
    t0S: 65,
    stacks: 1,
    coRemoved: [{ spellName: "Corruption", priority: "Low" }],
    coRemovedCritical: false,
    targetHpPct: 90,
    backlashLanded: true,
    immuneBuffIds: [],
    refDispellerId: owner.id,
    refDispellerBuffIds: [],
    dispellerDmgBefore: 20_000,
    dispellerDmgAfter: 240_000,
    healerHealBefore: 300_000,
    healerHealAfter: 150_000,
    dotCountPre: 3,
    casterDmgAfter: 120_000,
    cdCcHit: null,
    ...over,
  };
}

const ref = {
  spellId: UA,
  n: 6031,
  nLeft: 24742,
  removedK: 91,
  healLostK: 135,
  backlashDmgK: 198,
  ccExposureS: 1.4,
  backlashKind: "silence" as const,
  backlashS: 4,
};
const probes = { lookup: () => ref };

describe("isAccusableBacklashDispel — the archive-measured stratum", () => {
  it("UA: ≤ 2 stacks at ≥ 60 % target HP, nothing Critical co-removed, not immune", () => {
    expect(isAccusableBacklashDispel(point())).toBe(true);
    expect(isAccusableBacklashDispel(point({ stacks: BACKLASH_UA_MAX_STACKS }))).toBe(true);
    expect(isAccusableBacklashDispel(point({ stacks: BACKLASH_UA_MAX_STACKS + 1 }))).toBe(false);
    expect(isAccusableBacklashDispel(point({ targetHpPct: BACKLASH_UA_SAFE_HP_PCT - 1 }))).toBe(false);
    expect(isAccusableBacklashDispel(point({ targetHpPct: null }))).toBe(false);
  });
  it("VT: ≥ 80 % target HP only (40–60 % is the worth-dispelling band)", () => {
    expect(isAccusableBacklashDispel(point({ spellId: VT, targetHpPct: BACKLASH_VT_SAFE_HP_PCT }))).toBe(true);
    expect(isAccusableBacklashDispel(point({ spellId: VT, targetHpPct: BACKLASH_VT_SAFE_HP_PCT - 1 }))).toBe(false);
  });
  it("a CC / High aura co-removed by the same cast, or an immune dispeller, is never accused", () => {
    expect(
      isAccusableBacklashDispel(
        point({ coRemoved: [{ spellName: "Mortal Coil", priority: "Critical" }], coRemovedCritical: true }),
      ),
    ).toBe(false);
    expect(isAccusableBacklashDispel(point({ immuneBuffIds: ["642"] }))).toBe(false);
    // backlash did not land and no mined immunity explains it → unexplained, never accused
    expect(isAccusableBacklashDispel(point({ backlashLanded: false }))).toBe(false);
    expect(isAccusableBacklashDispel(point({ backlashLanded: null }))).toBe(false);
    expect(isAccusableBacklashDispel(point({ dispelled: false, dispelS: null, dispellerId: null }))).toBe(false);
  });
});

describe("backlashDispelEvents", () => {
  it("emits the owner's dispel with the round's own numbers and the corpus reference", () => {
    const ev = backlashDispelEvents([point({ cdCcHit: { targetName: "Mage", spellName: "Fear", atS: 70, durationS: 6, drLevel: "Full" } })], owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("backlash-dispel");
    expect(ev[0]!.facts).toMatchObject({
      target: "Dps",
      debuff: "Unstable Affliction",
      stacks: "1",
      targetHpPct: "90",
      backlash: "silence 4s",
      backlashLanded: "yes",
      selfDmgBeforeK: "20",
      selfDmgAfterK: "240",
      healBeforeK: "300",
      healAfterK: "150",
      coRemoved: "Corruption",
      cdCcTarget: "Mage",
      cdCcSpell: "Fear",
      cdCcDurationS: "6",
      cdCcDr: "Full",
      refKey: UA,
      refN: "6031",
      refRemovedK: "91",
      refHealLostK: "135",
      refBacklashDmgK: "198",
      refCcExposureS: "1.4",
    });
  });
  it("only the owner's dispels; no reference → no accusation; cap holds", () => {
    expect(backlashDispelEvents([point({ dispellerId: "P3" })], owner, probes)).toHaveLength(0);
    expect(backlashDispelEvents([point()], owner, { lookup: () => null })).toHaveLength(0);
    const many = [1, 2, 3, 4].map((i) => point({ t0S: 60 + i * 20, dispelS: 60 + i * 20, targetHpPct: 70 + i }));
    const ev = backlashDispelEvents(many, owner, probes);
    expect(ev).toHaveLength(2);
    // time order on output; the two highest-HP (clearest) cases survive the cap
    expect(ev.map((e) => e.facts.targetHpPct)).toEqual(["73", "74"]);
  });
});

describe("backlashDispelWindowEvents", () => {
  const worthRef = { spellId: VT, nD: 466, nL: 10522, deathDPct: 5, deathLPct: 12, netK: 65 };
  const vtRef = { ...ref, spellId: VT, backlashKind: "horror" as const, backlashS: 3 };
  const wp = { lookup: () => vtRef, lookupWorth: (_: string, kind: "worth" | "immune") => (kind === "worth" ? worthRef : { ...worthRef, nD: 769, nL: 4522, deathDPct: 1, deathLPct: 2, netK: 12 }) };
  const left = (over: Partial<IBacklashDispelPoint> = {}) =>
    point({ spellId: VT, spellName: "Vampiric Touch", dispelled: false, dispelS: null, dispellerId: null, dispellerName: null, dispellerHealer: null, dispelSpellName: null, backlashLanded: null, dispellerDmgBefore: null, dispellerDmgAfter: null, coRemoved: [], t0S: 65, targetHpPct: 50, dotCountPre: BACKLASH_WORTH_MIN_DOTS, ...over });
  it("worth: VT at 40–60 % with ≥ 3 DoTs left on while the owner's cleanse was ready", () => {
    expect(isWorthWindow(left())).toBe(true);
    expect(isWorthWindow(left({ dotCountPre: BACKLASH_WORTH_MIN_DOTS - 1 }))).toBe(false);
    expect(isWorthWindow(left({ targetHpPct: 65 }))).toBe(false);
    expect(isWorthWindow(left({ spellId: UA }))).toBe(false);
    const ev = backlashDispelWindowEvents([left()], owner, wp);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.facts).toMatchObject({ reason: "worth", dots: "3", refKey: `${VT}:worth`, refDeathDispelled: "5", refDeathLeft: "12", refNetK: "65", casterDmgAfterK: "120" });
  });
  it("immune: the owner was under a mined immunity buff and the target was ≥ 60 %", () => {
    const p = left({ targetHpPct: 85, dotCountPre: 1, immuneBuffIds: ["642"] });
    expect(isImmuneWindow(p)).toBe(true);
    const ev = backlashDispelWindowEvents([p], owner, wp);
    expect(ev[0]!.facts).toMatchObject({ reason: "immune", refKey: `${VT}:immune`, refND: "769", refNetK: "12" });
    expect(ev[0]!.facts.immuneBuff).toBeTruthy();
  });
  it("never fires when the owner was not an available dispeller, or the worth cell is missing", () => {
    expect(backlashDispelWindowEvents([left({ availableDispellerIds: ["P3"] })], owner, wp)).toHaveLength(0);
    expect(backlashDispelWindowEvents([left()], owner, { lookup: () => vtRef, lookupWorth: () => null })).toHaveLength(0);
    // an immune window with no ":immune" cell is silent too
    expect(backlashDispelWindowEvents([left({ targetHpPct: 85, dotCountPre: 1, immuneBuffIds: ["642"] })], owner, { lookup: () => vtRef, lookupWorth: (_s, kind) => (kind === "worth" ? worthRef : null) })).toHaveLength(0);
  });
});
