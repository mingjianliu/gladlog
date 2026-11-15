/**
 * Pipeline T106 (fact13 D14), user ruling R40 2026-11-14: Feign Death is a
 * defensive — a ready one keeps the hunter out of the kill window's
 * `defenseless` span. Its press is never logged as a success; the span and
 * the kill target's defensive state read the ledger's aura-read activation
 * (Survival Tactics 202748), and a pressed Feign Death holds nothing itself
 * (in hand only, like Alter Time).
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  countsAsKillWindowDefensiveInHand,
  isKillWindowMajorDefensive,
} from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import { getDefensiveStateAtTime } from "../src/utils/killWindowTargetSelection";
import {
  kwAuraReadPressesS,
  kwAuraReadUnpressedInHand,
} from "../src/utils/kwAuraReadPresses";
import { computeOffensiveWindowsUncached } from "../src/utils/offensiveWindows";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const FEIGN = "5384";
const SURVIVAL_TACTICS = "202748";

beforeAll(async () => {
  await ensureAnalysisData();
});

const hunter = (feignAtS: number[]) =>
  makeUnit("e1", {
    name: "EnemyHunter",
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_Marksmanship,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents: [
      // Aspect of the Turtle and Exhilaration: the kit's other defensives,
      // spent, so the span can open
      makeSpellCastEvent(
        "186265",
        at(2),
        "e1",
        "EnemyHunter",
        "e1",
        "EnemyHunter",
      ),
      makeSpellCastEvent(
        "109304",
        at(2.5),
        "e1",
        "EnemyHunter",
        "e1",
        "EnemyHunter",
      ),
    ],
    auraEvents: feignAtS.flatMap((s) => [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        SURVIVAL_TACTICS,
        at(s),
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        SURVIVAL_TACTICS,
        at(s + 2),
        "e1",
        "e1",
        "BUFF",
      ),
    ]),
  });
const windowsOf = (u: ReturnType<typeof hunter>) =>
  computeOffensiveWindowsUncached([u] as never, [], {
    startTime: T0,
    endTime: at(120),
    units: { e1: u },
  } as never).map((w) => [w.fromSeconds, w.toSeconds]);

describe("T106 — a ready Feign Death keeps the hunter out of `defenseless`", () => {
  it("is in hand only: counted while ready, never a roster wall", () => {
    expect(countsAsKillWindowDefensiveInHand(FEIGN)).toBe(true);
    expect(isKillWindowMajorDefensive(FEIGN)).toBe(false);
  });
  it("its presses are the ledger's aura-read activations", () => {
    const u = hunter([15]);
    expect(
      kwAuraReadPressesS(u, {
        startTime: T0,
        endTime: at(120),
        units: { e1: u },
      } as never).get(FEIGN),
    ).toEqual([15]);
  });
  it("the span stops when Feign Death is back and reopens at its next press", () => {
    const ws = windowsOf(hunter([15, 70]));
    // pressed 15 s (30 s cooldown): back at 45 s, pressed again 70 s
    expect(ws.some(([f, t]) => f! < 50 && t! > 50)).toBe(false);
    expect(ws.some(([f, t]) => f! <= 45 && t! >= 44)).toBe(true);
    expect(ws.some(([f]) => f! >= 70 && f! < 73)).toBe(true);
  });
  // codex 85-tk-K-T106-1 #1: Feign Death is every hunter's baseline; one
  // never pressed is in hand all round — the hunter is never defenseless
  it("never pressed: in hand all round, no span", () => {
    const u = hunter([]);
    const combat = {
      startTime: T0,
      endTime: at(120),
      units: { e1: u },
    } as never;
    expect(kwAuraReadUnpressedInHand(u, combat)).toEqual([FEIGN]);
    expect(windowsOf(u)).toEqual([]);
  });
  // codex 85-tk-K-T106-1 #2: before its first press it is ready, in the kill
  // target's defensive state as in the span
  it("the kill target's state holds it before its first press, not after", () => {
    const u = hunter([15]);
    const combat = {
      startTime: T0,
      endTime: at(120),
      units: { e1: u },
    } as never;
    expect(getDefensiveStateAtTime(u, 10, T0, combat).available).toContain(
      "Feign Death",
    );
    expect(getDefensiveStateAtTime(u, 20, T0, combat).available).not.toContain(
      "Feign Death",
    );
  });
});
