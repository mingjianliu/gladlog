/**
 * genSpellReach's radius collection (reliability round 3, 1bad): Mind
 * Control's possession row carries a 100 yd radius that is not reach. The
 * rule is scoped to that effect ROW — other rows of the same spell keep their
 * radius, trigger links survive, and other auras are untouched (codex astra).
 */
import { describe, expect, it } from "vitest";

import {
  effectRadiiAndParents,
  farthestTriggeringCast,
  passiveReachMods,
} from "../scripts/datagen/genSpellReach";
import {
  AURA_ADD_FLAT_MODIFIER,
  AURA_ADD_FLAT_MODIFIER_BY_LABEL,
  SPELLMOD_RADIUS,
  SPELLMOD_RANGE,
} from "../scripts/datagen/lib/talentInventory";

const RADIUS = new Map([
  ["7", 100],
  ["8", 8],
  ["13", 10],
]);
const COLS = ["EffectRadiusIndex_0", "EffectRadiusIndex_1"];
const row = (
  spellId: string,
  effect: string,
  aura: string,
  r0: string,
  r1: string,
  trigger = "0",
) => ({
  SpellID: spellId,
  Effect: effect,
  EffectAura: aura,
  EffectRadiusIndex_0: r0,
  EffectRadiusIndex_1: r1,
  EffectTriggerSpell: trigger,
});

