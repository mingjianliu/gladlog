/** `stackedDefensivePairs` + `[STACKED DEFENSIVES]` renderer (GH #95): two
 * majors from two casters on one friendly, overlap on the grid, B priced
 * over the overlap and its full run, owner-anchored. */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  formatStackedDefensiveLines,
  STACKED_DEFENSIVES_CAP,
  STACKED_DEFENSIVES_TAG,
} from "../context/stackedDefensives";
import {
  STACKED_DEFENSIVE_MAJOR_IDS,
  stackedDefensivePairs,
} from "./stackedDefensives";

const T0 = 1_000_000;
// Pain Suppression (external, 40 %) and Barkskin-class personal: pick two ids
// the product prices as percentage auras.
const PS = "33206";
const aura = (
  t: number,
  event: string,
  spellId: string,
  srcUnitId: string,
  srcUnitName: string,
) => ({
  timestamp: T0 + t,
  spellId,
  srcUnitId,
  srcUnitName,
  destUnitId: "M",
  logLine: { event, timestamp: T0 + t },
});
const unit = (
  id: string,
  name: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  name,
  spec: CombatUnitSpec.Warrior_Arms,
  reaction: CombatUnitReaction.Friendly,
  info: { teamId: "0" },
  advancedActions: [
    { timestamp: T0, advancedActorCurrentHp: 100, advancedActorMaxHp: 100 },
  ],
  damageIn: [],
  absorbsIn: [],
  auraEvents: [],
  spellCastEvents: [],
  ...over,
});
function combat(units: any[]) {
  const map: Record<string, any> = {};
  for (const u of units) map[u.id] = u;
  return {
    startTime: T0,
    endTime: T0 + 60_000,
    units: map,
    startInfo: { bracket: "3v3" },
  };
}

const personal = [...STACKED_DEFENSIVE_MAJOR_IDS].find((id) => id !== PS)!;

describe("stackedDefensivePairs", () => {
  it("prices the later aura over the overlap and its full run, names both casters, owner-anchored", () => {
    const owner = unit("H", "Heals-R", {
      spec: CombatUnitSpec.Priest_Discipline,
    });
    const mate = unit("M", "Mate-R", {
      auraEvents: [
        aura(10_000, LogEvent.SPELL_AURA_APPLIED, personal, "M", "Mate-R"),
        aura(12_000, LogEvent.SPELL_AURA_APPLIED, PS, "H", "Heals-R"),
        aura(15_000, LogEvent.SPELL_AURA_REMOVED, personal, "M", "Mate-R"),
        aura(20_000, LogEvent.SPELL_AURA_REMOVED, PS, "H", "Heals-R"),
      ],
      damageIn: [
        { timestamp: T0 + 13_000, amount: -30, effectiveAmount: -30 },
        { timestamp: T0 + 18_000, amount: -30, effectiveAmount: -30 },
      ],
    });
    const pairs = stackedDefensivePairs(owner, combat([owner, mate]));
    expect(pairs).toHaveLength(1);
    const p = pairs[0]!;
    expect(p.targetName).toBe("Mate-R");
    expect(p.first.casterName).toBe("Mate-R");
    expect(p.second.spellId).toBe(PS);
    expect(p.second.casterIsOwner).toBe(true);
    expect(p.overlapFromSec).toBe(12);
    expect(p.overlapToSec).toBe(15);
    expect(p.overlapSeconds).toBe(3);
    expect(p.pricing).toBe("pct");
    // 40 % aura: 30 damage taken in the overlap → 30 × 0.4 / 0.6 = 20 % blocked;
    // 60 over the full run → 40 %
    expect(p.blockedOverlapPct).toBe(20);
    expect(p.blockedFullPct).toBe(40);
    expect(p.secondRunSeconds).toBe(8);

    // a bystander owner (neither caster nor target) sees nothing
    const other = unit("X", "Other-R");
    expect(stackedDefensivePairs(other, combat([owner, mate, other]))).toEqual(
      [],
    );
  });

  it("two auras from the SAME caster, or an overlap under 0.5 s, are not a stack", () => {
    const owner = unit("H", "Heals-R", {
      spec: CombatUnitSpec.Priest_Discipline,
    });
    const mate = unit("M", "Mate-R", {
      auraEvents: [
        aura(10_000, LogEvent.SPELL_AURA_APPLIED, personal, "M", "Mate-R"),
        aura(14_800, LogEvent.SPELL_AURA_APPLIED, PS, "H", "Heals-R"),
        aura(15_000, LogEvent.SPELL_AURA_REMOVED, personal, "M", "Mate-R"),
        aura(20_000, LogEvent.SPELL_AURA_REMOVED, PS, "H", "Heals-R"),
      ],
    });
    expect(stackedDefensivePairs(owner, combat([owner, mate]))).toEqual([]);
  });
});

describe("formatStackedDefensiveLines", () => {
  const pair = (over: Record<string, unknown> = {}) => ({
    targetId: "M",
    targetName: "Mate-R",
    targetIsOwner: false,
    first: {
      spellId: "1",
      spellName: "Die by the Sword",
      casterName: "Mate-R",
      casterIsOwner: false,
    },
    second: {
      spellId: PS,
      spellName: "Pain Suppression",
      casterName: "Heals-R",
      casterIsOwner: true,
    },
    overlapFromSec: 12,
    overlapToSec: 15,
    overlapSeconds: 3,
    pricing: "pct" as const,
    unpricedReason: null,
    blockedOverlapPct: 20,
    blockedFullPct: 40,
    secondRunSeconds: 8,
    ...over,
  });

  it("states who cast each, the overlap on the grid and what the later one blocked — a fact, not a verdict", () => {
    const [e] = formatStackedDefensiveLines([pair()]);
    expect(e!.atSeconds).toBe(12);
    expect(e!.line).toBe(
      `${STACKED_DEFENSIVES_TAG}   Mate-R had Die by the Sword (from Mate-R) and Pain Suppression (from you) up together 0:12–0:15 (3s); the later one, Pain Suppression, blocked ~20% of their max HP during the overlap (~40% over its full 8s run) — a fact about the stack, not a verdict`,
    );
  });

  it("unpriced auras say so; the cap keeps the longest overlaps, emitted in time order", () => {
    const [u] = formatStackedDefensiveLines([
      pair({
        pricing: "unpriced",
        unpricedReason: "immunity",
        blockedOverlapPct: null,
        blockedFullPct: null,
      }),
    ]);
    expect(u!.line).toContain("is not priced here (immunity)");
    const out = formatStackedDefensiveLines([
      pair({ overlapFromSec: 30, overlapSeconds: 1 }),
      pair({ overlapFromSec: 50, overlapSeconds: 5 }),
      pair({ overlapFromSec: 10, overlapSeconds: 4 }),
    ]);
    expect(out).toHaveLength(STACKED_DEFENSIVES_CAP);
    expect(out.map((e) => e.atSeconds)).toEqual([10, 50]);
  });
});
