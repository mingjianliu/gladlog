import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitOffListPressEntries } from "../src/context/timelineSections/offListPress";
import { ensureAnalysisData } from "../src/data/ensure";
import { unitCooldownLedger } from "../src/utils/cooldowns";
import {
  extractOffListPresses,
  holdsUnpricedCooldownTalent,
  isLedgerDroppedRosterPress,
  isOffListPressId,
  isRosterPressId,
} from "../src/utils/offListPress";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

/**
 * Pipeline T244 (scan triage 2026-11-22 #12, 62d13045 r3 0:19): a teammate
 * Mistweaver's Transcendence: Transfer printed no line. The Mistweaver save
 * roster strips the catalog's Defensive tag (an escape), the spell has no
 * other tag and leaves the monk's ledger, and the `[PRESS]` fallback asked
 * the hand roster — which still lists it.
 */
const T0 = 1_000_000;
const TRANSFER = "119996";

beforeAll(async () => {
  await ensureAnalysisData();
});

const monk = (spec: CombatUnitSpec) =>
  makeUnit("m", {
    class: CombatUnitClass.Monk,
    spec,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: [makeSpellCastEvent(TRANSFER, T0 + 19_103, "")],
  } as unknown as Parameters<typeof makeUnit>[1]);
const combatOf = (u: ReturnType<typeof makeUnit>) =>
  ({
    startTime: T0,
    endTime: T0 + 120_000,
    units: { [u.id]: u },
  }) as unknown as AtomicArenaCombat;

describe("T244: a roster press the unit's own ledger dropped is the [PRESS] line's", () => {
  it("Transfer is on the hand roster, so the id alone is not off-list", () => {
    expect(isRosterPressId(TRANSFER)).toBe(true);
    expect(isOffListPressId(TRANSFER)).toBe(false);
  });

  it("a Mistweaver's ledger has no Transfer: the press gets its line, with the model's cooldown", () => {
    const u = monk(CombatUnitSpec.Monk_Mistweaver);
    const combat = combatOf(u);
    expect(
      unitCooldownLedger(u, combat).some((cd) => cd.spellId === TRANSFER),
    ).toBe(false);
    expect(isLedgerDroppedRosterPress(u, combat, TRANSFER)).toBe(true);
    const presses = extractOffListPresses([u], combat, T0 + 120_000);
    expect(presses.map((p) => [p.spellId, p.timeSeconds])).toEqual([
      [TRANSFER, 19.103],
    ]);
    expect(presses[0]!.cooldownSeconds).toBe(45);
  });

  it("Escape from Reality: the opener is back when its cooldown is, not `ready again`; the second press is the free one", () => {
    const u = makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      // Escape from Reality 394110: entry 124973 of choice node 101176
      info: {
        talents: [{ id1: 101176, id2: 124973, count: 1 }],
        pvpTalents: [],
      },
      spellCastEvents: [
        makeSpellCastEvent(TRANSFER, T0 + 19_000, ""),
        makeSpellCastEvent(TRANSFER, T0 + 22_000, ""),
        makeSpellCastEvent(TRANSFER, T0 + 80_000, ""),
      ],
    } as unknown as Parameters<typeof makeUnit>[1]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 120_000);
    expect(
      presses.map((p) => [
        p.timeSeconds,
        p.free ?? false,
        p.readyAgainAtSeconds,
      ]),
    ).toEqual([
      [19, false, 64],
      [22, true, 64],
      // no second press: still the cooldown's return, never the press second
      [80, false, 125],
    ]);
  });

  it("Eminence: the model cannot price the cooldown — the press is marked, and the line states neither cooldown nor return", () => {
    const u = makeUnit("m", {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      info: {
        talents: [{ id1: 101176, id2: 124973, count: 1 }],
        pvpTalents: ["353584"],
      },
      spellCastEvents: [
        makeSpellCastEvent(TRANSFER, T0 + 28_000, ""),
        makeSpellCastEvent(TRANSFER, T0 + 33_000, ""),
      ],
    } as unknown as Parameters<typeof makeUnit>[1]);
    expect(holdsUnpricedCooldownTalent(u, TRANSFER)).toBe(true);
    expect(
      holdsUnpricedCooldownTalent(
        monk(CombatUnitSpec.Monk_Mistweaver),
        TRANSFER,
      ),
    ).toBe(false);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 120_000);
    expect(presses.map((p) => [p.cooldownUnpriced, p.free ?? false])).toEqual([
      [true, false],
      [true, true],
    ]);
    const lines: string[] = [];
    emitOffListPressEntries({
      owner: { id: "o", name: "Owner" } as never,
      friends: [u],
      pid: () => "2(MMonk)",
      enemyPid: () => "4(E)",
      addEntry: (_t: number, text: string) => lines.push(text),
      entries: [],
      presses,
    } as never);
    expect(lines).toEqual([
      "0:28  [PRESS]   2(MMonk) (Mistweaver Monk): Transcendence: Transfer",
      "0:33  [PRESS]   2(MMonk) (Mistweaver Monk): Transcendence: Transfer (free press)",
    ]);
  });

  it("a Windwalker keeps Transfer in the ledger ([YOU] / [TEAM] [CD] prints it): no [PRESS]", () => {
    const u = monk(CombatUnitSpec.Monk_Windwalker);
    const combat = combatOf(u);
    expect(
      unitCooldownLedger(u, combat).some((cd) => cd.spellId === TRANSFER),
    ).toBe(true);
    expect(isLedgerDroppedRosterPress(u, combat, TRANSFER)).toBe(false);
    expect(extractOffListPresses([u], combat, T0 + 120_000)).toEqual([]);
  });

  it("a roster press the save roster does not strip is never the fallback's (Fortifying Brew)", () => {
    const u = monk(CombatUnitSpec.Monk_Mistweaver);
    expect(isLedgerDroppedRosterPress(u, combatOf(u), "115203")).toBe(false);
    // a stripped id with another tag (Leg Sweep: Control) stays the
    // ledger's, whatever else dropped its row
    expect(isLedgerDroppedRosterPress(u, combatOf(u), "119381")).toBe(false);
    // nor a trinket, whatever a roster says
    expect(isLedgerDroppedRosterPress(u, combatOf(u), "336126")).toBe(false);
  });
});
