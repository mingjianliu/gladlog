import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  auraOnlyActivationSeconds,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// A talent-tree cooldown is in the ledger only for a unit whose talents show
// it (or that pressed it): these auras are proc-capable and prove no button
// (`AURA_ACTIVATION_PROVES_BUTTON_IDS`), so each fixture carries the
// COMBATANT_INFO talent row its scenario needs — {node, entry, rank}.
const RENEWING_BLAZE_TALENT = { id1: 93354, id2: 115669, count: 1 };
const AVENGING_WRATH_TALENT = { id1: 81544, id2: 102519, count: 1 };
const evokerInfo = { talents: [RENEWING_BLAZE_TALENT], pvpTalents: [] };
const retributionInfo = { talents: [AVENGING_WRATH_TALENT], pvpTalents: [] };

beforeAll(async () => {
  await ensureAnalysisData();
});

/**
 * Task 7 (cd-ledger-rot): Renewing Blaze (Evoker, spellId 374348) never emits
 * a SPELL_CAST_SUCCESS log line — it's a reactive defensive proc, not a
 * button press — so its only on-log evidence is the self-applied buff aura
 * under a DIFFERENT id (374349). Before the fix, extractMajorCooldowns' cast
 * scan only reads spellCastEvents, so `casts` stayed permanently empty and
 * `neverUsed` stayed permanently true even when the aura clearly fired —
 * reproduced on real data in match 76ea5f90 (Girlbye-Tichondrius-US,
 * 03:08:19.314). This fixture reconstructs the same shape synthetically.
 */
describe("extractMajorCooldowns: aura-only activation (Renewing Blaze 374348/374349)", () => {
  it("counts a self-applied 374349 aura as a Renewing Blaze cast even with zero spellCastEvents", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Devastation,
      info: evokerInfo,
      spellCastEvents: [], // never logged as a cast — proc-only ability
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "374349", // Renewing Blaze's aura id — NOT 374348
          19_314, // mirrors the real match's 03:08:19.314 offset
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    const combat = {
      startTime: 0,
      endTime: 300_000,
      units: { "player-1": owner },
    } as unknown as AtomicArenaCombat;

    const cds = extractMajorCooldowns(owner, combat);
    const renewingBlaze = cds.find((cd) => cd.spellId === "374348");

    expect(renewingBlaze).toBeDefined();
    expect(renewingBlaze!.neverUsed).toBe(false);
    expect(renewingBlaze!.casts).toHaveLength(1);
    expect(renewingBlaze!.casts[0].timeSeconds).toBeCloseTo(19.314, 3);
  });

  it("still reports neverUsed when there is no cast AND no matching aura", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Devastation,
      info: evokerInfo,
      spellCastEvents: [],
      auraEvents: [],
    });

    const combat = {
      startTime: 0,
      endTime: 300_000,
      units: { "player-1": owner },
    } as unknown as AtomicArenaCombat;

    const cds = extractMajorCooldowns(owner, combat);
    const renewingBlaze = cds.find((cd) => cd.spellId === "374348");

    expect(renewingBlaze).toBeDefined();
    expect(renewingBlaze!.neverUsed).toBe(true);
    expect(renewingBlaze!.casts).toHaveLength(0);
  });
});

/**
 * Task A (cd-ledger-rot batch2, 2026-08-14): Avenging Wrath (Paladin,
 * spellId 31884) is normally a button press (handled by the ordinary
 * castRawCasts path), but the Herald of the Sun hero-talent build can also
 * proc-grant it off a Judgment cast — that proc-grant path applies the buff
 * aura (under either the base id 31884 or the alt id 454351) with ZERO
 * SPELL_CAST_SUCCESS for Avenging Wrath. Reproduced from the corpus:
 * match 8e45b000 (Fantasyext-Illidan-US) shows this shape twice in one
 * round, aura bursts @11.0s and @20.5s each ~3-16s after a Judgment cast,
 * neither burst paired with any Avenging Wrath cast anywhere in the round.
 */
