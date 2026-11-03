/**
 * fact9 (F24) class 6 — roster / kit:
 *  - D23: Snowdrift 389794 is a Frost Mage control, not a Death Knight's,
 *    and Void Nova 1234195 a Devourer Demon Hunter's, not a Priest's;
 *  - D27: Frozen Orb 198149 (Concentrated Coolness) is a Frozen Orb press;
 *  - D22: Absolute Zero 377048 is ready only when Frostwyrm's Fury is;
 *  - D7 (user ruling 2026-11-03): Dark Harvest is a major offensive cooldown.
 * The corpus checks are `packages/eval/scripts/scan5/fact9g.ts`.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyCdEntries } from "../src/context/timelineSections/enemyCd";
import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import { SpellTag } from "../src/data/spellTypes";
import { canonicalSpellId, extractMajorCooldowns } from "../src/utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import { TALENT_TRIGGERED_CONTROL_BUTTONS } from "../src/utils/healerExposureAnalysis";
import {
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_PRESS_FACT_IDS,
  offensiveEffectCdId,
} from "../src/utils/spellDanger";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const combat = { startTime: T0, endTime: T0 + 300_000, units: {} } as never;
const cast = (spellId: string, s: number) => ({
  spellId,
  spellName: "Frozen Orb",
  srcUnitId: "u",
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});
const mage = (spellCastEvents: unknown[]) =>
  ({
    id: "u",
    name: "Enemy",
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
    spellCastEvents,
    auraEvents: [],
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
  }) as never;
const enemyLines = (enemies: unknown[]) => {
  const lines: string[] = [];
  emitEnemyCdEntries({
    enemyCDTimeline: reconstructEnemyCDTimeline(enemies as never, combat),
    cdPurgeAnnotations: new Map(),
    addEntry: (_t: number, ...l: unknown[]) => {
      lines.push(...(l as string[]));
      return true;
    },
    enemyPid: (n: string) => `5(${n})`,
    matchStartMs: T0,
    matchEndSeconds: 300,
    enemies: enemies as never,
  });
  return lines;
};
const rosterOf = (c: CombatUnitClass) =>
  classMetadata.find((m) => m.unitClass === c)!.abilities;

describe("fact9 D23 — Snowdrift is the Mage's", () => {
  it("in the Mage roster as a control, not the Death Knight's", () => {
    const row = rosterOf(CombatUnitClass.Mage).find(
      (a) => String(a.spellId) === "389794",
    );
    expect(row?.tags).toEqual([SpellTag.Control]);
    expect(
      rosterOf(CombatUnitClass.DeathKnight).some(
        (a) => String(a.spellId) === "389794",
      ),
    ).toBe(false);
  });

  it("Void Nova 1234195 is the Demon Hunter's (Devourer), not the Priest's", () => {
    const row = rosterOf(CombatUnitClass.DemonHunter).find(
      (a) => String(a.spellId) === "1234195",
    );
    expect(row?.tags).toEqual([SpellTag.Control]);
    expect(
      rosterOf(CombatUnitClass.Priest).some(
        (a) => String(a.spellId) === "1234195",
      ),
    ).toBe(false);
  });
});

describe("fact9 D27 — Frozen Orb 198149 is a Frozen Orb press", () => {
  it("one id for the cooldown and its effect", () => {
    expect(canonicalSpellId("198149")).toBe("84714");
    expect(offensiveEffectCdId("198149")).toBe("84714");
  });
  it("an enemy's 198149 press prints its [ENEMY CD] line", () => {
    expect(enemyLines([mage([cast("198149", 42.165)])])).toEqual([
      "0:42  [ENEMY CD]   5(Enemy) (Frost Mage): Frozen Orb",
    ]);
  });
  it("the caster's ledger has its Frozen Orb row (codex 20-F24-15 #1)", () => {
    const rows = extractMajorCooldowns(
      mage([cast("198149", 42.165)]),
      combat,
    ).filter((r) => r.spellId === "84714" || r.spellId === "198149");
    expect(rows.map((r) => [r.spellId, r.spellName, r.casts.length])).toEqual([
      ["84714", "Frozen Orb", 1],
    ]);
  });
});

describe("fact9 D22 — Absolute Zero rides Frostwyrm's Fury", () => {
  it("its button is Frostwyrm's Fury", () => {
    expect(TALENT_TRIGGERED_CONTROL_BUTTONS["377048"]).toEqual(["279302"]);
  });
});

describe("fact9 D7 — Dark Harvest is a major offensive cooldown", () => {
  it("a roster Offensive row and a window member, no longer a press fact", () => {
    const row = rosterOf(CombatUnitClass.Warlock).find(
      (a) => String(a.spellId) === "1257052",
    );
    expect(row?.tags).toEqual([SpellTag.Offensive]);
    expect(OFFENSIVE_CD_SPELL_IDS.has("1257052")).toBe(true);
    expect(OFFENSIVE_PRESS_FACT_IDS.has("1257052")).toBe(false);
  });
});
