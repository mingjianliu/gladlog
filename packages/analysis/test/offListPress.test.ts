/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import trinketItemIds from "../src/data/trinketItemIds.json";
import { unitCooldownEntry } from "../src/utils/cooldowns";
import {
  extractOffListPresses,
  isOffListPressId,
  isRosterPressId,
  lineStatesPress,
  PRESS_LINE_MIN_CD_SECONDS,
  pressLineCaster,
} from "../src/utils/offListPress";
import {
  equippedBadgeCount,
  GLADIATOR_BADGE_SPELL_ID,
} from "../src/utils/trinketType";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("[PRESS] — which presses (GH #176, user ruling 2026-11-02)", () => {
  it("the threshold is 45 s", () => {
    expect(PRESS_LINE_MIN_CD_SECONDS).toBe(45);
  });
  it("an off-roster 45 s button is the line's; a 30 s one, a trinket and a roster button are not", () => {
    expect(isOffListPressId("190784")).toBe(true); // Divine Steed, 45 s
    expect(isOffListPressId("13877")).toBe(false); // Blade Flurry, 30 s
    expect(isOffListPressId("336126")).toBe(false); // Gladiator's Medallion
    expect(isRosterPressId("642")).toBe(true); // Divine Shield
    expect(isOffListPressId("642")).toBe(false);
  });
});

describe("[PRESS] — does a line already state the press", () => {
  it("reads the caster from (by N), N's, [YOU], or the first unit", () => {
    expect(
      pressLineCaster(
        "[CC ON TEAM]   1(AWarrior) ← Sap (by 4(ORogue))",
        "Sap",
        "1",
      ),
    ).toBe("4");
    expect(
      pressLineCaster(
        "[KICK]   4(ORogue) interrupted 2(AMage)'s Arcane Surge",
        "Arcane Surge",
        "1",
      ),
    ).toBe("2");
    expect(
      pressLineCaster(
        "[YOU] [PRESS]   Gladiator's Badge (60s cd)",
        "Gladiator's Badge",
        "1",
      ),
    ).toBe("1");
    expect(
      pressLineCaster(
        "[TEAM] [CD]   2(AMage) (Arcane Mage): Mass Invisibility",
        "Mass Invisibility",
        "1",
      ),
    ).toBe("2");
  });
  it("a press tag naming the spell for that caster states it; another caster's or a damage line does not", () => {
    const team = "[TEAM] [CD]   2(AMage) (Arcane Mage): Mirror Image";
    expect(lineStatesPress(team, "Mirror Image", "2", "1")).toBe(true);
    expect(lineStatesPress(team, "Mirror Image", "3", "1")).toBe(false);
    expect(
      lineStatesPress(
        "[STATE]   friends 2(AMage):90 Mirror Image",
        "Mirror Image",
        "2",
        "1",
      ),
    ).toBe(false);
    expect(
      lineStatesPress(
        "[PRESS]   4(ORogue) (Outlaw Rogue): Sprint (60s cd)",
        "Sprint",
        "4",
        "1",
      ),
    ).toBe(true);
  });
});

describe("a reset between two presses keeps both (Ace Up Your Sleeve, GH #176)", () => {
  const PID = "player-1";
  const T0 = 1_000_000;
  const energize = (spellId: string, atMs: number) => ({
    logLine: {
      event: LogEvent.SPELL_ENERGIZE,
      timestamp: T0 + atMs,
      parameters: [],
    },
    timestamp: T0 + atMs,
    spellId,
    srcUnitId: PID,
    destUnitId: PID,
  });
  const rogue = (actionOut: any[]) =>
    makeUnit(PID, {
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Outlaw,
      // Ace Up Your Sleeve: node 90668
      info: { talents: [{ id1: 90668, id2: 0, count: 2 }], pvpTalents: [] },
      spellCastEvents: [
        makeSpellCastEvent("315341", T0 + 20_000, "e"),
        makeSpellCastEvent("315341", T0 + 20_800, "e"),
      ],
      actionOut,
    });
  const combatOf = (u: any) =>
    ({
      startTime: T0,
      endTime: T0 + 120_000,
      units: { [PID]: u },
    }) as unknown as AtomicArenaCombat;

  it("the proc's energize on the first press: both presses count, the first is ready again at once", () => {
    const u = rogue([energize("394120", 20_000)]);
    const entry = unitCooldownEntry(u, combatOf(u), "315341")!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([20, 20.8]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 120_000);
    expect(presses.map((p) => [p.timeSeconds, p.readyAgainAtSeconds])).toEqual([
      [20, 20],
      [20.8, 65.8],
    ]);
  });
  it("no proc: the two rows 0.8 s apart are one press", () => {
    const u = rogue([]);
    const entry = unitCooldownEntry(u, combatOf(u), "315341")!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([20]);
  });
});

describe("two Gladiator's Badges — two items, a cooldown each (GH #176)", () => {
  const PID = "player-2";
  const T0 = 2_000_000;
  const badges = trinketItemIds.badgeItemIds;
  const eq = (slot12: string, slot13: string) =>
    Array.from({ length: 16 }, (_, i) => ({
      id: i === 12 ? slot12 : i === 13 ? slot13 : "0",
      ilvl: 0,
      enchants: [],
      bonuses: [],
      gems: [],
    }));
  const unit = (equipment: any[], pressS: number[]) =>
    makeUnit(PID, {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [], pvpTalents: [], equipment },
      spellCastEvents: pressS.map((s) =>
        makeSpellCastEvent(GLADIATOR_BADGE_SPELL_ID, T0 + s * 1000, ""),
      ),
    } as any);
  const combatOf = (u: any) =>
    ({
      startTime: T0,
      endTime: T0 + 300_000,
      units: { [PID]: u },
    }) as unknown as AtomicArenaCombat;

  it("reads the badges off the trinket slots", () => {
    expect(equippedBadgeCount(unit(eq(badges[0]!, badges[1]!), []))).toBe(2);
    expect(equippedBadgeCount(unit(eq(badges[0]!, "1"), []))).toBe(1);
    expect(equippedBadgeCount(unit([], []))).toBe(0);
  });

  it("alternating presses 30 s apart: each back when either badge is", () => {
    const u = unit(eq(badges[0]!, badges[1]!), [10, 40, 75]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(
      presses.map((p) => [p.timeSeconds, p.readyAgainAtSeconds, p.equipped]),
    ).toEqual([
      [10, 10, 2], // the other badge in hand
      [40, 70, 2], // both out: the first is back at 70
      [75, 100, 2], // took the first (back at 70); the second back at 100
    ]);
  });

  it("one badge: the plain 60 s", () => {
    const u = unit(eq(badges[0]!, "1"), [10, 75]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(presses.map((p) => [p.readyAgainAtSeconds, p.equipped])).toEqual([
      [70, undefined],
      [135, undefined],
    ]);
  });
});
