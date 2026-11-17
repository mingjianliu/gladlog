/**
 * Pipeline T113, batch review 80-PIPE-110-B97: the kill windows' press timer
 * (`kwTimedPressLengthS`) held a Burrow for its official 5 s while the
 * aura's own span readers ended it at the holder's first action. Burrow
 * pressed at 20 s, a Healing Surge bar begun at 22 s, no REMOVED, no hit,
 * the kit's other defensive spent: the window opened at 25 s, not 22.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { stealthImmunityPressActionEndS } from "../src/utils/enemyDefensives";
import { computeOffensiveWindowsUncached } from "../src/utils/offensiveWindows";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const BURROW = "409293";

beforeAll(async () => {
  await ensureAnalysisData();
});

const shaman = (barAtS: number | null) => {
  const u = makeUnit("e1", {
    name: "EnemyShaman",
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Enhancement,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents: [
      // Astral Shift: the kit's other defensive, spent
      makeSpellCastEvent(
        "108271",
        at(2),
        "e1",
        "EnemyShaman",
        "e1",
        "EnemyShaman",
      ),
      makeSpellCastEvent(
        BURROW,
        at(20),
        "e1",
        "EnemyShaman",
        "e1",
        "EnemyShaman",
      ),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BURROW,
        at(20),
        "e1",
        "e1",
        "BUFF",
      ),
    ],
  });
  Object.assign(u, {
    castStartEvents:
      barAtS === null
        ? []
        : [
            {
              spellId: "8004",
              spellName: "Healing Surge",
              timestamp: at(barAtS),
              srcUnitId: "e1",
              logLine: { event: "SPELL_CAST_START", timestamp: at(barAtS) },
            },
          ],
    damageIn: [],
  });
  return u;
};
const combatOf = (u: ReturnType<typeof shaman>) =>
  ({ startTime: T0, endTime: at(120), units: { e1: u } }) as never;
const startsOf = (u: ReturnType<typeof shaman>) =>
  computeOffensiveWindowsUncached([u] as never, [], combatOf(u)).map(
    (w) => w.fromSeconds,
  );

describe("T113 — a timed Burrow press ends at its holder's action (B97)", () => {
  it("the shared reading: 22 s", () => {
    const u = shaman(22);
    expect(stealthImmunityPressActionEndS(u, combatOf(u), 20)).toBeCloseTo(22);
  });
  it("the window opens at 22 s, not at the 5 s official length (25 s)", () => {
    const s = startsOf(shaman(22));
    expect(s.some((f) => Math.abs(f - 22) < 0.01)).toBe(true);
    expect(s.some((f) => Math.abs(f - 25) < 0.01)).toBe(false);
  });
  it("no action inside it: the official length stands", () => {
    const u = shaman(null);
    expect(stealthImmunityPressActionEndS(u, combatOf(u), 20)).toBeUndefined();
    expect(startsOf(u).some((f) => Math.abs(f - 25) < 0.01)).toBe(true);
  });
});
