/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #134 item (c) (pipeline T22): `ccSamplerFor` (PEEL OPTIONS, CC USE)
 * samples for ONE known control, so "the owner could not cast it" is asked
 * of that control — a kick lockout of another school is no `owner-cc`
 * (PV394 #7) — and a control the log shows the owner's PET casting is asked
 * of the pet's own controls and lockouts, not the owner's (2026-10-11 pet
 * routing in `cannotCastIntervalsForSpells`). The predicate-index entry that
 * said both were still open was written before either landed; this pins them.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { spellSchoolMask } from "../src/data/spellSchools";
import { ccSamplerFor } from "../src/utils/ccTargetState";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const DRAGONS_BREATH = "31661"; // Fire
const POLYMORPH = "118"; // Arcane
const FIREBALL = "133"; // Fire
const AXE_TOSS = "89766"; // the Felguard's stun
const HAMMER_OF_JUSTICE = "853";
const COUNTERSPELL = "2139";

beforeAll(async () => {
  await ensureAnalysisData();
});

const cd = (spellId: string, spellName: string): any => ({
  spellId,
  spellName,
  tag: "CC",
  cooldownSeconds: 30,
  maxChargesDetected: 1,
  casts: [],
  availableWindows: [],
  neverUsed: true,
});
const kick = (interrupted: string, s: number) => ({
  ...makeInterruptEvent(
    COUNTERSPELL,
    "Counterspell",
    interrupted,
    "x",
    at(s),
    "e",
    "Enemy",
  ),
  destUnitId: "o",
});
const stun = (onId: string, fromS: number, toS: number) => [
  makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED,
    HAMMER_OF_JUSTICE,
    at(fromS),
    "e",
    onId,
  ),
  makeAuraEvent(
    LogEvent.SPELL_AURA_REMOVED,
    HAMMER_OF_JUSTICE,
    at(toS),
    "e",
    onId,
  ),
];
const combatOf = (units: any[]): any => ({
  startTime: T0,
  endTime: at(120),
  startInfo: { zoneId: "" },
  units: Object.fromEntries(units.map((u) => [u.id, u])),
});
const reasonAt = (sampler: any, target: any, s: number) =>
  sampler.stateAt(target, s).reason;

describe("ccSamplerFor asks about the control it samples (GH #134 c)", () => {
  it("the schools the case stands on", () => {
    expect(spellSchoolMask(DRAGONS_BREATH)).toBe(4);
    expect(spellSchoolMask(POLYMORPH)).toBe(64);
    expect(spellSchoolMask(FIREBALL)).toBe(4);
  });

  it("an Arcane lockout is no owner-cc for Dragon's Breath; a Fire lockout is", () => {
    const enemy = makeUnit("e", { name: "Enemy" });
    for (const [interrupted, want] of [
      [POLYMORPH, false],
      [FIREBALL, true],
    ] as const) {
      const owner = makeUnit("o", {
        name: "Mage",
        spec: CombatUnitSpec.Mage_Fire,
        info: {},
        actionIn: [kick(interrupted, 50)],
      });
      const sampler = ccSamplerFor({
        combat: combatOf([owner, enemy]),
        owner: owner as any,
        cd: cd(DRAGONS_BREATH, "Dragon's Breath"),
        enemyIds: new Set(["e"]),
      });
      expect(sampler).not.toBeNull();
      expect(reasonAt(sampler, enemy, 51) === "owner-cc", interrupted).toBe(
        want,
      );
      // control: before the kick the owner is free either way
      expect(reasonAt(sampler, enemy, 40)).not.toBe("owner-cc");
    }
  });

  it("Axe Toss, cast by the Felguard: the pet's stun stops it, the owner's does not", () => {
    const enemy = makeUnit("e", { name: "Enemy" });
    const build = (ownerStun: boolean) => {
      const owner = makeUnit("o", {
        name: "Warlock",
        spec: CombatUnitSpec.Warlock_Demonology,
        info: {},
        auraEvents: ownerStun ? stun("o", 50, 54) : [],
        petSpellCastEvents: [
          makeSpellCastEvent(
            AXE_TOSS,
            at(20),
            "e",
            "Enemy",
            "Pet-1",
            "Felguard",
          ),
        ],
      });
      const pet = makeUnit("Pet-1", {
        name: "Felguard",
        ownerId: "o",
        auraEvents: ownerStun ? [] : stun("Pet-1", 50, 54),
      });
      return ccSamplerFor({
        combat: combatOf([owner, pet, enemy]),
        owner: owner as any,
        cd: cd(AXE_TOSS, "Axe Toss"),
        enemyIds: new Set(["e"]),
      });
    };
    const ownerStunned = build(true);
    const petStunned = build(false);
    expect(ownerStunned).not.toBeNull();
    expect(reasonAt(ownerStunned, enemy, 51)).not.toBe("owner-cc");
    expect(reasonAt(petStunned, enemy, 51)).toBe("owner-cc");
  });
});
