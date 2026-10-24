/**
 * The log-shape matrix (test/support/logShapes.ts) on the readers that the
 * three-week root-cause pass found re-learning the same log facts: aura
 * intervals, the control ledger, the unseen-end reading and the Cyclone
 * walk. Each states what must not change under a shape it is indifferent
 * to, and what bounds it under the one that matters to it.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { damageImmuneControlUpAt } from "../src/analysis/candidates/massDispel";
import { ensureAnalysisData } from "../src/data/ensure";
import { ccFullDurationSeconds } from "../src/data/spellEffectData";
import { buildAuraIntervals } from "../src/utils/auraIntervals";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { unitCooldownAvailableAt } from "../src/utils/cooldowns";
import { untargetableEndS } from "../src/utils/enemyDefensives";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";
import {
  type LogShape,
  lostRemoved,
  NEUTRAL_SHAPES,
} from "./support/logShapes";

const T0 = 1_000_000;
const ms = (s: number) => T0 + s * 1000;
const POLYMORPH = "118";
const BARKSKIN = "22812";
const GREATER_INVIS = "110960";
const CYCLONE = "33786";

/** A Restoration Druid (the owner), an enemy Frost Mage and Balance Druid:
 * a Polymorph on the owner 10–14 s, the owner's Barkskin 20–28 s, the
 * mage's Greater Invisibility from 40 s with no REMOVED (the mage's next
 * own hit at 46 s), the enemy druid's Cyclone on the owner 50–56 s, and
 * steady damage both ways. */
function scenario(): ICombatUnit[] {
  const dmg = (from: string, to: string, s: number) => ({
    ...makeDamageEvent(ms(s), 20_000, to),
    srcUnitId: from,
    srcUnitName: from,
  });
  const owner = makeUnit("p1", {
    name: "Owner",
    spec: CombatUnitSpec.Druid_Restoration,
    reaction: CombatUnitReaction.Friendly,
    info: { teamId: "0" },
    spellCastEvents: [
      makeSpellCastEvent(BARKSKIN, ms(20), "p1", "Owner", "p1", "Owner"),
    ],
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLYMORPH, ms(10), "e1", "p1"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLYMORPH, ms(14), "e1", "p1"),
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BARKSKIN,
        ms(20),
        "p1",
        "p1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BARKSKIN,
        ms(28),
        "p1",
        "p1",
        "BUFF",
      ),
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, CYCLONE, ms(50), "e2", "p1"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, CYCLONE, ms(56), "e2", "p1"),
    ],
    damageOut: [5, 17, 30, 44, 60].map((s) => dmg("p1", "e1", s)),
  } as never);
  const mage = makeUnit("e1", {
    name: "Mage",
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1" },
    spellCastEvents: [
      makeSpellCastEvent(POLYMORPH, ms(10), "p1", "Owner", "e1", "Mage"),
      makeSpellCastEvent(GREATER_INVIS, ms(40), "e1", "Mage", "e1", "Mage"),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        GREATER_INVIS,
        ms(40),
        "e1",
        "e1",
        "BUFF",
      ),
    ],
    damageOut: [3, 9, 25, 46, 58].map((s) => dmg("e1", "p1", s)),
  } as never);
  const druid = makeUnit("e2", {
    name: "Boomkin",
    spec: CombatUnitSpec.Druid_Balance,
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1" },
    spellCastEvents: [
      makeSpellCastEvent(CYCLONE, ms(50), "p1", "Owner", "e2", "Boomkin"),
    ],
  } as never);
  return [owner, mage, druid];
}
const combatOf = (units: ICombatUnit[]) => ({
  startTime: T0,
  endTime: ms(90),
  startInfo: { zoneId: "1672", bracket: "3v3" },
  units: Object.fromEntries(units.map((u) => [u.id, u])),
});
const byId = (units: ICombatUnit[], id: string) =>
  units.find((u) => u.id === id)!;

/** Run `read` on the scenario and on each shape; the shaped reading must
 * equal the plain one. */
