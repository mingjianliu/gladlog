/**
 * Canonical offensive-cooldown table membership (GH #60 tail, unification
 * 2026-09-02). Pins the union-minus-dead construction and — the point of the
 * unification — that BOTH former consumers answer through the same set.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { hasOffensiveSpellActive } from "./cooldowns";
import {
  isOffensiveSpell,
  OFFENSIVE_CD_DEAD_IDS,
  OFFENSIVE_CD_SPELL_IDS,
} from "./spellDanger";

describe("OFFENSIVE_CD_SPELL_IDS — canonical membership", () => {
  it("the dead list is exactly the nine audited zero-S2 classMetadata ids", () => {
    expect([...OFFENSIVE_CD_DEAD_IDS].sort()).toEqual(
      [
        "113860", // Dark Soul: Misery
        "137639", // Storm, Earth, and Fire
        "207289", // Unholy Assault
        "231895", // Crusade
        "266779", // Coordinated Assault
        "275699", // Apocalypse
        "323764", // Convoke the Spirits (renumbered → 322109)
        "359844", // Call of the Wild
        "391109", // Dark Ascension
      ].sort(),
    );
  });

  it("no dead id is a member, of the set or of the predicate", () => {
    for (const id of OFFENSIVE_CD_DEAD_IDS) {
      expect(OFFENSIVE_CD_SPELL_IDS.has(id)).toBe(false);
      expect(isOffensiveSpell(id)).toBe(false);
    }
  });

  it("the six former forward-gap ids (classMetadata-only, live) are members now", () => {
    for (const id of [
      "47568", // Empower Rune Weapon
      "114050", // Ascendance (Elemental)
      "123904", // Invoke Xuen, the White Tiger
      "191427", // Metamorphosis
      "227847", // Bladestorm
      "265187", // Summon Demonic Tyrant
    ]) {
      expect(isOffensiveSpell(id)).toBe(true);
    }
  });

  it("the spellTags side survived intact (spot checks, incl. tag-side-only ids)", () => {
    for (const id of [
      "190319", // Combustion (both sides)
      "360194", // Deathmark (both sides)
      "84714", // Frozen Orb (tag side only)
      "42650", // Army of the Dead (tag side only)
      "10060", // Power Infusion — still a member; lead exclusion is a separate fact
    ]) {
      expect(isOffensiveSpell(id)).toBe(true);
    }
  });

  it("union-minus-dead arithmetic: 41 ∪ 35 (overlap 19) − 9 dead = 48 (2026-09-18: + Zenith)", () => {
    expect(OFFENSIVE_CD_SPELL_IDS.size).toBe(48);
    // The Windwalker burst that replaced the dead Storm, Earth, and Fire.
    expect(OFFENSIVE_CD_SPELL_IDS.has("1249625")).toBe(true);
    expect(OFFENSIVE_CD_SPELL_IDS.has("137639")).toBe(false);
  });

  it("isOffensiveSpell IS the set — no second membership rule", () => {
    for (const id of OFFENSIVE_CD_SPELL_IDS) expect(isOffensiveSpell(id)).toBe(true);
    expect(isOffensiveSpell("8936")).toBe(false); // Regrowth, never offensive
  });
});

describe("both consumers read the canonical table", () => {
  it("hasOffensiveSpellActive (threatActiveAt's aura evidence) now sees a tag-side-only offensive aura", () => {
    // Frozen Orb 84714 sat only in the spellTags table; before 2026-09-02 the
    // classMetadata-only OFFENSIVE_SPELL_IDS could not see it at all.
    const unit = {
      auraEvents: [
        {
          spellId: "84714",
          srcUnitId: "E1",
          timestamp: 1_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: 1_000 },
        },
      ],
    } as any;
    expect(hasOffensiveSpellActive(unit, 2_000, null)).toBe(true);
  });

  it("…and no longer reacts to a dead id's aura", () => {
    const unit = {
      auraEvents: [
        {
          spellId: "323764", // dead Convoke id
          srcUnitId: "E1",
          timestamp: 1_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: 1_000 },
        },
      ],
    } as any;
    expect(hasOffensiveSpellActive(unit, 2_000, null)).toBe(false);
  });
});
