/**
 * `[BURST ANSWERED]` context lines (GH #60 follow-up, 2026-09-01).
 *
 * Two halves, matching the two halves of the feature:
 *  1. the pure renderer/selector, fed hand-built decision points — cap,
 *     selection order, the ≤60% door, the responded+feasible gate and the
 *     died-anyway suffix;
 *  2. an end-to-end case on a real hand-built combat, which is where the
 *     shared-predicate claim gets pinned: the HP the line prints must equal
 *     `gridHpPct` at the second the line's own engine field names — the
 *     `[STATE]` tick's sampler and radius, not a raw sample.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  type BurstWindowDecisionPoint,
  burstWindowDecisionPoints,
} from "../analysis/burstWindowDecisionPoints";
import { ensureAnalysisData } from "../data/ensure";
import { gridHpPct } from "../utils/cooldowns";
import {
  BURST_ANSWERED_CAP,
  BURST_ANSWERED_MAX_HP_PCT,
  BURST_ANSWERED_TAG,
  formatBurstAnsweredLines,
} from "./burstAnswered";

// ── part 1: the renderer, on injected decision points ───────────────────────

const point = (
  over: Partial<BurstWindowDecisionPoint> = {},
): BurstWindowDecisionPoint =>
  ({
    tMs: 0,
    tSec: 40,
    endSec: 55,
    durationSec: 15,
    leadCd: {
      spellId: "360194",
      spellName: "Deathmark",
      casterName: "Rogue-R",
      casterSpec: "Assassination Rogue",
      castSec: 40,
    },
    extraCds: [],
    casterIds: ["e1"],
    pressured: {
      unitId: "f2",
      name: "Mate-R",
      minHpPct: 31,
      minHpSec: 45,
      startHpPct: 92,
      startHpSec: 40,
      died: false,
    },
    responses: {
      wall: false,
      external: true,
      healCd: false,
      control: false,
      kite: false,
    },
    responded: true,
    firstResponseSec: 2.4,
    responseCasts: [
      {
        category: "external",
        spellId: "33206",
        spellName: "Pain Suppression",
        casterName: "Me-R",
        tSec: 42,
        latencySec: 2.4,
      },
    ],
    feasible: true,
    feasibleUnits: ["Me-R"],
    triaged: true,
    anyFriendlyDeath: false,
    deathsInWindow: 0,
    minFriendlyHpPct: 31,
    friendlyOutcomes: [],
    ...over,
  }) as BurstWindowDecisionPoint;

describe("formatBurstAnsweredLines — which windows earn a credit line", () => {
  it("renders a feasible, answered, dangerous window", () => {
    const out = formatBurstAnsweredLines([point()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.atSeconds).toBe(40);
    expect(out[0]!.line).toBe(
      `${BURST_ANSWERED_TAG}   enemy opened Deathmark (Assassination Rogue Rogue-R): ` +
        `Me-R answered with Pain Suppression in 2.4s; Mate-R bottomed at 31%`,
    );
  });

  it("an UNANSWERED window never renders — that is the candidate's half", () => {
    expect(
      formatBurstAnsweredLines([
        point({ responded: false, responseCasts: [] }),
      ]),
    ).toEqual([]);
  });

  it("an INFEASIBLE window never renders — the same gate the candidate uses", () => {
    expect(formatBurstAnsweredLines([point({ feasible: false })])).toEqual([]);
  });

  it("a kite-only answer renders nothing: no cast means no 'answered with X' sentence", () => {
    expect(
      formatBurstAnsweredLines([
        point({
          responseCasts: [],
          firstResponseSec: null,
          responses: {
            wall: false,
            external: false,
            healCd: false,
            control: false,
            kite: true,
          },
        }),
      ]),
    ).toEqual([]);
  });

  it(`a harmless window (min HP above ${BURST_ANSWERED_MAX_HP_PCT}%) is not worth crediting`, () => {
    const justOver = point({
      pressured: {
        ...point().pressured!,
        minHpPct: BURST_ANSWERED_MAX_HP_PCT + 1,
      },
    });
    const onTheLine = point({
      pressured: { ...point().pressured!, minHpPct: BURST_ANSWERED_MAX_HP_PCT },
    });
    expect(formatBurstAnsweredLines([justOver])).toEqual([]);
    expect(formatBurstAnsweredLines([onTheLine])).toHaveLength(1);
  });

  it("a window with no HP sample for the pressured friendly is not credited", () => {
    expect(
      formatBurstAnsweredLines([
        point({ pressured: { ...point().pressured!, minHpPct: null } }),
      ]),
    ).toEqual([]);
    expect(formatBurstAnsweredLines([point({ pressured: null })])).toEqual([]);
  });
});

describe("formatBurstAnsweredLines — cap and selection order", () => {
  const mk = (tSec: number, minHpPct: number, anyFriendlyDeath = false) =>
    point({
      tSec,
      leadCd: { ...point().leadCd, castSec: tSec },
      anyFriendlyDeath,
      pressured: { ...point().pressured!, minHpPct, minHpSec: tSec + 3 },
    });

  it(`renders at most ${BURST_ANSWERED_CAP} per round`, () => {
    const out = formatBurstAnsweredLines([
      mk(10, 55),
      mk(20, 50),
      mk(30, 45),
      mk(40, 40),
    ]);
    expect(out).toHaveLength(BURST_ANSWERED_CAP);
  });

  it("selects by danger — a death in the window outranks a deeper HP dip", () => {
    // the 8% window has the lowest HP but no death; the 52% one has a death
    const out = formatBurstAnsweredLines([
      mk(10, 8),
      mk(20, 52, true),
      mk(30, 20),
    ]);
    expect(out.map((e) => e.atSeconds)).toEqual([10, 20]);
    // …and 30 (min HP 20, no death) lost to 20 (min HP 52, death)
    expect(out.map((e) => e.atSeconds)).not.toContain(30);
  });

  it("selects the deepest HP dips when no window carried a death", () => {
    const out = formatBurstAnsweredLines([mk(10, 55), mk(20, 12), mk(30, 30)]);
    expect(out.map((e) => e.atSeconds)).toEqual([20, 30]);
  });

  it("EMITS in time order even though it SELECTS by danger", () => {
    const out = formatBurstAnsweredLines([mk(10, 50), mk(20, 12)]);
    expect(out.map((e) => e.atSeconds)).toEqual([10, 20]);
  });
});

describe("formatBurstAnsweredLines — wording", () => {
  it("appends the died-anyway suffix when the pressured friendly died", () => {
    const out = formatBurstAnsweredLines([
      point({
        anyFriendlyDeath: true,
        pressured: { ...point().pressured!, died: true, minHpPct: 4 },
      }),
    ]);
    expect(out[0]!.line).toContain("Mate-R bottomed at 4% — Mate-R still died");
  });

  it("does not append the suffix when a DIFFERENT friendly died", () => {
    const out = formatBurstAnsweredLines([
      point({ anyFriendlyDeath: true, deathsInWindow: 1 }),
    ]);
    expect(out[0]!.line).not.toContain("still died");
  });

  it("lists only the extra CDs cast inside the response horizon", () => {
    const out = formatBurstAnsweredLines([
      point({
        extraCds: [
          { ...point().leadCd, spellName: "Recklessness", castSec: 44 },
          // 21s later — a different exchange, must not read as co-opened
          { ...point().leadCd, spellName: "Trueshot", castSec: 61 },
        ],
      }),
    ]);
    expect(out[0]!.line).toContain("enemy opened Deathmark (+Recklessness) (");
    expect(out[0]!.line).not.toContain("Trueshot");
  });

  it("writes a pre-wall as 'before it opened', never as a negative latency", () => {
    const out = formatBurstAnsweredLines([
      point({
        responseCasts: [
          { ...point().responseCasts[0]!, latencySec: -1.1, tSec: 39 },
        ],
      }),
    ]);
    expect(out[0]!.line).toContain(
      "answered with Pain Suppression 1.1s before it opened;",
    );
    expect(out[0]!.line).not.toContain("-1.1");
  });
});

// ── part 2: end-to-end, on a hand-built combat ──────────────────────────────

const T0 = 1_000_000;
/** Adrenaline Rush — the corpus' most common solo burst opener. */
const AR = "13750";
/** Ironbark — a `bigDefensiveSpellIds` personal wall, i.e. a `wall` answer. */
const BARKSKIN = "102342";