function expectIndifferent<T>(
  read: (units: ICombatUnit[]) => T,
  shapes: readonly LogShape[] = NEUTRAL_SHAPES,
) {
  const base = read(scenario());
  for (const shape of shapes)
    expect(read(shape.apply(scenario())), shape.name).toEqual(base);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

describe("log-shape matrix", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  describe("buildAuraIntervals", () => {
    const read = (units: ICombatUnit[]) =>
      buildAuraIntervals(byId(units, "p1"), combatOf(units))
        .map((iv) => `${iv.spellId} ${r2(iv.fromS)}–${r2(iv.toS)}`)
        .sort();
    it("is indifferent to the neutral shapes", () => expectIndifferent(read));
    it("a lost REMOVED ends no later than the aura's official length", () => {
      for (const iv of buildAuraIntervals(
        byId(lostRemoved().apply(scenario()), "p1"),
        combatOf(scenario()),
      )) {
        const full = ccFullDurationSeconds(iv.spellId);
        if (full !== undefined)
          expect(iv.toS - iv.fromS, iv.spellId).toBeLessThanOrEqual(full + 1);
      }
    });
  });

  describe("analyzePlayerCCAndTrinket — the controls on the owner", () => {
    const read = (units: ICombatUnit[]) =>
      analyzePlayerCCAndTrinket(
        byId(units, "p1"),
        [byId(units, "e1"), byId(units, "e2")],
        combatOf(units) as never,
      )
        .ccInstances.map(
          (c) =>
            `${c.spellId} @${Math.floor(c.atSeconds)} ${r2(c.durationSeconds)}s`,
        )
        .sort();
    it("is indifferent to the neutral shapes", () => expectIndifferent(read));
    it("a lost REMOVED never reads a control longer than its full length", () => {
      const units = lostRemoved().apply(scenario());
      for (const c of analyzePlayerCCAndTrinket(
        byId(units, "p1"),
        [byId(units, "e1"), byId(units, "e2")],
        combatOf(units) as never,
      ).ccInstances) {
        const full = ccFullDurationSeconds(c.spellId);
        if (full !== undefined)
          expect(c.durationSeconds, c.spellId).toBeLessThanOrEqual(full + 0.5);
      }
    });
  });

  describe("untargetableEndS — Greater Invisibility with no logged end", () => {
    const read = (units: ICombatUnit[]) => {
      const mage = byId(units, "e1");
      const iv = buildAuraIntervals(mage, combatOf(units)).find(
        (x) => x.spellId === GREATER_INVIS,
      )!;
      return Math.floor(untargetableEndS(mage, iv, T0));
    };
    it("ends at the mage's own next action, whatever the shape", () => {
      expect(read(scenario())).toBe(46);
      expectIndifferent(read);
    });
  });

  describe("damageImmuneControlUpAt — the Cyclone on the owner", () => {
    const read = (units: ICombatUnit[]) =>
      [52, 55, 57, 60].map(
        (s) =>
          damageImmuneControlUpAt(byId(units, "p1"), ms(s), (id) =>
            ccFullDurationSeconds(id),
          ) !== undefined,
      );
    it("is indifferent to the neutral shapes", () => {
      expect(read(scenario())).toEqual([true, true, false, false]);
      expectIndifferent(read);
    });
    it("a lost REMOVED is over at its full length", () => {
      const full = ccFullDurationSeconds(CYCLONE)!;
      const units = lostRemoved([CYCLONE]).apply(scenario());
      const up = (s: number) =>
        damageImmuneControlUpAt(byId(units, "p1"), ms(s), (id) =>
          ccFullDurationSeconds(id),
        ) !== undefined;
      expect(up(50 + full - 0.5)).toBe(true);
      expect(up(50 + full + 0.5)).toBe(false);
    });
  });

  describe("unitCooldownAvailableAt — the owner's Barkskin after its press", () => {
    const read = (units: ICombatUnit[]) =>
      [19, 21, 79, 81].map((s) =>
        unitCooldownAvailableAt(
          byId(units, "p1"),
          combatOf(units) as never,
          BARKSKIN,
          s,
        ),
      );
    it("is indifferent to the neutral shapes", () => {
      const base = read(scenario());
      // ready before the press, then down for its cooldown
      expect(base[0]).toBe(true);
      expect(base[1]).toBe(false);
      expect(base[3]).toBe(true);
      expectIndifferent(read);
    });
  });

  describe("the Solo Shuffle round end inside a control", () => {
    // the round ends at its first death (the enemy druid at 12 s); the log
    // runs on, the Polymorph's REMOVED at 14 s is after it
    const shuffle = (units: ICombatUnit[]) => {
      (
        byId(units, "e2") as unknown as { deathRecords: unknown[] }
      ).deathRecords = [{ timestamp: ms(12) }];
      return {
        units,
        combat: {
          ...combatOf(units),
          startInfo: { zoneId: "1672", bracket: "Rated Solo Shuffle" },
        },
      };
    };
    const controlsEnd = (units: ICombatUnit[]) => {
      const { combat } = shuffle(units);
      return analyzePlayerCCAndTrinket(
        byId(units, "p1"),
        [byId(units, "e1"), byId(units, "e2")],
        combat as never,
      ).ccInstances.map((c) => c.atSeconds + c.durationSeconds);
    };
    it("no control on the owner runs past it, plain or shaped", () => {
      // the Polymorph from 10 s is read, clipped at 12 s
      expect(controlsEnd(scenario())).toEqual([12]);
      for (const shape of [undefined, ...NEUTRAL_SHAPES, lostRemoved()]) {
        const units = shape ? shape.apply(scenario()) : scenario();
        for (const end of controlsEnd(units))
          expect(end, shape?.name ?? "plain").toBeLessThanOrEqual(12.001);
      }
    });
  });
});
