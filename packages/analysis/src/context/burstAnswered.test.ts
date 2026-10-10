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
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  aimedControlUpAt,
  type BurstWindowDecisionPoint,
  burstWindowDecisionPoints,
} from "../analysis/burstWindowDecisionPoints";
import { ensureAnalysisData } from "../data/ensure";
import { gridHpPct } from "../utils/cooldowns";
import {
  BURST_ANSWERED_CAP,
  BURST_ANSWERED_CONTROL_LEGEND,
  BURST_ANSWERED_MAX_HP_PCT,
  BURST_ANSWERED_TAG,
  ccSpanLookup,
  formatBurstAnsweredLines,
  parseBurstAnsweredLine,
} from "./burstAnswered";
import { buildMatchTimeline } from "./matchTimeline";

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
      attackerMoved: false,
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
        `Me-R answered with Pain Suppression in 2.4s; Mate-R bottomed at 31% at 0:45`,
    );
  });

  it("FT board item: with roster labels the line names players as the timeline does", () => {
    const labels = {
      friendly: (n: string) => (n === "Me-R" ? "1(DPriest)" : "2(FMage)"),
      enemy: () => "4(ARogue)",
    };
    expect(
      formatBurstAnsweredLines([point()], undefined, labels)[0]!.line,
    ).toBe(
      `${BURST_ANSWERED_TAG}   enemy opened Deathmark (4(ARogue)): ` +
        `1(DPriest) answered with Pain Suppression in 2.4s; 2(FMage) bottomed at 31% at 0:45`,
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
            attackerMoved: false,
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

describe("triage sync-burst F-B7 / F-B4 — which answer is credited", () => {
  const heal = (casterId: string) => ({
    category: "healCd" as const,
    spellId: "108416", // Dark Pact: HEALING_VERDICTS healsOthers false
    spellName: "Dark Pact",
    casterName: casterId,
    casterId,
    tSec: 46,
    latencySec: 6.3,
  });
  it("F-B7: another friendly's self-only heal CD is not credited; the pressured unit's own is", () => {
    const other = formatBurstAnsweredLines([
      point({ responseCasts: [heal("f9")] }),
    ]);
    expect(other).toEqual([]);
    const own = formatBurstAnsweredLines([
      point({ responseCasts: [heal("f9"), heal("f2")] }),
    ]);
    expect(own[0]!.line).toContain("f2 answered with Dark Pact in 6.3s");
  });
  it("F-B4: a pre-opener aimed control whose aura was gone at the lead cast is skipped", () => {
    const ctl = (still: boolean) => ({
      category: "control" as const,
      spellId: "115078",
      spellName: "Paralysis",
      casterName: "Monk-R",
      casterId: "f3",
      destId: "e1",
      tSec: 38,
      latencySec: -1.1,
      preOpenerStillUp: still,
    });
    const pw = point().responseCasts[0]!;
    expect(
      formatBurstAnsweredLines([point({ responseCasts: [ctl(false), pw] })])[0]!
        .line,
    ).toContain("Me-R answered with Pain Suppression in 2.4s");
    expect(
      formatBurstAnsweredLines([point({ responseCasts: [ctl(true), pw] })])[0]!
        .line,
    ).toContain("Monk-R answered with Paralysis 1.1s before it opened");
  });
});

describe("T12 ⑧ (i) — a response pressed at or after the pressured unit's death is not credited", () => {
  // 483f7433 1:45: The Hunt opens, the warrior dies at 1:50.385, the evoker's
  // Emerald Communion goes out at 1:50.636 — "answered … in 5.1s … still died".
  const communion = {
    category: "healCd" as const,
    spellId: "370960",
    spellName: "Emerald Communion",
    casterName: "Evoker-R",
    casterId: "f3",
    tSec: 110,
    latencySec: 5.1,
    afterPressuredDeath: true as const,
  };
  const dead = {
    anyFriendlyDeath: true,
    pressured: { ...point().pressured!, died: true, minHpPct: 20 },
  };
  it("the only response came after the death → the window gets no line", () => {
    expect(
      formatBurstAnsweredLines([
        point({ ...dead, responseCasts: [communion] }),
      ]),
    ).toEqual([]);
    // the same press without the mark is the line this replaces
    const { afterPressuredDeath: _mark, ...before } = communion;
    expect(
      formatBurstAnsweredLines([
        point({ ...dead, responseCasts: [before] }),
      ])[0]!.line,
    ).toContain(
      "Evoker-R answered with Emerald Communion in 5.1s; Mate-R bottomed at 20% at 0:45 — Mate-R still died",
    );
  });
  it("another creditable response is the one named — an earlier one, or a later one the death did not precede", () => {
    const pw = point().responseCasts[0]!;
    expect(
      formatBurstAnsweredLines([
        point({ ...dead, responseCasts: [pw, communion] }),
      ])[0]!.line,
    ).toContain("Me-R answered with Pain Suppression in 2.4s");
    expect(
      formatBurstAnsweredLines([
        point({
          ...dead,
          responseCasts: [{ ...communion, latencySec: 1.0 }, pw],
        }),
      ])[0]!.line,
    ).toContain("Me-R answered with Pain Suppression in 2.4s");
  });
  it("the mark outranks every other credit rule — a landed control pressed after the death is skipped too", () => {
    expect(
      formatBurstAnsweredLines([
        point({
          ...dead,
          responseCasts: [
            {
              category: "control",
              spellId: "51514",
              spellName: "Hex",
              casterName: "Shaman-R",
              casterId: "f4",
              destId: "e1",
              tSec: 46,
              latencySec: 6.0,
              landed: true,
              afterPressuredDeath: true,
            },
          ],
        }),
      ]),
    ).toEqual([]);
  });
});

describe("T12 ⑧ (i) — a credited control says who it landed on and for how long", () => {
  const HEX_AT_MS = 41_200;
  const hex = (over: Record<string, unknown> = {}) => ({
    category: "control" as const,
    spellId: "51514",
    spellName: "Hex",
    casterName: "Shaman-R",
    casterId: "f4",
    destId: "e2",
    tSec: 41,
    latencySec: 1.2,
    landed: true,
    controlOn: {
      unitId: "e2",
      unitName: "Paladin-R",
      auras: [{ spellId: "51514", atMs: HEX_AT_MS }],
    },
    ...over,
  });
  /** the enemy paladin's `[CC ON ENEMY]` instances: a Hex that ran 2.1 s */
  const cc = (over: Record<string, unknown> = {}) => ({
    spellId: "51514",
    atSeconds: HEX_AT_MS / 1000,
    durationSeconds: 2.1,
    ...over,
  });
  const summaries = (...ccInstances: ReturnType<typeof cc>[]) =>
    [{ playerName: "Paladin-R", ccInstances }] as never;
  const labels = {
    friendly: (n: string) => (n === "Shaman-R" ? "3(RShaman)" : "2(AWarrior)"),
    enemy: (n: string) => (n === "Paladin-R" ? "5(RPaladin)" : "4(AWarrior)"),
  };
  const line = (
    responseCasts: unknown[],
    spanOf = ccSpanLookup(summaries(cc()), 0),
    withLabels = true,
  ) =>
    formatBurstAnsweredLines(
      [point({ responseCasts: responseCasts as never })],
      undefined,
      withLabels ? labels : undefined,
      spanOf,
    )[0]!;

  it("names the target by the roster label, with the span the [CC ON ENEMY] instance prints", () => {
    const e = line([hex()]);
    expect(e.line).toBe(
      `${BURST_ANSWERED_TAG}   enemy opened Deathmark (4(AWarrior)): ` +
        `3(RShaman) answered with Hex on 5(RPaladin) (2s) in 1.2s; 2(AWarrior) bottomed at 31% at 0:45`,
    );
    expect(e.namesControlTarget).toBe(true);
    // without labels the name is the name, as everywhere on this line
    expect(line([hex()], undefined, false).line).toContain(
      "Shaman-R answered with Hex on Paladin-R (2s) in 1.2s;",
    );
  });

  it("a pre-opener control keeps its 'before it opened' wording after the clause", () => {
    expect(
      line([hex({ latencySec: -0.9, preOpenerStillUp: true })]).line,
    ).toContain("answered with Hex on 5(RPaladin) (2s) 0.9s before it opened;");
  });

  it("the span is the one CC formatter's text — <1s, and a control the round ended on", () => {
    expect(
      line([hex()], ccSpanLookup(summaries(cc({ durationSeconds: 0.3 })), 0))
        .line,
    ).toContain("answered with Hex on 5(RPaladin) (<1s) in 1.2s;");
    expect(
      line(
        [hex()],
        ccSpanLookup(
          summaries(cc({ durationSeconds: 2.1, stillOnAtRoundEnd: true })),
          0,
        ),
      ).line,
    ).toContain(
      "answered with Hex on 5(RPaladin) (still on them when the round ended, 2s in) in 1.2s;",
    );
  });

  it("no CC instance for the application (a root, an interrupt) → the target, no brackets", () => {
    const kick = hex({
      spellId: "57994",
      spellName: "Wind Shear",
      controlOn: { unitId: "e2", unitName: "Paladin-R", auras: [] },
    });
    const e = line([kick]);
    expect(e.line).toContain(
      "answered with Wind Shear on 5(RPaladin) in 1.2s;",
    );
    expect(e.namesControlTarget).toBe(true);
    // an aura the CC walk has no instance for
    expect(line([hex()], ccSpanLookup(summaries(), 0)).line).toContain(
      "answered with Hex on 5(RPaladin) in 1.2s;",
    );
  });

  it("one press that landed on two burst casters names both, each with its own span", () => {
    const sweep = (unitId: string, unitName: string) =>
      hex({
        spellId: "119381",
        spellName: "Leg Sweep",
        destId: undefined,
        controlOn: {
          unitId,
          unitName,
          auras: [{ spellId: "119381", atMs: HEX_AT_MS }],
        },
      });
    const spanOf = ccSpanLookup(
      [
        {
          playerName: "Warrior-E",
          ccInstances: [cc({ spellId: "119381", durationSeconds: 3 })],
        },
        {
          playerName: "Paladin-R",
          ccInstances: [cc({ spellId: "119381", durationSeconds: 0.2 })],
        },
      ] as never,
      0,
    );
    expect(
      line([sweep("e1", "Warrior-E"), sweep("e2", "Paladin-R")], spanOf).line,
    ).toContain(
      "answered with Leg Sweep on 4(AWarrior) (3s) and 5(RPaladin) (<1s) in 1.2s;",
    );
    // a target the press did not creditably reach (it did not land) is not named
    expect(
      line(
        [
          sweep("e1", "Warrior-E"),
          { ...sweep("e2", "Paladin-R"), landed: false },
        ],
        spanOf,
      ).line,
    ).toContain("answered with Leg Sweep on 4(AWarrior) (3s) in 1.2s;");
    // another press by the same player is another answer
    expect(
      line(
        [
          sweep("e1", "Warrior-E"),
          { ...sweep("e2", "Paladin-R"), latencySec: 4 },
        ],
        spanOf,
      ).line,
    ).toContain("answered with Leg Sweep on 4(AWarrior) (3s) in 1.2s;");
  });

  it("any other answer carries no clause and no legend flag", () => {
    const e = formatBurstAnsweredLines([point()], undefined, labels)[0]!;
    expect(e.line).not.toContain(" on ");
    expect(e.namesControlTarget).toBeUndefined();
  });

  it("ccSpanLookup joins on the application itself — holder, aura id and instant", () => {
    const spanOf = ccSpanLookup(summaries(cc()), 1_000_000);
    const aura = { spellId: "51514", atMs: 1_000_000 + HEX_AT_MS };
    expect(spanOf("Paladin-R", aura)).toBe("2s");
    expect(spanOf("Warrior-E", aura)).toBeUndefined();
    expect(spanOf("Paladin-R", { ...aura, spellId: "118" })).toBeUndefined();
    expect(
      spanOf("Paladin-R", { ...aura, atMs: aura.atMs + 40 }),
    ).toBeUndefined();
    expect(ccSpanLookup(undefined, 0)("Paladin-R", aura)).toBeUndefined();
  });

  it("the producer's reader returns the clause it wrote", () => {
    const at = (l: string) => parseBurstAnsweredLine(`0:40  ${l}`)!;
    expect(at(line([hex()]).line)).toMatchObject({
      spellName: "Hex",
      controlOn: [{ target: "5(RPaladin)", span: "2s" }],
      latencySec: 1.2,
    });
    expect(
      at(
        line(
          [hex()],
          ccSpanLookup(summaries(cc({ stillOnAtRoundEnd: true })), 0),
        ).line,
      ).controlOn,
    ).toEqual([
      {
        target: "5(RPaladin)",
        span: "still on them when the round ended, 2s in",
      },
    ]);
    expect(
      at(line([hex({ latencySec: -0.9, preOpenerStillUp: true })]).line),
    ).toMatchObject({
      controlOn: [{ target: "5(RPaladin)", span: "2s" }],
      latencySec: -0.9,
    });
    expect(
      at(line([hex()], ccSpanLookup(summaries(), 0)).line).controlOn,
    ).toEqual([{ target: "5(RPaladin)" }]);
    expect(at(formatBurstAnsweredLines([point()])[0]!.line).controlOn).toEqual(
      [],
    );
  });
});

describe("parseBurstAnsweredLine — the producer's own reader of its line", () => {
  const rendered = (over: Partial<BurstWindowDecisionPoint> = {}) => {
    const [e] = formatBurstAnsweredLines([point(over)], undefined, {
      friendly: (n: string) => (n === "Me-R" ? "1(DPriest)" : "2(FMage)"),
      enemy: () => "4(ARogue)",
    });
    return `0:40  ${e!.line}`;
  };
  it("reads the answer, its latency and the pressured unit back", () => {
    expect(parseBurstAnsweredLine(rendered())).toEqual({
      atSec: 40,
      answerer: "1(DPriest)",
      spellName: "Pain Suppression",
      controlOn: [],
      latencySec: 2.4,
      pressured: "2(FMage)",
      pressuredDied: false,
    });
  });
  it("a pre-opener answer reads as a negative latency; extras with '; ' do not break the parse", () => {
    const p = parseBurstAnsweredLine(
      rendered({
        extraCds: [
          { ...point().leadCd, spellName: "Recklessness", castSec: 44 },
          { ...point().leadCd, spellName: "Avatar", castSec: 40 },
        ],
        responseCasts: [
          { ...point().responseCasts[0]!, latencySec: -1.1, tSec: 39 },
        ],
      }),
    );
    expect(p!.latencySec).toBe(-1.1);
    expect(p!.spellName).toBe("Pain Suppression");
  });
  it("`still died` is the pressured unit's own death; another friendly's is not", () => {
    expect(
      parseBurstAnsweredLine(
        rendered({
          anyFriendlyDeath: true,
          pressured: { ...point().pressured!, died: true },
        }),
      )!.pressuredDied,
    ).toBe(true);
    expect(
      parseBurstAnsweredLine(rendered({ anyFriendlyDeath: true }))!
        .pressuredDied,
    ).toBe(false);
  });
  it("any other line is null", () => {
    expect(
      parseBurstAnsweredLine("0:40  [CC ON ENEMY]   4(ARogue) ← Hex (by 1(X))"),
    ).toBeNull();
  });
});

describe("aimedControlUpAt (F-B4)", () => {
  const ev = (event: string, ms: number, spellId = "115078", src = "f3") => ({
    timestamp: ms,
    spellId,
    srcUnitId: src,
    logLine: { event },
  });
  it("95127ab4: Paralysis 18.059, trinketed 18.662 → gone at the 19.168 Zenith, up at 18.5", () => {
    const dest = {
      auraEvents: [
        ev("SPELL_AURA_APPLIED", 18_059),
        ev("SPELL_AURA_REMOVED", 18_662),
      ],
    };
    expect(aimedControlUpAt(dest, "f3", "115078", 18_059, 19_168)).toBe(false);
    expect(aimedControlUpAt(dest, "f3", "115078", 18_059, 18_500)).toBe(true);
    expect(aimedControlUpAt(dest, "f9", "115078", 18_059, 18_500)).toBe(false);
  });
  it("reads the cast's effect aura (Fear 5782 → 118699)", () => {
    const dest = { auraEvents: [ev("SPELL_AURA_APPLIED", 10_000, "118699")] };
    expect(aimedControlUpAt(dest, "f3", "5782", 9_900, 11_000)).toBe(true);
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
    expect(out[0]!.line).toContain(
      "Mate-R bottomed at 4% at 0:45 — Mate-R still died",
    );
  });

  it("a DIFFERENT friendly's death inside the window is stated as a fact, not as the pressured unit dying (round 3 N4, 483f)", () => {
    const out = formatBurstAnsweredLines([
      point({ anyFriendlyDeath: true, deathsInWindow: 1 }),
    ]);
    expect(out[0]!.line).not.toContain("still died");
    expect(out[0]!.line).toContain("died inside it");
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
    expect(out[0]!.line).toContain(
      "enemy opened Deathmark (+Recklessness 4s later) (",
    );
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

// FT-T03 (user ruling 2026-10-10, D7): "the 'trough' numbers may leave the
// whole-second grid and read the true minimum inside their window" — the
// printed bottom is the engine's trough; every decision keeps the grid pair.
describe("[BURST ANSWERED] — the bottom is the window's true minimum, at the second it happened (FT-T03)", () => {
  const build = (between: Array<[number, number]>) => {
    const hpSamples = [];
    for (let s = 0; s <= 40; s++)
      hpSamples.push(hp(s, s >= 10 && s <= 20 ? 90 - (s - 10) * 6 : 90, "F1"));
    for (const [t, v] of between) hpSamples.push(hp(t, v, "F1"));
    hpSamples.sort((a, b) => a.timestamp - b.timestamp);
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
    const pts = burstWindowDecisionPoints({
      startTime: T0,
      endTime: T0 + 240_000,
      units: { F1: f, E1: e },
      startInfo: { bracket: "3v3" },
    });
    return { f, pts, lines: formatBurstAnsweredLines(pts) };
  };

  it("a dip between two ticks is the printed bottom; the grid pair — and so every decision — is what it was", () => {
    const base = build([]);
    const dipped = build([[15.4, 8]]);
    expect(base.lines[0]!.line).toContain("bottomed at 36% at 0:19");
    expect(dipped.lines[0]!.line).toContain("bottomed at 8% at 0:15");

    const a = base.pts[0]!.pressured!;
    const b = dipped.pts[0]!.pressured!;
    // the decision's readings did not move
    expect([b.minHpPct, b.minHpSec]).toEqual([a.minHpPct, a.minHpSec]);
    expect([b.minHpPct, b.minHpSec]).toEqual([36, 19]);
    expect(dipped.pts[0]!.triaged).toBe(base.pts[0]!.triaged);
    expect(dipped.pts[0]!.responded).toBe(base.pts[0]!.responded);
    // the printed pair did; without a dip the two pairs are one
    expect([b.troughHpPct, b.troughHpSec]).toEqual([8, 15]);
    expect([a.troughHpPct, a.troughHpSec]).toEqual([36, 19]);
    // the [STATE] tick of that second still reads its own sample
    expect(gridHpPct(dipped.f as never, T0 + 15_000)).toBe(60);
  });

  it("the ≤ 60 % door and the ranking read the grid minimum, not the trough: no line appears with the ruling", () => {
    // grid minimum 65 (above the door); the trough alone is under it
    const quiet = point({
      pressured: {
        ...point().pressured!,
        minHpPct: BURST_ANSWERED_MAX_HP_PCT + 5,
        minHpSec: 45,
        troughHpPct: 20,
        troughHpSec: 44,
      },
    });
    expect(formatBurstAnsweredLines([quiet])).toEqual([]);
    const shown = point({
      pressured: {
        ...point().pressured!,
        troughHpPct: 20,
        troughHpSec: 44,
      },
    });
    expect(formatBurstAnsweredLines([shown])[0]!.line).toContain(
      "Mate-R bottomed at 20% at 0:44",
    );
  });
});

describe("[BURST ANSWERED] — T12 ⑧ (i) end to end: the death is read from the unit's own UNIT_DIED", () => {
  /** Tranquility — a `BURST_HEAL_CD_IDS` answer the Restoration Druid teammate
   * owns, so the window is feasible through them. */
  const TRANQUILITY = "740";
  const run = (answerSec: number) => {
    const hpSamples = [];
    for (let s = 0; s <= 14; s++)
      hpSamples.push(hp(s, s >= 10 ? 90 - (s - 10) * 18 : 90, "F1"));
    const damageIn = [];
    for (let s = 10; s < 16; s++) damageIn.push(dmg(s, 18));
    const f = unit({
      advancedActions: hpSamples,
      damageIn,
      deathRecords: [{ timestamp: T0 + 15_385 }],
    });
    const mateHp = [];
    for (let s = 0; s <= 40; s++) mateHp.push(hp(s, 100, "F2"));
    const mate = unit({
      id: "F2",
      name: "Mate-R",
      advancedActions: mateHp,
      spellCastEvents: [cast(TRANQUILITY, answerSec)],
    });
    const e = unit({
      id: "E1",
      name: "Enemy-R",
      reaction: CombatUnitReaction.Hostile,
      info: { teamId: "1", specId: "260" },
      spellCastEvents: [cast(AR, 10)],
    });
    const pts = burstWindowDecisionPoints({
      startTime: T0,
      endTime: T0 + 240_000,
      units: { F1: f, F2: mate, E1: e },
      startInfo: { bracket: "3v3" },
    });
    expect(pts).toHaveLength(1);
    return pts;
  };

  /** The same points with the mark taken off — what the line read before.
   * Each "no line" case below also shows the mark is the ONLY thing between
   * the window and its line (feasible, deep enough, a creditable category). */
  const unmarked = (pts: BurstWindowDecisionPoint[]) =>
    pts.map((p) => ({
      ...p,
      responseCasts: p.responseCasts.map(
        ({ afterPressuredDeath: _mark, ...r }) => r,
      ),
    }));

  it("pressed 0.251 s after the death: `responded` stays true, the credit line is gone", () => {
    const pts = run(15.636);
    expect(pts[0]!.responded).toBe(true);
    expect(pts[0]!.pressured!.name).toBe("Friend-R");
    expect(formatBurstAnsweredLines(pts)).toEqual([]);
    expect(formatBurstAnsweredLines(unmarked(pts))[0]!.line).toContain(
      "Mate-R answered with Tranquility in 5.6s; Friend-R bottomed at 18% at 0:14 — Friend-R still died",
    );
  });

  it("pressed on the death's own millisecond: not credited either", () => {
    const pts = run(15.385);
    expect(formatBurstAnsweredLines(pts)).toEqual([]);
    expect(formatBurstAnsweredLines(unmarked(pts))).toHaveLength(1);
  });

  it("pressed 0.5 s before the death: credited, and the line says the unit still died", () => {
    const lines = formatBurstAnsweredLines(run(14.885));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line).toContain(
      "Mate-R answered with Tranquility in 4.9s;",
    );
    expect(lines[0]!.line).toContain("Friend-R still died");
  });
});

// ── part 3: in the timeline, beside the [CC ON ENEMY] line ──────────────────

describe("[BURST ANSWERED] — T12 ⑧ (i): the control's span is the [CC ON ENEMY] line's, and the legend says what it is", () => {
  const START = Date.UTC(2026, 7, 20);
  const mk = (id: string, name: string, over: Record<string, unknown> = {}) =>
    ({
      id,
      name,
      ownerId: "",
      isWellFormed: true,
      type: CombatUnitType.Player,
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Friendly,
      info: { teamId: "0", specId: "264" },
      damageIn: [],
      damageOut: [],
      healIn: [],
      healOut: [],
      absorbsIn: [],
      absorbsOut: [],
      auraEvents: [],
      spellCastEvents: [],
      castStartEvents: [],
      petSpellCastEvents: [],
      actionIn: [],
      actionOut: [],
      deathRecords: [],
      advancedActions: [],
      ...over,
    }) as never;
  const HEX = "51514";
  const HEX_AT_S = 41.2;
  const timeline = (burst: BurstWindowDecisionPoint[]) => {
    const owner = mk("o", "Me-Realm");
    const mate = mk("m", "Mate-Realm");
    const foe = mk("e", "Paladin-Realm", {
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { teamId: "1", specId: "70" },
    });
    return buildMatchTimeline({
      owner,
      ownerSpec: "Shaman_Restoration",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      dispelSummary: {
        allyCleanse: [],
        ourPurges: [],
        hostilePurges: [],
        missedCleanseWindows: [],
        lateCleanseWindows: [],
        ccEfficiency: [],
        missedPurgeWindows: [],
      },
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner, mate],
      enemies: [foe],
      matchStartMs: START,
      matchEndMs: START + 120_000,
      isHealer: true,
      criticalWindowSeconds: new Set<number>(),
      playerIdMap: new Map([
        ["Me-Realm", 1],
        ["Mate-Realm", 2],
      ]),
      enemyIdMap: new Map([["Paladin-Realm", 4]]),
      burstWindows: burst,
      // the teammate's Hex on the paladin, 2.1 s — what [CC ON ENEMY] renders
      enemyCCSummaries: [
        {
          playerName: "Paladin-Realm",
          playerSpec: "Retribution Paladin",
          trinketType: "None",
          trinketCooldownSeconds: 120,
          trinketUseTimes: [],
          missedTrinketWindows: [],
          rootInstances: [],
          disarmInstances: [],
          interruptInstances: [],
          ccAvoidedInstances: [],
          ccInstances: [
            {
              atSeconds: HEX_AT_S,
              durationSeconds: 2.1,
              spellId: HEX,
              spellName: "Hex",
              sourceName: "Mate-Realm",
              sourceId: "m",
              sourceSpec: "Restoration Shaman",
              damageTakenDuring: 0,
              trinketState: "passive_trinket",
              drInfo: null,
              distanceYards: null,
              losBlocked: null,
            },
          ],
        },
      ],
    } as never);
  };
  const answered = (responseCasts: unknown[]) =>
    point({
      leadCd: { ...point().leadCd, casterName: "Paladin-Realm" },
      pressured: { ...point().pressured!, name: "Me-Realm" },
      responseCasts: responseCasts as never,
    });
  const hex = {
    category: "control",
    spellId: HEX,
    spellName: "Hex",
    casterName: "Mate-Realm",
    casterId: "m",
    destId: "e",
    tSec: 41,
    latencySec: 1.2,
    landed: true,
    controlOn: {
      unitId: "e",
      unitName: "Paladin-Realm",
      auras: [{ spellId: HEX, atMs: START + Math.round(HEX_AT_S * 1000) }],
    },
  };

  it("both lines print one length for the one application, and the legend line is there", () => {
    const lines = timeline([answered([hex])]).split("\n");
    const credit = lines.find((l) => l.includes(`${BURST_ANSWERED_TAG}   `))!;
    const landing = lines.find((l) => l.includes("[CC ON ENEMY]   "))!;
    const who = landing.match(
      /\[CC ON ENEMY\] {3}(\S+) ← Hex \(by (\S+)\) \((\S+)\)/,
    )!;
    expect(who[3]).toBe("2s");
    expect(credit).toContain(
      `${who[2]} answered with Hex on ${who[1]} (${who[3]}) in 1.2s;`,
    );
    expect(parseBurstAnsweredLine(credit)!.controlOn).toEqual([
      { target: who[1], span: "2s" },
    ]);
    expect(lines).toContain(BURST_ANSWERED_CONTROL_LEGEND);
  });

  it("a round whose credited answers are not controls pays nothing for that legend line", () => {
    const text = timeline([
      answered([{ ...point().responseCasts[0]!, casterName: "Mate-Realm" }]),
    ]);
    expect(text).toContain(`${BURST_ANSWERED_TAG}   enemy opened Deathmark`);
    expect(text).not.toContain(BURST_ANSWERED_CONTROL_LEGEND);
  });
});
