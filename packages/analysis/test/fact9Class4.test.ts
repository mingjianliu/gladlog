/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built parse fixtures */
/**
 * fact9 (F24) class 4 — where an aura's span starts and ends:
 *  - D19: an aura first shown in its holder's re-stating batch went up at
 *    its source's logged press on that holder (Life Cocoon on a vanished
 *    rogue: cast 86.07, APPLIED in the batch at 87.45);
 *  - D20: a target out of sight (Vanish) is no control target;
 *  - D26: a channel the log shows on no player ends where the channel did
 *    (Ray of Frost into a Grounding Totem, ended by Ice Lance).
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { buildAuraIntervals } from "../src/utils/auraIntervals";
import { ccTargetBlockerIntervals } from "../src/utils/ccTargetState";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const ms = (s: number) => Math.round(T0 + s * 1000);
const auraRow = (
  event: LogEvent,
  spellId: string,
  src: string,
  dest: string,
  atS: number,
): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
});
const castRow = (
  spellId: string,
  src: string,
  dest: string,
  atS: number,
): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});
const unit = (id: string, over: Record<string, unknown> = {}): any => ({
  id,
  name: id,
  type: 1,
  spec: CombatUnitSpec.Rogue_Assassination,
  class: CombatUnitClass.Rogue,
  reaction: 2,
  info: {},
  spellCastEvents: [],
  auraEvents: [],
  damageOut: [],
  damageIn: [],
  healIn: [],
  healOut: [],
  deathRecords: [],
  advancedActions: [],
  ...over,
});
const combatOf = (...units: any[]): any => ({
  startTime: T0,
  endTime: ms(120),
  units: Object.fromEntries(units.map((u) => [u.id, u])),
  startInfo: { bracket: "3v3" },
});

const COCOON = "116849";
/** six other auras re-stated with the cocoon: the rogue seen again */
const restateBatch = (atS: number) =>
  ["1943", "703", "315496", "360194", "115192", "2823"].map((id) =>
    auraRow(LogEvent.SPELL_AURA_APPLIED, id, "r", "r", atS),
  );

