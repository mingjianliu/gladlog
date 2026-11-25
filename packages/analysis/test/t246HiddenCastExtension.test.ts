import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { TOOLTIP_PER_EVENT_DURATIONS } from "../src/data/talentDurationTooltips";
import {
  buffFullDurationForCaster,
  HIDDEN_CAST_EFFECT_WINDOW_MS,
  hiddenCastRows,
} from "../src/utils/buffDuration";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

/**
 * Pipeline T246 (scan triage 2026-11-22 #18): `lasts 17s` on a Spiritwalker's
 * Grace that ran 19.0 s. Spiritwalker's Momentum adds a second per cast-time
 * spell, and the game makes such casts with no SPELL_CAST_SUCCESS row —
 * Ascendance's Lava Burst volley (f85431cc r1 0:34), a Lava Burst that also
 * flies at a second enemy (c5b55e06), the second ally of a Healing Wave
 * (7f107afb). Their effect rows are the evidence; each is a cast made at the
 * time of the press that sent it.
 */
const T0 = 1_000_000;
const GRACE = "79206";
const AEGIS = "378078";
// Spiritwalker's Momentum 443425: entry 117458 of node 94861
const MOMENTUM = { id1: 94861, id2: 117458, count: 1 };
const LAVA_BURST = "51505";
const LAVA_BURST_HIT = "285452";
const HEALING_WAVE = "77472";
const ASCENDANCE = "114050";

beforeAll(async () => {
  await ensureAnalysisData();
});

/** [effect id, seconds after T0, the unit it landed on] */
type Row = [string, number, string?];
const row = (event: string, [spellId, s, dest]: Row, line: number) => ({
  spellId,
  srcUnitId: "s",
  destUnitId: dest ?? "e",
  logLine: { event, timestamp: T0 + s * 1000, lineIndex: line },
});
const shaman = (
  spec: CombatUnitSpec,
  /** [cast id, seconds after T0, target] — the aura itself goes on at T0 */
  casts: Row[],
  out: { damage?: Row[]; heal?: Row[] },
) =>
  makeUnit("s", {
    spec,
    info: { talents: [MOMENTUM], pvpTalents: [] },
    spellCastEvents: casts
      .slice()
      .sort((x, y) => x[1] - y[1])
      .map(([id, s, dest]) =>
        makeSpellCastEvent(id, T0 + s * 1000, dest ?? "e"),
      ),
    damageOut: (out.damage ?? []).map((r, i) =>
      row("SPELL_DAMAGE", r, 1_000_000 + i),
    ),
    healOut: (out.heal ?? []).map((r, i) =>
      row("SPELL_HEAL", r, 2_000_000 + i),
    ),
  } as unknown as Parameters<typeof makeUnit>[1]);
const EFFECTS = (() => {
  const p = TOOLTIP_PER_EVENT_DURATIONS[GRACE]!;
  if (p.event !== "press" || !p.hiddenCastEffects) throw new Error("table");
  return p.hiddenCastEffects;
})();
const hiddenAt = (u: ReturnType<typeof makeUnit>) =>
  hiddenCastRows(u, EFFECTS).map((r) => (r.logLine.timestamp - T0) / 1000);

