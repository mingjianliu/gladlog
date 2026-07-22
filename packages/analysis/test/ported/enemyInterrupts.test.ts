import {
  CombatUnitClass,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { computeEnemyInterruptAvailability } from "../../src/utils/enemyInterrupts";

function makeEnemy(
  name: string,
  unitClass: CombatUnitClass,
  spec: CombatUnitSpec,
  interruptCasts: Array<{ spellId: string; timestamp: number }> = [],
): ICombatUnit {
  return {
    name,
    class: unitClass,
    spec,
    spellCastEvents: interruptCasts.map((c) => ({
      spellId: c.spellId,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: c.timestamp },
    })),
  } as unknown as ICombatUnit;
}

describe("computeEnemyInterruptAvailability (B128)", () => {
  it("reports an interrupt as ready when it was never cast", () => {
    const rogue = makeEnemy(
      "Rogue1",
      CombatUnitClass.Rogue,
      CombatUnitSpec.Rogue_Assassination,
    );
    const [state] = computeEnemyInterruptAvailability([rogue], 30_000);
    expect(state.spellName).toBe("Kick");
    expect(state.cdRemainingSeconds).toBe(0);
  });

  it("reports remaining cooldown after a recent interrupt cast (Kick = 15s CD)", () => {
    // Kick cast at 20s, queried at 25s → 15 - 5 = 10s remaining.
    const rogue = makeEnemy(
      "Rogue1",
      CombatUnitClass.Rogue,
      CombatUnitSpec.Rogue_Assassination,
      [{ spellId: "1766", timestamp: 20_000 }],
    );
    const [state] = computeEnemyInterruptAvailability([rogue], 25_000);
    expect(state.cdRemainingSeconds).toBe(10);
  });

  it("reports ready again once the cooldown has fully elapsed", () => {
    const mage = makeEnemy(
      "Mage1",
      CombatUnitClass.Mage,
      CombatUnitSpec.Mage_Frost,
      [
        { spellId: "2139", timestamp: 10_000 }, // Counterspell, 25s CD
      ],
    );
    const [state] = computeEnemyInterruptAvailability([mage], 40_000); // 30s later > 25s CD
    expect(state.spellName).toBe("Counterspell");
    expect(state.cdRemainingSeconds).toBe(0);
  });

  it("picks the spec-correct Hunter interrupt (Survival = Muzzle, others = Counter Shot)", () => {
    const surv = makeEnemy(
      "H1",
      CombatUnitClass.Hunter,
      CombatUnitSpec.Hunter_Survival,
    );
    const bm = makeEnemy(
      "H2",
      CombatUnitClass.Hunter,
      CombatUnitSpec.Hunter_BeastMastery,
    );
    const [sState] = computeEnemyInterruptAvailability([surv], 10_000);
    const [bState] = computeEnemyInterruptAvailability([bm], 10_000);
    expect(sState.spellName).toBe("Muzzle");
    expect(bState.spellName).toBe("Counter Shot");
  });

  it("omits classes/specs with no interrupt (Disc/Holy Priest)", () => {
    const disc = makeEnemy(
      "P1",
      CombatUnitClass.Priest,
      CombatUnitSpec.Priest_Discipline,
    );
    const shadow = makeEnemy(
      "P2",
      CombatUnitClass.Priest,
      CombatUnitSpec.Priest_Shadow,
    );
    expect(computeEnemyInterruptAvailability([disc], 10_000)).toHaveLength(0);
    expect(
      computeEnemyInterruptAvailability([shadow], 10_000)[0].spellName,
    ).toBe("Silence");
  });

  it("picks the spec-correct Monk interrupt (Mistweaver has none, Windwalker/Brewmaster have Spear Hand Strike)", () => {
    const mw = makeEnemy(
      "M1",
      CombatUnitClass.Monk,
      CombatUnitSpec.Monk_Mistweaver,
    );
    const ww = makeEnemy(
      "M2",
      CombatUnitClass.Monk,
      CombatUnitSpec.Monk_Windwalker,
    );
    const brm = makeEnemy(
      "M3",
      CombatUnitClass.Monk,
      CombatUnitSpec.Monk_BrewMaster,
    );
    expect(computeEnemyInterruptAvailability([mw], 10_000)).toHaveLength(0);
    expect(computeEnemyInterruptAvailability([ww], 10_000)[0].spellName).toBe(
      "Spear Hand Strike",
    );
    expect(computeEnemyInterruptAvailability([brm], 10_000)[0].spellName).toBe(
      "Spear Hand Strike",
    );
  });
});