describe("fact9 D19 — a re-stated aura starts at its press", () => {
  it("Life Cocoon cast on a vanished rogue starts at the cast, not at the batch", () => {
    const monk = unit("m", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      class: CombatUnitClass.Monk,
      spellCastEvents: [castRow(COCOON, "m", "r", 86.067)],
    });
    const rogue = unit("r", {
      auraEvents: [
        ...restateBatch(87.446),
        auraRow(LogEvent.SPELL_AURA_APPLIED, COCOON, "m", "r", 87.446),
        auraRow(LogEvent.SPELL_AURA_REMOVED, COCOON, "m", "r", 96.484),
      ],
      // the cocoon absorbed a hit at 87.02, before the batch: it was up
      absorbsIn: [
        { ...auraRow(LogEvent.SPELL_ABSORBED, COCOON, "m", "r", 87.02), absorbedAmount: 50_000 },
      ],
    });
    const [iv] = buildAuraIntervals(rogue, combatOf(monk, rogue)).filter(
      (x) => x.spellId === COCOON,
    );
    expect(iv!.fromS).toBeCloseTo(86.067, 3);
    expect(iv!.toS).toBeCloseTo(96.484, 3);
    expect(iv!.inferredStart).toBe(false);
    // with nothing showing it up before the batch, the batch is its start
    const unproven = unit("r", { auraEvents: rogue.auraEvents });
    const [iv2] = buildAuraIntervals(unproven, combatOf(monk, unproven)).filter(
      (x) => x.spellId === COCOON,
    );
    expect(iv2!.fromS).toBeCloseTo(87.446, 3);
  });
  it("…a REMOVED at the press plus the official length shows it up from the press", () => {
    const monk = unit("m", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      class: CombatUnitClass.Monk,
      spellCastEvents: [castRow(COCOON, "m", "r", 86.067)],
    });
    const rogue = unit("r", {
      auraEvents: [
        ...restateBatch(87.446),
        auraRow(LogEvent.SPELL_AURA_APPLIED, COCOON, "m", "r", 87.446),
        auraRow(LogEvent.SPELL_AURA_REMOVED, COCOON, "m", "r", 98.067),
      ],
    });
    const [iv] = buildAuraIntervals(rogue, combatOf(monk, rogue)).filter(
      (x) => x.spellId === COCOON,
    );
    expect(iv!.fromS).toBeCloseTo(86.067, 3);
  });
  it("…a projectile's control landing in a batch keeps its own instant (codex 20-F24-13 #1)", () => {
    const warrior = unit("w", {
      spec: CombatUnitSpec.Warrior_Arms,
      class: CombatUnitClass.Warrior,
      spellCastEvents: [castRow("107570", "w", "r", 10.0)],
    });
    const rogue = unit("r", {
      auraEvents: [
        ...restateBatch(10.8),
        auraRow(LogEvent.SPELL_AURA_APPLIED, "132169", "w", "r", 10.8),
        auraRow(LogEvent.SPELL_AURA_REMOVED, "132169", "w", "r", 13.8),
      ],
    });
    const [iv] = buildAuraIntervals(rogue, combatOf(warrior, rogue)).filter(
      (x) => x.spellId === "132169",
    );
    expect(iv!.fromS).toBeCloseTo(10.8, 3);
    expect(iv!.toS).toBeCloseTo(13.8, 3);
  });
  it("…a filtered stream reads the batch off the holder's whole stream (codex 20-F24-13 #2)", () => {
    const monk = unit("m", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      class: CombatUnitClass.Monk,
      spellCastEvents: [castRow(COCOON, "m", "r", 86.067)],
    });
    const all = [
      ...restateBatch(87.446),
      auraRow(LogEvent.SPELL_AURA_APPLIED, COCOON, "m", "r", 87.446),
      auraRow(LogEvent.SPELL_AURA_REMOVED, COCOON, "m", "r", 98.067),
    ];
    const rogue = unit("r", { auraEvents: all });
    const only = all.filter((a: any) => a.spellId === COCOON);
    const filtered = (rows?: any[]) =>
      buildAuraIntervals(
        { ...rogue, auraEvents: only },
        combatOf(monk, rogue),
        undefined,
        rows,
      )[0]!.fromS;
    expect(filtered(all)).toBeCloseTo(86.067, 3);
    expect(filtered()).toBeCloseTo(87.446, 3);
  });
  it("…an APPLIED outside a re-stating batch keeps its own instant", () => {
    const monk = unit("m", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      class: CombatUnitClass.Monk,
      spellCastEvents: [castRow(COCOON, "m", "r", 86.067)],
    });
    const rogue = unit("r", {
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, COCOON, "m", "r", 87.446),
        auraRow(LogEvent.SPELL_AURA_REMOVED, COCOON, "m", "r", 96.484),
      ],
    });
    const [iv] = buildAuraIntervals(rogue, combatOf(monk, rogue)).filter(
      (x) => x.spellId === COCOON,
    );
    expect(iv!.fromS).toBeCloseTo(87.446, 3);
  });
  it("…and a press older than the aura's official length is not its start", () => {
    const monk = unit("m", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      class: CombatUnitClass.Monk,
      spellCastEvents: [castRow(COCOON, "m", "r", 60)],
    });
    const rogue = unit("r", {
      auraEvents: [
        ...restateBatch(87.446),
        auraRow(LogEvent.SPELL_AURA_APPLIED, COCOON, "m", "r", 87.446),
        auraRow(LogEvent.SPELL_AURA_REMOVED, COCOON, "m", "r", 96.484),
      ],
    });
    const [iv] = buildAuraIntervals(rogue, combatOf(monk, rogue)).filter(
      (x) => x.spellId === COCOON,
    );
    expect(iv!.fromS).toBeCloseTo(87.446, 3);
  });
});

describe("fact9 D20 — a target gone unseen is no control target", () => {
  it("Vanish blocks Blind to the rogue's first own press after it", () => {
    const rogue = unit("r", {
      spellCastEvents: [
        castRow("1856", "r", "", 108.233),
        castRow("1329", "r", "x", 109.574),
      ],
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, "11327", "r", "r", 108.236),
      ],
    });
    const ivs = ccTargetBlockerIntervals(
      rogue,
      combatOf(rogue),
      "2094",
      "Blind",
    );
    const v = ivs.find((iv) => iv.spellId === "11327");
    expect(v).toBeDefined();
    expect(v!.fromS).toBeCloseTo(108.236, 3);
    expect(v!.toS).toBeCloseTo(109.574, 3);
  });
});

describe("fact9 D26 — a channel's window ends where the channel did", () => {
  it("Ray of Frost into a totem, ended by Ice Lance: the window stops at the Ice Lance", () => {
    const mage = unit("u", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      class: CombatUnitClass.Mage,
      spellCastEvents: [
        castRow("205021", "u", "totem", 79.054),
        castRow("30455", "u", "x", 80.639),
      ],
    });
    const t = reconstructEnemyCDTimeline([mage], combatOf(mage));
    const rof = t.players[0]!.offensiveCDs.find((c) => c.spellId === "205021");
    expect(rof).toBeDefined();
    expect(rof!.buffEndSeconds).toBeCloseTo(80.639, 3);
  });
  it("…a Ray of Frost nothing interrupts keeps its official length", () => {
    const mage = unit("u", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      class: CombatUnitClass.Mage,
      spellCastEvents: [castRow("205021", "u", "totem", 79.054)],
    });
    const t = reconstructEnemyCDTimeline([mage], combatOf(mage));
    const rof = t.players[0]!.offensiveCDs.find((c) => c.spellId === "205021");
    expect(rof!.buffEndSeconds).toBeGreaterThan(82);
  });
});