const cast = (spellId: string, tSec: number, destUnitId?: string) => ({
  spellId,
  spellName: spellId,
  timestamp: T0 + tSec * 1000,
  destUnitId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + tSec * 1000 },
});
const hp = (tSec: number, cur: number, actorId: string, max = 100) => ({
  timestamp: T0 + tSec * 1000,
  logLine: { timestamp: T0 + tSec * 1000 },
  advancedActorId: actorId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: max,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});
const dmg = (tSec: number, amount: number) => ({
  timestamp: T0 + tSec * 1000,
  srcUnitId: "E1",
  amount: -amount,
  effectiveAmount: -amount,
  logLine: { timestamp: T0 + tSec * 1000 },
});
function unit(over: Record<string, unknown> = {}) {
  return {
    id: "F1",
    name: "Friend-R",
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Restoration,
    info: { teamId: "0", specId: "105" },
    advancedActions: [],
    damageIn: [],
    healIn: [],
    healOut: [],
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    ...over,
  };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("[BURST ANSWERED] — HP comes from the [STATE] tick's own sampler", () => {
  it("the printed percentage equals gridHpPct at the second the engine names", () => {
    // HP walks 90 → 30 across the window, so the minimum is unambiguous and
    // a raw (non-grid) sample would land on a different number.
    const hpSamples = [];
    for (let s = 0; s <= 40; s++) {
      hpSamples.push(hp(s, s >= 10 && s <= 20 ? 90 - (s - 10) * 6 : 90, "F1"));
    }
    const damageIn = [];
    for (let s = 10; s < 20; s++) damageIn.push(dmg(s, 6));
    const f = unit({
      advancedActions: hpSamples,
      damageIn,
      spellCastEvents: [cast(BARKSKIN, 12, "F1")],
    });
    const e = unit({
      id: "E1",
      name: "Enemy-R",
      reaction: CombatUnitReaction.Hostile,
      info: { teamId: "1", specId: "260" },
      spellCastEvents: [cast(AR, 10)],
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 240_000,
      units: { F1: f, E1: e },
      startInfo: { bracket: "3v3" },
    };

    const pts = burstWindowDecisionPoints(combat);
    expect(pts).toHaveLength(1);
    const p = pts[0]!;
    expect(p.responded).toBe(true);

    const lines = formatBurstAnsweredLines(pts);
    expect(lines).toHaveLength(1);

    // The claim: the number in the text is the [STATE] tick's own reading at
    // the whole second `minHpSec` names — recomputed here through the SAME
    // exported sampler, not re-derived from the raw advancedActions.
    const fromStateSampler = gridHpPct(
      f as never,
      T0 + p.pressured!.minHpSec! * 1000,
    );
    expect(fromStateSampler).not.toBeNull();
    expect(p.pressured!.minHpPct).toBe(Math.round(fromStateSampler!));
    expect(lines[0]!.line).toContain(`bottomed at ${p.pressured!.minHpPct}%`);
    // and the line sits on the window-start second `fmtTime` will display
    expect(lines[0]!.atSeconds).toBe(p.tSec);
    expect(Number.isInteger(lines[0]!.atSeconds)).toBe(true);
  });
});