describe("T246: casts the log shows only by their effect extend Spiritwalker's Grace", () => {
  it("the rows read are the table's, and both auras read the same ones", () => {
    expect(EFFECTS).toEqual({
      [LAVA_BURST_HIT]: { castId: LAVA_BURST, otherTriggerIds: [ASCENDANCE] },
      [HEALING_WAVE]: { castId: HEALING_WAVE },
    });
    const aegis = TOOLTIP_PER_EVENT_DURATIONS[AEGIS]!;
    expect(aegis.event === "press" && aegis.hiddenCastEffects).toBe(EFFECTS);
    expect(HIDDEN_CAST_EFFECT_WINDOW_MS).toBe(4000);
  });

  it("f85431cc 0:34: Ascendance's volley of six, then one logged Lava Burst — Aegis 9 s, Grace 19 s", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [GRACE, 0, ""],
        [ASCENDANCE, 0.353, "e"],
        [LAVA_BURST, 2.357, "e"],
      ],
      {
        damage: [
          [LAVA_BURST_HIT, 0.465, "e"],
          [LAVA_BURST_HIT, 0.516, "e2"],
          [LAVA_BURST_HIT, 0.613, "p1"],
          [LAVA_BURST_HIT, 0.613, "p2"],
          [LAVA_BURST_HIT, 0.816, "p3"],
          [LAVA_BURST_HIT, 0.987, "e3"],
          // the logged cast's own hit
          [LAVA_BURST_HIT, 2.452, "e"],
        ],
      },
    );
    // six casts made when Ascendance was pressed, none for the logged cast
    expect(hiddenAt(u)).toEqual([0.353, 0.353, 0.353, 0.353, 0.353, 0.353]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(9);
    expect(buffFullDurationForCaster(GRACE, u, T0)).toBe(19);
  });

  it("cf909ac1 2:10: two logged Lava Bursts 1.8 s apart, each with its one hit — no hidden cast (Aegis 8 s, not 9)", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Restoration,
      [
        [GRACE, 0, ""],
        [HEALING_WAVE, 1.095, "s"],
        [LAVA_BURST, 3.62, "e"],
        [LAVA_BURST, 5.455, "e"],
      ],
      {
        heal: [[HEALING_WAVE, 1.095, "s"]],
        damage: [
          [LAVA_BURST_HIT, 3.939, "e"],
          [LAVA_BURST_HIT, 5.711, "e"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(8);
  });

  it("c5b55e06: one Lava Burst that also lands on a second enemy is two casts (Aegis 7 s)", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [GRACE, 0, ""],
        [LAVA_BURST, 0.566, "e"],
      ],
      {
        damage: [
          // the second enemy's lands first
          [LAVA_BURST_HIT, 1.027, "e2"],
          [LAVA_BURST_HIT, 1.292, "e"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([0.566]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(7);
  });

  it("c5b55e06 r4 2:13: a volley sent before the aura went on extends nothing, wherever its hits land", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [ASCENDANCE, -0.556, "e"],
        [GRACE, 0, ""],
        [LAVA_BURST, 2, "e"],
      ],
      {
        damage: [
          [LAVA_BURST_HIT, -0.3, "e"],
          [LAVA_BURST_HIT, -0.1, "e2"],
          // in flight when the aura went on
          [LAVA_BURST_HIT, 0.049, "e3"],
          [LAVA_BURST_HIT, 2.3, "e"],
          [LAVA_BURST_HIT, 2.35, "e2"],
          [LAVA_BURST_HIT, 2.4, "e3"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([-0.556, -0.556, -0.556, 2, 2]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(8);
  });

  it("7f107afb: a Healing Wave that heals a second ally is two casts — two presses, two hidden, not three", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Restoration,
      [
        [GRACE, 0, ""],
        [HEALING_WAVE, 2.0, "a"],
        [HEALING_WAVE, 3.6, "a"],
      ],
      {
        heal: [
          [HEALING_WAVE, 2.0, "a"],
          [HEALING_WAVE, 2.014, "b"],
          [HEALING_WAVE, 3.6, "a"],
          [HEALING_WAVE, 3.61, "b"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([2, 3.6]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(9);
    expect(buffFullDurationForCaster(GRACE, u, T0)).toBe(19);
  });

  it("17664ae3 r3: a reflected Lava Burst lands on the shaman — that row is the cast's own, the miss on a second enemy the only hidden cast", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [GRACE, 0, ""],
        [LAVA_BURST, 2.238, "e"],
      ],
      { damage: [[LAVA_BURST_HIT, 2.238, "s"]] },
    );
    (u as unknown as { missesOut: unknown[] }).missesOut = [
      row("SPELL_MISSED", [LAVA_BURST_HIT, 2.701, "e2"], 3_000_000),
    ];
    expect(hiddenAt(u)).toEqual([2.238]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(7);
  });

  it("fc7fb5fb r1 1:14: a heal logged 1 ms ahead of its own cast row is that cast's (Aegis 7 s, not 8)", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Restoration,
      [
        [GRACE, 0, ""],
        [HEALING_WAVE, 1.5, "s"],
        [HEALING_WAVE, 3.2, "s"],
      ],
      {
        heal: [
          [HEALING_WAVE, 1.5, "s"],
          [HEALING_WAVE, 3.199, "s"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(7);
  });

  it("baf8a7df r1 0:41: a second-enemy hit belongs to the cast whose own row landed beside it — pressed before the aura (Aegis 7 s, not 8)", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [LAVA_BURST, -0.174, "e"],
        [GRACE, 0, ""],
        [LAVA_BURST, 0.197, "e"],
        [LAVA_BURST, 2.663, "e"],
      ],
      {
        damage: [
          [LAVA_BURST_HIT, 0.182, "e2"],
          [LAVA_BURST_HIT, 0.259, "e"],
          // after the second press, 60 ms after the first cast's own row
          [LAVA_BURST_HIT, 0.319, "e3"],
          [LAVA_BURST_HIT, 0.584, "e"],
          [LAVA_BURST_HIT, 3.082, "e"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([-0.174, -0.174]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(7);
  });

  it("2cd6b75d r1 6:37: Ascendance logged just ahead of the aura's APPLIED row, one millisecond — its volley is inside the run (Aegis 9 s, not 5)", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [ASCENDANCE, 0, "e"],
        [GRACE, 0, ""],
      ],
      {
        damage: [
          [LAVA_BURST_HIT, 0.272, "e"],
          [LAVA_BURST_HIT, 0.31, "e2"],
          [LAVA_BURST_HIT, 0.4, "e3"],
          [LAVA_BURST_HIT, 0.551, "p1"],
        ],
      },
    );
    // the APPLIED row is logged after the Ascendance cast row
    (u as unknown as { auraEvents: unknown[] }).auraEvents = [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, AEGIS, T0, "s", "s", "BUFF"),
    ];
    expect(hiddenAt(u)).toEqual([0, 0, 0, 0]);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(9);
  });

  it("a hit that landed before a press is not that press's, however close (the 50 ms lead pairs a cast with its own row only)", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [LAVA_BURST, -1, "e"],
        [GRACE, 0, ""],
        [LAVA_BURST, 0.015, "e"],
      ],
      {
        damage: [
          [LAVA_BURST_HIT, -0.8, "e"],
          // the first cast's second enemy, 40 ms before the second press
          [LAVA_BURST_HIT, -0.025, "e2"],
          [LAVA_BURST_HIT, 0.165, "e"],
        ],
      },
    );
    expect(hiddenAt(u)).toEqual([-1]);
    expect(buffFullDurationForCaster(GRACE, u, T0)).toBe(16);
    expect(buffFullDurationForCaster(AEGIS, u, T0)).toBe(6);
  });

  it("a hit that lands late is still its own cast's: one press, 16 s", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [GRACE, 0, ""],
        [LAVA_BURST, 2.4, "e"],
      ],
      { damage: [[LAVA_BURST_HIT, 5.0, "e"]] },
    );
    expect(hiddenAt(u)).toEqual([]);
    expect(buffFullDurationForCaster(GRACE, u, T0)).toBe(16);
  });

  it("a row no press of the unit accounts for is not read", () => {
    const u = shaman(CombatUnitSpec.Shaman_Elemental, [[GRACE, 0, ""]], {
      damage: [[LAVA_BURST_HIT, 3, "e"]],
    });
    expect(hiddenAt(u)).toEqual([]);
    expect(buffFullDurationForCaster(GRACE, u, T0)).toBe(15);
  });

  it("a pet's or another unit's row merged into the list is not the shaman's cast", () => {
    const u = shaman(
      CombatUnitSpec.Shaman_Elemental,
      [
        [GRACE, 0, ""],
        [ASCENDANCE, 0.5, "e"],
      ],
      {},
    );
    (u as unknown as { damageOut: unknown[] }).damageOut = [
      {
        ...row(LogEvent.SPELL_DAMAGE, [LAVA_BURST_HIT, 1, "e"], 5),
        srcUnitId: "pet",
      },
    ];
    expect(buffFullDurationForCaster(GRACE, u, T0)).toBe(15);
  });
});