describe("extractMajorCooldowns: aura-only activation (Avenging Wrath 31884/454351)", () => {
  it("counts a self-applied 31884 aura as an Avenging Wrath cast even with zero spellCastEvents for it", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: retributionInfo,
      spellCastEvents: [],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "31884",
          11_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    const combat = {
      startTime: 0,
      endTime: 300_000,
      units: { "player-1": owner },
    } as unknown as AtomicArenaCombat;

    const cds = extractMajorCooldowns(owner, combat);
    const avengingWrath = cds.find((cd) => cd.spellId === "31884");

    expect(avengingWrath).toBeDefined();
    expect(avengingWrath!.neverUsed).toBe(false);
    expect(avengingWrath!.casts).toHaveLength(1);
    expect(avengingWrath!.casts[0].timeSeconds).toBeCloseTo(11, 3);
  });

  it("counts a self-applied 454351 (alt proc id) aura as an Avenging Wrath cast", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: retributionInfo,
      spellCastEvents: [],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "454351",
          20_500,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    const combat = {
      startTime: 0,
      endTime: 300_000,
      units: { "player-1": owner },
    } as unknown as AtomicArenaCombat;

    const cds = extractMajorCooldowns(owner, combat);
    const avengingWrath = cds.find((cd) => cd.spellId === "31884");

    expect(avengingWrath).toBeDefined();
    expect(avengingWrath!.neverUsed).toBe(false);
    expect(avengingWrath!.casts).toHaveLength(1);
    expect(avengingWrath!.casts[0].timeSeconds).toBeCloseTo(20.5, 3);
  });

  /**
   * Fallback-only regression guard (2026-08-14, coordinator finding): a
   * corpus exposure scan found 27 self-applied 31884/454351 aura events, on
   * units that ALSO had a real Avenging Wrath cast elsewhere in the round,
   * landing >2s from that real cast with no Judgment adjacency — the same
   * combat-log state-resync artifact documented in cd-ledger-rot-batch2.md
   * (row 11: match 047a0ae0, an Aura Mastery resync burst that happens to
   * also bundle a stray Avenging Wrath aura). Under the old unconditionally-
   * additive semantics, each of those 27 would have fabricated an extra
   * `casts` entry — a false "used" credit for a button the player never
   * pressed at that moment. `auraOnlyActivationSeconds` must ignore aura
   * evidence entirely once a real cast exists for this unit/spell.
   */
  it("does NOT add an extra casts entry for a late aura when the unit has a real cast already (fallback-only)", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: retributionInfo,
      spellCastEvents: [
        makeSpellCastEvent("31884", 5_000, "player-1", "player-1"),
      ],
      auraEvents: [
        // A resync-artifact aura far (>2s, no Judgment nearby) from the real cast.
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "31884",
          60_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    const combat = {
      startTime: 0,
      endTime: 300_000,
      units: { "player-1": owner },
    } as unknown as AtomicArenaCombat;

    const cds = extractMajorCooldowns(owner, combat);
    const avengingWrath = cds.find((cd) => cd.spellId === "31884");

    expect(avengingWrath).toBeDefined();
    expect(avengingWrath!.neverUsed).toBe(false);
    // Only the ONE real cast — the stray aura must not fabricate a second entry.
    expect(avengingWrath!.casts).toHaveLength(1);
    expect(avengingWrath!.casts[0].timeSeconds).toBeCloseTo(5, 3);
  });
});

/**
 * 2026-10-13 (codex review 40-FT-74): the ledger asserts a talent-tree
 * cooldown only on evidence. With the talents unknown — no COMBATANT_INFO row,
 * or a talent blob that does not decode — the evidence is an activation: a
 * cast, or an aura only the press can apply. A never-activated talent-tree
 * wall used to be admitted for a unit with no row at all (and printed
 * `[UNUSED]`).
 */
