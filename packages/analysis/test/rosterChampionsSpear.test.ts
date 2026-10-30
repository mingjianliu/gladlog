/**
 * F19: Champion's Spear (376079, 90 s) had no roster row, so a warrior's
 * press had no line anywhere. A Utility row: on the ledger — the press line,
 * the loadout, [RES] — and no offensive registration (`offensiveCdGapScan`
 * left it out: it rides the cooldown it is pressed with).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import { SpellTag } from "../src/data/spellTypes";
import { extractMajorCooldowns, MIN_CD_SECONDS } from "../src/utils/cooldowns";
import { isEnemyCdWindowSpell } from "../src/utils/enemyCDs";
import { OFFENSIVE_CD_SPELL_IDS } from "../src/utils/spellDanger";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const SPEAR = "376079";
const T0 = 1_700_000_000_000;
const OBSERVED = new Set(
  (observed as unknown as Array<string | number>).map(String),
);

/** `talents`: the decoded talent list, or undefined for a unit whose
 * COMBATANT_INFO the log does not carry. */
const warrior = (castSeconds: number[], talents?: unknown[]) =>
  makeUnit("player-1", {
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Fury,
    info: (talents ? { talents, pvpTalents: [] } : undefined) as any,
    spellCastEvents: castSeconds.map((s) =>
      makeSpellCastEvent(SPEAR, T0 + s * 1000, "player-1"),
    ),
  });
const ledger = (u: any) =>
  extractMajorCooldowns(u, {
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [u.id]: u },
  } as unknown as import("@gladlog/parser-compat").AtomicArenaCombat);

describe("Warrior: Champion's Spear is on the roster (F19)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a Utility row under the id the corpus casts, at the ledger's floor or above", () => {
    const row = classMetadata
      .find((c) => c.unitClass === CombatUnitClass.Warrior)!
      .abilities.find((a) => a.spellId === SPEAR);
    expect(row?.name).toBe("Champion's Spear");
    expect(row?.tags).toEqual([SpellTag.Utility]);
    expect(OBSERVED.has(SPEAR)).toBe(true);
    expect(effectiveCooldownSeconds(SPEAR)).toBe(90);
    expect(effectiveCooldownSeconds(SPEAR)!).toBeGreaterThanOrEqual(
      MIN_CD_SECONDS,
    );
  });

  it("no offensive registration came with it: no enemy burst window, no burst anchor", () => {
    expect(OFFENSIVE_CD_SPELL_IDS.has(SPEAR)).toBe(false);
    expect(isEnemyCdWindowSpell(SPEAR)).toBe(false);
  });

  it("121c7e15: two presses → one ledger row, tagged Utility, both presses on it", () => {
    const row = ledger(warrior([10.5, 139.0])).find((c) => c.spellId === SPEAR);
    expect(row?.tag).toBe("Utility");
    expect(row?.casts.map((c) => c.timeSeconds)).toEqual([10.5, 139.0]);
    expect(row?.cooldownSeconds).toBe(90);
  });

  it("it is a talent row: a decoded talent list without it has no row", () => {
    expect(
      ledger(warrior([], [])).find((c) => c.spellId === SPEAR),
    ).toBeUndefined();
  });
});
