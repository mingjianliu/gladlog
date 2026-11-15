/**
 * T107 (fact13 D20, user ruling R41 "print it"): a spell a friendly Death
 * Knight cast through Dark Simulacrum gets its press line. b8a9f3e3 r0: the
 * Frost DK copied the enemy priest's Pain Suppression and cast it on himself
 * at 0:39.419, the copy buff 77616 coming off in that ms — no line anywhere.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  darkSimulacrumCopyCasts,
  emitDarkSimulacrumPressEntries,
} from "../src/context/timelineSections/friendlyUtilityPress";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;

const dk = (spent: boolean) =>
  makeUnit("p2", {
    name: "DK",
    spec: CombatUnitSpec.DeathKnight_Frost,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [
      makeSpellCastEvent("77606", at(21.467), "e3", "Priest", "p2", "DK"),
      makeSpellCastEvent("33206", at(39.419), "p2", "DK", "p2", "DK"),
      makeSpellCastEvent("49020", at(40), "e1", "Lock", "p2", "DK"),
      makeSpellCastEvent("118", at(50), "e1", "Lock", "p2", "DK"),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "77616",
        at(23.768),
        "e3",
        "p2",
        "BUFF",
      ),
      ...(spent
        ? [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              "77616",
              at(39.419),
              "e3",
              "p2",
              "BUFF",
            ),
            makeAuraEvent(
              LogEvent.SPELL_AURA_APPLIED,
              "77616",
              at(45),
              "e2",
              "p2",
              "BUFF",
            ),
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              "77616",
              at(50.003),
              "e2",
              "p2",
              "BUFF",
            ),
          ]
        : []),
    ],
  });

describe("T107 — a Dark Simulacrum copy's press", () => {
  it("is the cast in the ms its copy buff came off, never Dark Simulacrum or another cast", () => {
    expect(darkSimulacrumCopyCasts(dk(true)).map((c) => c.spellId)).toEqual([
      "33206",
      "118",
    ]);
    expect(darkSimulacrumCopyCasts(dk(false))).toEqual([]);
  });
  it("gets the existing press shapes: [TEAM] [CD] for a wall, [TEAM] [CC] for a control", () => {
    const out: string[] = [];
    const owner = makeUnit("p1", { name: "Me" });
    emitDarkSimulacrumPressEntries({
      owner,
      friends: [owner, dk(true)],
      pid: () => "2(FDKnight)",
      friendlyPid: () => undefined,
      enemyPid: () => "4(DLock)",
      addEntry: (_t: number, l: string) => out.push(l),
      matchStartMs: T0,
    } as unknown as Parameters<typeof emitDarkSimulacrumPressEntries>[0]);
    expect(out).toEqual([
      "0:39  [TEAM] [CD]   2(FDKnight) (Frost Death Knight): Pain Suppression",
      "0:50  [TEAM] [CC]   2(FDKnight) (Frost Death Knight) cast Polymorph → 4(DLock)",
    ]);
  });
});
