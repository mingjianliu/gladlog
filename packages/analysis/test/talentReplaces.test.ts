/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TALENT_REPLACES — a class / hero talent that replaces a spell removes that
 * spell from the player's ledger and talent ownership (reliability audit C1,
 * 2026-09-26: Farseer Ancestral Swiftness 448861 replaces Nature's Swiftness
 * 378081; match 4ef486f5 was told "never pressed Nature's Swiftness" while
 * pressing Ancestral Swiftness five times).
 *
 * Node / entry ids from talentIdMap.json (Restoration Shaman, spec 264):
 * Nature's Swiftness classNodes 103620 / entry 127899; Ancestral Swiftness
 * heroNodes 94894 / entry 117491 (subTree 56, Farseer).
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { replacedSpellIds, TALENT_REPLACES } from "../src/data/talentReplaces";
import { extractMajorCooldowns } from "../src/utils/cooldowns";
import { talentOwnershipOf } from "../src/utils/talentOwnership";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const T_END = T0 + 300_000;
const NS = "378081";
const AS_TALENT = "448861";
const AS_CAST = "443454";
const NS_NODE = { id1: 103620, id2: 127899, count: 1 };
const AS_NODE = { id1: 94894, id2: 117491, count: 1 };

function restoShaman(opts: { farseer: boolean; casts?: string[] }) {
  return makeUnit("player-1", {
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Restoration,
    spellCastEvents: (opts.casts ?? []).map((id, i) =>
      makeSpellCastEvent(id, T0 + 20_000 + i * 10_000, "player-1"),
    ),
    info: {
      talents: opts.farseer ? [NS_NODE, AS_NODE] : [NS_NODE],
      pvpTalents: [],
    } as any,
  });
}

function combatOf(owner: ReturnType<typeof makeUnit>) {
  return {
    startTime: T0,
    endTime: T_END,
    units: { "player-1": owner },
  } as unknown as import("@gladlog/parser-compat").AtomicArenaCombat;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("replacedSpellIds — the one predicate both consumers read", () => {
  it("a held replacing talent removes its spells; undecoded talents remove nothing", () => {
    expect(replacedSpellIds(new Set([AS_TALENT]), new Set(), {}).has(NS)).toBe(
      true,
    );
    expect(replacedSpellIds(new Set([NS]), new Set(), {}).has(NS)).toBe(false);
    expect(replacedSpellIds(null, new Set(), {}).size).toBe(0);
    // PvP table still flows through the same predicate
    expect(
      replacedSpellIds(null, new Set(["410126"]), { "410126": ["115750"] }).has(
        "115750",
      ),
    ).toBe(true);
  });

  it("every registered row names a talent and cast ids (no empty rows)", () => {
    for (const [talent, replaced] of Object.entries(TALENT_REPLACES)) {
      expect(talent).toMatch(/^\d+$/);
      expect(replaced.length).toBeGreaterThan(0);
      for (const r of replaced) expect(r).toMatch(/^\d+$/);
    }
  });
});

describe("extractMajorCooldowns — the replaced button never enters the ledger", () => {
  it("Farseer holder: no Nature's Swiftness entry (save-roster injection path included)", () => {
    const owner = restoShaman({ farseer: true, casts: [AS_CAST] });
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    expect(cds.find((c) => c.spellId === NS)).toBeUndefined();
  });

  it("non-Farseer Resto Shaman keeps Nature's Swiftness (roster injection on talent evidence)", () => {
    const owner = restoShaman({ farseer: false });
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    expect(cds.find((c) => c.spellId === NS)).toBeDefined();
  });

  it("a real cast of the replaced spell beats the table for that player", () => {
    const owner = restoShaman({ farseer: true, casts: [NS] });
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    const ns = cds.find((c) => c.spellId === NS);
    expect(ns).toBeDefined();
    expect(ns?.casts).toHaveLength(1);
  });
});

describe("talentOwnershipOf — a replaced spell is 'no' even when its own node is selected", () => {
  it("Farseer holder → no; plain holder → yes", () => {
    expect(talentOwnershipOf(restoShaman({ farseer: true }), NS)).toBe("no");
    expect(talentOwnershipOf(restoShaman({ farseer: false }), NS)).toBe("yes");
  });
});

describe("TALENT_REPLACES_GENERATED (official TraitDefinition.OverridesSpellID)", () => {
  it("Berserker Shout 384100 → Berserker Rage 18499 is in the generated table and feeds the predicate", () => {
    expect(replacedSpellIds(new Set(["384100"]), new Set(), {}).has("18499")).toBe(true);
  });
  it("a pair the pressedAs model owns (Ice Cold → Ice Block) is not dropped: the ledger keeps Ice Block with Ice Cold's presses", () => {
    // Frost Mage holding Ice Block (classNodes 62122 / entry 80181) and Ice Cold
    // (classNodes 62085 / entry 80141, spell 414659); one Ice Cold press.
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      spellCastEvents: [makeSpellCastEvent("414658", T0 + 30_000, "player-1")],
      info: {
        talents: [
          { id1: 62122, id2: 80181, count: 1 },
          { id1: 62085, id2: 80141, count: 1 },
        ],
        pvpTalents: [],
      } as any,
    });
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    const iceBlock = cds.find((c) => c.spellName === "Ice Block");
    expect(iceBlock, "official override lists Ice Cold → Ice Block, but pressedAs owns the pair").toBeDefined();
    expect(iceBlock?.casts).toHaveLength(1);
  });
});
