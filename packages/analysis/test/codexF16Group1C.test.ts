/**
 * codex review of F16, group 1 (C1–C3): regression tests for the fixes.
 *  - C1 a Spell Reflection 23920 return belongs to the nearest damaging
 *    reflect, not to a later reflected control;
 *  - C2 effect-evidence presses are grouped by the effect's lifetime, not
 *    the nominal cooldown;
 *  - C3 a between-round cast does not switch off in-round effect / aura
 *    evidence.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { reflectedSpells } from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  effectEvidenceCastSeconds,
  extractMajorCooldowns,
  unitCooldownEntry,
  unitCooldownOf,
} from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PID = "player-1";
const combatOf = (u: any, endMs: number) =>
  ({
    startTime: 0,
    endTime: endMs,
    units: { [PID]: u },
  }) as unknown as AtomicArenaCombat;
const entryOf = (u: any, combat: AtomicArenaCombat, spellId: string) =>
  extractMajorCooldowns(u, combat, { withBaselineOnly: true }).find(
    (c) => c.spellId === spellId,
  ) ?? unitCooldownEntry(u, combat, spellId);

describe("C1: a 23920 return goes to the nearest damaging reflect", () => {
  it("Fireball reflected at 10.000, 100k under 23920 at 10.010, Polymorph reflected at 10.200 → the 100k is Fireball's", () => {
    const T0 = 1_000_000;
    const raw = (id: string, over: Record<string, unknown> = {}): any => ({
      id,
      name: `${id}-R-US`,
      spellCastEvents: [],
      auraEvents: [],
      missesOut: [],
      damageIn: [],
      absorbsIn: [],
      advancedActions: [],
      ...over,
    });
    const miss = (spellId: string, ms: number) => ({
      spellId,
      spellName: "x",
      missType: "REFLECT",
      destUnitId: "Player-W",
      logLine: { timestamp: T0 + ms },
    });
    const caster = raw("Player-P", {
      missesOut: [miss("133", 10_000), miss("118", 10_200)],
      damageIn: [
        {
          spellId: "23920",
          srcUnitId: "Player-W",
          effectiveAmount: -100_000,
          logLine: { timestamp: T0 + 10_010 },
        },
      ],
      advancedActions: [0, 10_000, 20_000].map((ms) => ({
        advancedActorId: "Player-P",
        advancedActorMaxHp: 500_000,
        advancedActorCurrentHp: 500_000,
        logLine: { timestamp: T0 + ms },
      })),
    });
    const out = reflectedSpells([caster, raw("Player-W")], T0);
    const fireball = out.find((r) => r.spellId === "133");
    const poly = out.find((r) => r.spellId === "118");
    expect(fireball).toBeDefined();
    expect(fireball!.damageBack).toBe(100_000);
    expect(fireball!.isControl).toBe(false);
    // the control keeps its line, with none of the return
    expect(poly).toBeDefined();
    expect(poly!.isControl).toBe(true);
    expect(poly!.damageBack).toBe(0);
  });
});

describe("C2: effect evidence is grouped by the effect's lifetime, not the cooldown", () => {
  it("Chastise 200200 applied at 10 s and 40 s with no cast row → two presses", () => {
    const u = makeUnit(PID, {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      info: { pvpTalents: [] },
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "200200",
          10_000,
          PID,
          "enemy-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "200200",
          15_000,
          PID,
          "enemy-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "200200",
          40_000,
          PID,
          "enemy-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "200200",
          45_000,
          PID,
          "enemy-1",
        ),
      ],
    });
    const combat = combatOf(u, 300_000);
    const cd = unitCooldownOf(u, "88625")!.cooldownSeconds;
    expect(cd).toBe(60);
    expect(effectEvidenceCastSeconds(u, "88625", cd, combat)).toEqual([10, 40]);
    const e = entryOf(u, combat, "88625");
    expect(e?.casts.map((c) => c.timeSeconds)).toEqual([10, 40]);
  });

  it("one Binding Shot whose tether stuns twice 5 s apart stays one press", () => {
    const u = makeUnit(PID, {
      class: CombatUnitClass.Hunter,
      spec: CombatUnitSpec.Hunter_BeastMastery,
      info: { pvpTalents: [] },
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "117526",
          12_000,
          PID,
          "enemy-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "117526",
          15_000,
          PID,
          "enemy-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "117526",
          17_000,
          PID,
          "enemy-2",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "117526",
          20_000,
          PID,
          "enemy-2",
        ),
      ],
    });
    const combat = combatOf(u, 300_000);
    const cd = unitCooldownOf(u, "109248")!.cooldownSeconds;
    expect(effectEvidenceCastSeconds(u, "109248", cd, combat)).toEqual([12]);
  });
});

describe("C3: a between-round cast does not switch off in-round evidence", () => {
  it("Binding Shot stun at 12 s, round ends at 60 s, a prep-phase cast at 75 s → still one press at 12 s", () => {
    const u = makeUnit(PID, {
      class: CombatUnitClass.Hunter,
      spec: CombatUnitSpec.Hunter_BeastMastery,
      info: { pvpTalents: [] },
      spellCastEvents: [makeSpellCastEvent("109248", 75_000, "", "nil")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "117526",
          12_000,
          PID,
          "enemy-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "117526",
          15_000,
          PID,
          "enemy-1",
        ),
      ],
    });
    const e = entryOf(u, combatOf(u, 60_000), "109248");
    expect(e).toBeDefined();
    expect(e!.neverUsed).toBe(false);
    expect(e!.casts.map((c) => c.timeSeconds)).toEqual([12]);
  });

  it("Renewing Blaze 374349 at 12 s, round ends at 60 s, a 374348 cast at 75 s → still one press at 12 s", () => {
    const u = makeUnit(PID, {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { pvpTalents: [] },
      spellCastEvents: [makeSpellCastEvent("374348", 75_000, PID, "Player")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "374349",
          12_000,
          PID,
          PID,
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "374349",
          20_000,
          PID,
          PID,
          "BUFF",
        ),
      ],
    });
    const e = entryOf(u, combatOf(u, 60_000), "374348");
    expect(e).toBeDefined();
    expect(e!.neverUsed).toBe(false);
    expect(e!.casts.map((c) => c.timeSeconds)).toEqual([12]);
  });
});