describe("effectRadiiAndParents", () => {
  it("a MOD_POSSESS row contributes no radius from either slot", () => {
    const { radiusBySpell } = effectRadiiAndParents(
      [row("605", "6", "2", "7", "7"), row("605", "6", "79", "0", "0")],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(radiusBySpell.get("605")).toBeUndefined();
  });

  it("another row of the same spell keeps its area radius", () => {
    const { radiusBySpell } = effectRadiiAndParents(
      [row("900001", "6", "2", "7", "0"), row("900001", "2", "0", "0", "8")],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(radiusBySpell.get("900001")).toBe(8);
  });

  it("the excluded row still records what it triggers", () => {
    const { parentsOf } = effectRadiiAndParents(
      [row("900002", "6", "2", "7", "7", "900003")],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(parentsOf.get("900003")).toEqual(["900002"]);
  });

  it("other auras and non-aura effects keep their radius (BIND_SIGHT included)", () => {
    const { radiusBySpell } = effectRadiiAndParents(
      [
        row("2096", "6", "1", "7", "7"), // Mind Vision, BIND_SIGHT: not listed
        row("51052", "6", "0", "8", "0"), // placed area
        row("465", "35", "0", "13", "0"), // area aura effect
      ],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(radiusBySpell.get("2096")).toBe(100);
    expect(radiusBySpell.get("51052")).toBe(8);
    expect(radiusBySpell.get("465")).toBe(10);
  });
});

/**
 * GH #120: a triggered id's PLACEHOLDER range (100 / 50000) is not a cast
 * range; the triggering cast's is (Throw Glaive 393035 → 337819's 30 yd).
 */
describe("farthestTriggeringCast", () => {
  const range = new Map([
    ["337819", 30],
    ["100", 25],
    ["57934", 100],
    ["900010", 0],
  ]);
  const radius = new Map([["900010", 8]]);
  const all = new Set(["337819", "100", "57934", "900010"]);
  const pick = (
    parents: string[],
    observed: ReadonlySet<string> = all,
    realOnly = false,
  ) => farthestTriggeringCast(parents, range, radius, observed, realOnly);

  it("picks the farthest parent with a real reach; a caster-centred parent counts by radius", () => {
    expect(pick(["337819", "100"])).toEqual({
      id: "337819",
      range: 30,
      radius: 0,
    });
    expect(pick(["900010"])).toEqual({ id: "900010", range: 0, radius: 8 });
  });

  it("a real parent beats a placeholder parent; realOnly drops the placeholder ones", () => {
    expect(pick(["57934", "100"])?.id).toBe("100");
    // a spell with no reach of its own still takes a placeholder parent
    expect(pick(["57934"])?.range).toBe(100);
    expect(pick(["57934"], all, true)).toBeNull();
    expect(pick([])).toBeNull();
  });

  // codex astra (GH #120): Solar Beam 97547 is triggered by the player's 78675
  // (45 yd) and by an NPC-side 311930 (50 yd) — "farthest" alone handed the
  // player's effect the NPC's range.
  it("a parent the corpus has seen cast beats a longer one it never has", () => {
    const r = new Map([
      ["78675", 45],
      ["311930", 50],
    ]);
    const pickSolar = (observed: Set<string>) =>
      farthestTriggeringCast(["311930", "78675"], r, new Map(), observed);
    expect(pickSolar(new Set(["78675"]))?.id).toBe("78675");
    // with neither observed the tie-break falls back to reach
    expect(pickSolar(new Set())?.id).toBe("311930");
    // …but a real range still beats an observed placeholder (Demon Soul
    // 347765: unobserved 350631 at 40 yd vs observed 328953 at 100)
    const r2 = new Map([
      ["350631", 40],
      ["328953", 100],
    ]);
    expect(
      farthestTriggeringCast(
        ["328953", "350631"],
        r2,
        new Map(),
        new Set(["328953"]),
      )?.id,
    ).toBe("350631");
  });
});

/**
 * GH #120: the inventory's spec-passive rows (357715dd) reach the table with
 * `specIds`, so the runtime can own them by spec membership — a spec aura is
 * in no talent tree and `talentModifierOwnershipOf` says "no" to everyone.
 */
describe("passiveReachMods", () => {
  const AURA_FLAT = AURA_ADD_FLAT_MODIFIER;
  const AURA_FLAT_LABEL = AURA_ADD_FLAT_MODIFIER_BY_LABEL;
  const RANGE = SPELLMOD_RANGE;
  const RADIUS = SPELLMOD_RADIUS;
  const invRow = (
    spellId: string,
    aura: number,
    misc0: number,
    basePoints: number,
    targets: string[],
    activation = "passive",
    pvpMultiplier = 1,
  ) => ({
    spellId,
    aura,
    misc0,
    basePoints,
    pvpMultiplier,
    activation,
    targets: targets.map((t) => ({ spellId: t })),
  });
  const specEdge = (spellId: string, specIds: number[]) => ({
    talentSpellId: spellId,
    spellId,
    hop: 0,
    path: "spec" as const,
    specIds,
  });
  const nodeEdge = (spellId: string) => ({
    talentSpellId: spellId,
    spellId,
    hop: 0,
    path: "node" as const,
  });

  it("a spec passive's modifier carries the specs that own it; a talent's does not", () => {
    const { rangeMods } = passiveReachMods({
      rows: [
        invRow("356810", AURA_FLAT, RANGE, 5, ["361469"]),
        invRow("454983", AURA_FLAT, RANGE, 5, ["361469"]),
      ],
      edges: [specEdge("356810", [1468]), nodeEdge("454983")],
    });
    expect(rangeMods.get("361469")).toEqual([
      { talent: "356810", flat: 5, specIds: ["1468"] },
      { talent: "454983", flat: 5 },
    ]);
  });

  // codex astra (GH #120): Sniper's Advantage 1217104 is up only during
  // Trueshot / Volley, whatever its indefinite DB2 duration says — keying it
  // on the PvP talent 1217102 made a holder's Aimed Shot 52 yd all match.
  it("a SpellMod on a spell only a trigger reaches is an aura's, not a passive — skipped and counted", () => {
    const { rangeMods, triggerApplied } = passiveReachMods({
      rows: [invRow("1217104", 108, RANGE, 30, ["19434"])],
      edges: [
        nodeEdge("1217102"),
        {
          talentSpellId: "1217102",
          spellId: "1217104",
          hop: 1,
          path: "pvp" as const,
        },
      ],
    });
    expect(rangeMods.has("19434")).toBe(false);
    expect(triggerApplied).toBe(1);
  });

  it("a talent's own row stays keyed on the talent even when another talent also triggers it", () => {
    const { rangeMods } = passiveReachMods({
      rows: [invRow("459559", AURA_FLAT_LABEL, RANGE, 15, ["2061"])],
      edges: [
        nodeEdge("459559"),
        {
          talentSpellId: "900100",
          spellId: "459559",
          hop: 1,
          path: "node" as const,
        },
      ],
    });
    expect(rangeMods.get("2061")).toEqual([{ talent: "459559", flat: 15 }]);
  });

  it("range and radius rows go to their own tables; buff-gated rows are skipped and counted", () => {
    const { rangeMods, radiusMods, buffGated } = passiveReachMods({
      rows: [
        invRow("1", AURA_FLAT, RADIUS, 8, ["465"]),
        invRow("2", AURA_FLAT, RANGE, 100, ["361469"], "whileAura"),
        invRow("3", AURA_FLAT, 99, 7, ["361469"]), // not a range / radius op
        invRow("4", AURA_FLAT, RANGE, 0, ["361469"]), // zero value
      ],
      edges: [nodeEdge("1"), nodeEdge("2"), nodeEdge("3"), nodeEdge("4")],
    });
    expect(radiusMods.get("465")).toEqual([{ talent: "1", flat: 8 }]);
    expect(rangeMods.has("361469")).toBe(false);
    expect(buffGated).toBe(1);
  });

  it("the same talent reaching a spell through both encodings counts once", () => {
    const { rangeMods } = passiveReachMods({
      rows: [
        invRow("459559", AURA_FLAT_LABEL, RANGE, 15, ["2061"]),
        invRow("459559", AURA_FLAT, RANGE, 15, ["2061"]),
      ],
      edges: [nodeEdge("459559")],
    });
    expect(rangeMods.get("2061")).toEqual([{ talent: "459559", flat: 15 }]);
  });
});
