/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T10 (user ruling 2026-10-10): a kick lockout stops only the spells of
 * the school it locked. Shape: 92-4-492 @82 — a Fire Mage's Polymorph
 * (Arcane) is Counterspelled at 1:20, they are at 17 % two seconds later, and
 * Ice Block (Frost) was castable the whole time.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { spellSchoolMask } from "../src/data/spellSchools";
import {
  actWindowFor,
  intervalBlocksSpell,
  lockedSchoolsText,
  namedCannotCastIntervals,
} from "../src/utils/cannotCastIntervals";

const T0 = 1_000_000;
const POLYMORPH = "118"; // Arcane
const ICE_BLOCK = "45438"; // Frost
const ARCANE_INTELLECT_LIKE = "1953"; // Blink — Arcane
const COUNTERSPELL = "2139";
const enemyIds = new Set(["e"]);
const kicked = (atS: number, interrupted = POLYMORPH) =>
  ({
    id: "u",
    name: "Mage",
    auraEvents: [],
    spellCastEvents: [],
    deathRecords: [],
    actionIn: [
      {
        logLine: {
          event: LogEvent.SPELL_INTERRUPT,
          timestamp: T0 + atS * 1000,
        },
        timestamp: T0 + atS * 1000,
        spellId: COUNTERSPELL,
        extraSpellId: interrupted,
        srcUnitId: "e",
        destUnitId: "u",
      },
    ],
  }) as any;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("a kick lockout by school (FT-T10)", () => {
  it("the official schools the test stands on", () => {
    expect(spellSchoolMask(POLYMORPH)).toBe(64);
    expect(spellSchoolMask(ICE_BLOCK)).toBe(16);
    expect(spellSchoolMask(ARCANE_INTELLECT_LIKE)).toBe(64);
  });

  it("the lockout carries the interrupted spell's schools and stops only spells inside them", () => {
    const [lock] = namedCannotCastIntervals(kicked(80), enemyIds);
    expect(lock).toMatchObject({ lockout: true, lockedSchoolMask: 64 });
    expect(intervalBlocksSpell(lock!, ARCANE_INTELLECT_LIKE)).toBe(true);
    expect(intervalBlocksSpell(lock!, ICE_BLOCK)).toBe(false);
    // unasked, or a school unknown on either side: it blocks (the exemption stays)
    expect(intervalBlocksSpell(lock!, undefined)).toBe(true);
    expect(intervalBlocksSpell(lock!, "999999999")).toBe(true);
    expect(intervalBlocksSpell({ lockout: true }, ICE_BLOCK)).toBe(true);
    // an aura (hard CC, silence) is not a school lock
    expect(intervalBlocksSpell({ lockout: false }, ICE_BLOCK)).toBe(true);
    expect(lockedSchoolsText(64)).toBe(" (Arcane)");
    expect(lockedSchoolsText(36)).toBe(" (Fire/Shadow)");
    expect(lockedSchoolsText(undefined)).toBe("");
  });

  it("couldRespond asked for a cooldown; stateIn counts free time against the named cooldowns", () => {
    const act = actWindowFor(kicked(80), enemyIds, T0);
    // the window [80.5, 87] sits inside the lockout (Counterspell locks for several seconds)
    const lockEndS =
      (namedCannotCastIntervals(kicked(80), enemyIds)[0]!.to - T0) / 1000;
    expect(lockEndS).toBeGreaterThan(84);
    const toS = Math.min(lockEndS, 86);
    expect(act.couldRespond(80.5, toS)).toBe(false);
    expect(act.couldRespond(80.5, toS, ARCANE_INTELLECT_LIKE)).toBe(false);
    expect(act.couldRespond(80.5, toS, ICE_BLOCK)).toBe(true);
    const generic = act.stateIn(80.5, toS, 82)!;
    expect(generic.freeAfterS).toBeCloseTo(0, 5);
    expect(generic.blocks[0]).toMatchObject({
      lockout: true,
      lockedSchoolMask: 64,
    });
    expect(act.stateIn(80.5, toS, 82, [ICE_BLOCK])!.freeAfterS).toBeCloseTo(
      toS - 82,
      5,
    );
    // every named cooldown inside the lock: no free time
    expect(
      act.stateIn(80.5, toS, 82, [ARCANE_INTELLECT_LIKE])!.freeAfterS,
    ).toBeCloseTo(0, 5);
  });
});