describe("extractMajorCooldowns: a talent-tree cooldown of a unit whose talents are unknown", () => {
  const combatOf = (unit: ReturnType<typeof makeUnit>) =>
    ({
      startTime: 0,
      endTime: 300_000,
      units: { [unit.id]: unit },
    }) as unknown as AtomicArenaCombat;
  const ASTRAL_SHIFT = "108271";
  const ASTRAL_SHIFT_TALENT = { id1: 103616, id2: 127893, count: 1 };
  const shaman = (
    info: object | undefined,
    spellCastEvents: ReturnType<typeof makeSpellCastEvent>[] = [],
  ) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      info,
      spellCastEvents,
    });
  const has = (unit: ReturnType<typeof makeUnit>, spellId: string) =>
    extractMajorCooldowns(unit, combatOf(unit), {
      withBaselineOnly: true,
    }).some((cd) => cd.spellId === spellId);

  it.each([
    ["no COMBATANT_INFO row", undefined],
    // a spec id the talent map does not know: the blob cannot be decoded
    ["a talent blob that does not decode", { talents: undefined }],
  ])("%s, never pressed: Astral Shift is not asserted", (_name, info) => {
    expect(has(shaman(info), ASTRAL_SHIFT)).toBe(false);
  });

  it.each([
    ["no COMBATANT_INFO row", undefined],
    ["a talent blob that does not decode", { talents: undefined }],
  ])("%s, pressed once: the cast is the evidence", (_name, info) => {
    const unit = shaman(info, [
      makeSpellCastEvent(ASTRAL_SHIFT, 20_000, "player-1", "player-1"),
    ]);
    const row = extractMajorCooldowns(unit, combatOf(unit)).find(
      (cd) => cd.spellId === ASTRAL_SHIFT,
    );
    expect(row?.casts).toHaveLength(1);
    expect(row?.neverUsed).toBe(false);
  });

  it("talents decoded: taken and never pressed is `neverUsed`; not taken is absent", () => {
    const taken = shaman({ talents: [ASTRAL_SHIFT_TALENT], pvpTalents: [] });
    expect(
      extractMajorCooldowns(taken, combatOf(taken)).find(
        (cd) => cd.spellId === ASTRAL_SHIFT,
      )?.neverUsed,
    ).toBe(true);
    expect(has(shaman({ talents: [], pvpTalents: [] }), ASTRAL_SHIFT)).toBe(
      false,
    );
  });

  it("a proc-capable aura proves no button when the talents are unknown; an aura only the press applies does", () => {
    const procAura = makeUnit("player-1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "31884",
          11_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });
    expect(has(procAura, "31884")).toBe(false);
    // Doom Winds: the buff 466772 IS the press (AURA_IS_THE_PRESS_IDS)
    const pressAura = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Enhancement,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "466772",
          11_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });
    expect(has(pressAura, "384352")).toBe(true);
  });

  it("outside the talent tree, no row: a PvP talent nobody can read is not asserted, a spec-baseline defensive is a baseline-only row, a cast is evidence", () => {
    // Holy Paladin: Blessing of Spellwarding is a PvP talent, Divine Shield
    // the spec's DB2 baseline defensive.
    const holy = (spellCastEvents: ReturnType<typeof makeSpellCastEvent>[]) =>
      makeUnit("player-1", {
        class: CombatUnitClass.Paladin,
        spec: CombatUnitSpec.Paladin_Holy,
        spellCastEvents,
      });
    const idle = holy([]);
    expect(has(idle, "204018")).toBe(false);
    const all = extractMajorCooldowns(idle, combatOf(idle), {
      withBaselineOnly: true,
    });
    expect(all.find((cd) => cd.spellId === "642")?.baselineOnly).toBe(true);
    // the evidence-owned ledger every other reader gets does not hold it
    expect(
      extractMajorCooldowns(idle, combatOf(idle)).some(
        (cd) => cd.spellId === "642",
      ),
    ).toBe(false);
    const pressed = holy([
      makeSpellCastEvent("204018", 20_000, "player-1", "player-1"),
    ]);
    expect(has(pressed, "204018")).toBe(true);
  });
});

/**
 * Task A (cd-ledger-rot batch2, 2026-08-14): Ascendance (Shaman, spellId
 * 114052, shared across all 3 specs' talent trees) is normally a button
 * press, but a Restoration-tree talent (Deeply Rooted Elements-style) can
 * also proc-grant a brief Ascendance off a Riptide cast — zero
 * SPELL_CAST_SUCCESS for Ascendance. Reproduced from the corpus: match
 * 4159c044#4 (Worstrshamn-Stormrage-US) shows this recurring 5 times in one
 * round, each aura landing on the exact same tick as a Riptide cast, none
 * paired with an Ascendance cast anywhere in the round.
 */
describe("auraOnlyActivationSeconds: aura-only activation (Ascendance 114052)", () => {
  // Ascendance only ever reaches extractMajorCooldowns' ledger via the
  // "Dynamic Discovery" talent-tree path (it has no static classSpells.ts
  // entry — the id is shared across all 3 Shaman specs' talent trees), which
  // requires real downloaded talent-tree node data (ensureAnalysisData) that
  // isn't available to a synthetic unit fixture. So this pins the shared
  // predicate itself (auraOnlyActivationSeconds — the same function
  // extractMajorCooldowns' rawCasts and deathOutcomeAnalysis's
  // isAvailableAt both consume) directly, same rationale as
  // findSelfAuraEvidence's own test-only export in cdLedgerRot.ts.
  it("returns the self-applied 114052 aura's time even with zero spellCastEvents for it", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "114052",
          52_800,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    const seconds = auraOnlyActivationSeconds(owner, "114052", 0);

    expect(seconds).toHaveLength(1);
    expect(seconds[0]).toBeCloseTo(52.8, 3);
  });

  it("returns nothing for a spellId with no AURA_ONLY_ACTIVATION_IDS entry", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [],
      auraEvents: [],
    });

    expect(auraOnlyActivationSeconds(owner, "12345", 0)).toEqual([]);
  });

  // Fallback-only regression guard (2026-08-14, coordinator finding) at the
  // predicate level, mirroring the extractMajorCooldowns-level guard above
  // for Avenging Wrath — same table, same mechanism, both consumers
  // (extractMajorCooldowns AND deathOutcomeAnalysis's lastCastSeconds) share
  // this one function, so pinning it here covers both.
  it("returns [] once the unit has a real 114052 cast, even with a late aura present", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [
        makeSpellCastEvent("114052", 10_000, "player-1", "player-1"),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "114052",
          90_000,
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });

    expect(auraOnlyActivationSeconds(owner, "114052", 0)).toEqual([]);
  });
});
