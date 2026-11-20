/**
 * Pipeline T213, assembly review 80-PIPE-170c-B156 — the reader sweep: every
 * reader that named a Holy Paladin's Aura Mastery as a damage save asks the
 * one reading of it (`auraMasteryPressWallStartMs` per press,
 * `isNoWallButtonOf` in hand). Each test has its Devotion Aura control.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitFriendlyDeathEntries } from "../src/context/matchTimelineSections";
import { buildKillSequenceBlock } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  AURA_MASTERY_ID,
  AURA_MASTERY_IMMUNITY_AURA_ID,
  CONCENTRATION_AURA_ID,
  wallStartOfRowMs,
} from "../src/utils/auraMasteryBranch";
import {
  annotateDefensiveTimings,
  detectOverlappedDefensives,
  detectPanicDefensives,
  extractMajorCooldowns,
} from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const DEVOTION_AURA = "465";
const A = LogEvent.SPELL_AURA_APPLIED;
const R = LogEvent.SPELL_AURA_REMOVED;

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (ev: LogEvent, id: string, s: number) =>
  makeAuraEvent(ev, id, at(s), "pal", "pal", "BUFF");

/** a friendly Holy Paladin under `running` since 1 s; `pressS` = its Aura
 * Mastery press (none when undefined); `switchS` = the second it left
 * Concentration Aura for Devotion Aura while the press ran */
const paladin = (
  running: string,
  pressS?: number,
  switchS?: number,
  more: object = {},
  /** the press row's target: none, as the game logs it — or the paladin
   * itself, for the two readers that only judge a press with a friendly
   * target (the panic detector, the external timing label). No such row is
   * in the corpus; the guard is there so the reading holds if one appears. */
  dest: "nil" | "pal" = "nil",
) =>
  makeUnit("pal", {
    name: "Pal-R",
    class: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Holy,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents:
      pressS === undefined
        ? []
        : [
            makeSpellCastEvent(
              AURA_MASTERY_ID,
              at(pressS),
              dest === "nil" ? "0000000000000000" : "pal",
              dest === "nil" ? "nil" : "Pal-R",
              "pal",
              "Pal-R",
            ),
          ],
    auraEvents: [
      aura(A, running, 1),
      ...(pressS === undefined
        ? []
        : [
            aura(A, AURA_MASTERY_ID, pressS),
            ...(running === CONCENTRATION_AURA_ID
              ? [
                  aura(A, AURA_MASTERY_IMMUNITY_AURA_ID, pressS),
                  aura(R, AURA_MASTERY_IMMUNITY_AURA_ID, switchS ?? pressS + 8),
                ]
              : []),
            ...(switchS === undefined
              ? []
              : [
                  aura(R, CONCENTRATION_AURA_ID, switchS),
                  aura(A, DEVOTION_AURA, switchS),
                ]),
            aura(R, AURA_MASTERY_ID, pressS + 8),
          ]),
    ].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp),
    ...more,
  } as never);

describe("T213 reader sweep — the raw-row reading (`wallStartOfRowMs`)", () => {
  it("the row's own ms for a wall, the switch for a switched press, undefined for the immunity; any other spell is its row", () => {
    expect(
      wallStartOfRowMs(AURA_MASTERY_ID, paladin(DEVOTION_AURA, 20), at(20)),
    ).toBe(at(20));
    expect(
      wallStartOfRowMs(
        AURA_MASTERY_ID,
        paladin(CONCENTRATION_AURA_ID, 20),
        at(20),
      ),
    ).toBeUndefined();
    expect(
      wallStartOfRowMs(
        AURA_MASTERY_ID,
        paladin(CONCENTRATION_AURA_ID, 20, 24),
        at(20),
      ),
    ).toBe(at(24));
    expect(
      wallStartOfRowMs("498", paladin(CONCENTRATION_AURA_ID, 20), at(20)),
    ).toBe(at(20));
  });
});

describe("T213 reader sweep — detectPanicDefensives", () => {
  const combat = { startTime: T0 };
  const enemy = makeUnit("enemy-1", { reaction: 0 } as never);
  const hits = (fromS: number, toS: number) =>
    Array.from({ length: (toS - fromS) * 2 }, (_, i) => ({
      logLine: {
        event: LogEvent.SPELL_DAMAGE,
        timestamp: at(fromS + i / 2),
        parameters: [],
      },
      timestamp: at(fromS + i / 2),
      effectiveAmount: -2_000_000,
      amount: -2_000_000,
      spellId: "1",
      srcUnitId: "enemy-1",
    }));
  const self = (running: string, pressS: number, switchS?: number, more = {}) =>
    paladin(running, pressS, switchS, more, "pal");
  const panicsOf = (p: ReturnType<typeof paladin>) =>
    detectPanicDefensives([p], [enemy], combat).filter(
      (x) => x.spellId === AURA_MASTERY_ID,
    );

  it("对照:a Devotion press with no threat is a panic press", () => {
    expect(panicsOf(self(DEVOTION_AURA, 20))).toHaveLength(1);
  });
  it("a press that was the immunity throughout is no defensive pressed with no threat", () => {
    expect(panicsOf(self(CONCENTRATION_AURA_ID, 20))).toEqual([]);
  });
  it("a switched press is judged where the wall went up: pressure only at the switch clears it, and the entry keeps the press's second", () => {
    // damage 23–27 s: past the 4 s after a 16 s press… and right at the switch
    const quiet = self(CONCENTRATION_AURA_ID, 16, 23);
    const quietPanics = panicsOf(quiet);
    expect(quietPanics).toHaveLength(1);
    expect(quietPanics[0]!.timeSeconds).toBeCloseTo(16);
    const pressured = self(CONCENTRATION_AURA_ID, 16, 23, {
      damageIn: hits(23, 27),
    });
    expect(panicsOf(pressured)).toEqual([]);
    // mutation: the same damage does not clear a Devotion press at 16 s
    // (its window is 16–20 s)
    expect(
      panicsOf(self(DEVOTION_AURA, 16, undefined, { damageIn: hits(23, 27) })),
    ).toHaveLength(1);
  });
});

describe("T213 reader sweep — detectOverlappedDefensives", () => {
  const combat = { startTime: T0 };
  const PAIN_SUPPRESSION = "33206";
  /** a priest's Pain Suppression on the paladin at `s` */
  const priest = (s: number) =>
    makeUnit("priest", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [
        makeSpellCastEvent(
          PAIN_SUPPRESSION,
          at(s),
          "pal",
          "Pal-R",
          "priest",
          "Priest",
        ),
      ],
    } as never);
  const overlapsOf = (p: ReturnType<typeof paladin>, psS: number) =>
    detectOverlappedDefensives([p, priest(psS)], combat as never).filter(
      (o) =>
        o.firstSpellId === AURA_MASTERY_ID ||
        o.secondSpellId === AURA_MASTERY_ID,
    );

  it("对照:a Devotion press and a Pain Suppression 1 s later overlap", () => {
    expect(overlapsOf(paladin(DEVOTION_AURA, 20), 21)).toHaveLength(1);
  });
  it("the immunity overlaps nothing", () => {
    expect(overlapsOf(paladin(CONCENTRATION_AURA_ID, 20), 21)).toEqual([]);
  });
  it("a switched press overlaps from the switch", () => {
    const [o] = overlapsOf(paladin(CONCENTRATION_AURA_ID, 20, 24), 25);
    expect(o).toBeDefined();
    expect(o!.timeSeconds).toBeCloseTo(24);
  });
});

describe("T213 reader sweep — a ready Aura Mastery at a death", () => {
  const DEATH_S = 60;
  const ledger = [
    {
      spellId: AURA_MASTERY_ID,
      spellName: "Aura Mastery",
      tag: "Defensive",
      cooldownSeconds: 180,
      maxChargesDetected: 1,
      casts: [],
      availableWindows: [
        { fromSeconds: 0, toSeconds: 120, durationSeconds: 120 },
      ],
      neverUsed: true,
    },
  ];
  const dying = (running: string) =>
    paladin(running, undefined, undefined, {
      deathRecords: [{ timestamp: at(DEATH_S) }],
    });

  const deathLine = (running: string, withRoundEnd = true) => {
    const p = dying(running);
    const entries: string[] = [];
    emitFriendlyDeathEntries<string>({
      friendlyDeaths: [{ spec: "Holy", name: p.name, atSeconds: DEATH_S }],
      unitsByName: new Map([[p.name, p]]),
      ccTrinketSummaries: [],
      owner: p,
      ownerCDs: ledger as never,
      teammateCDs: [],
      matchStartMs: T0,
      ...(withRoundEnd ? { matchEndMs: at(120) } : {}),
      pid: (n) => n,
      requestSnapshotPlaceholder: () => "snap",
      addEntry: (_t, ...lines) => {
        entries.push(String(lines[0]));
      },
    });
    return entries.find((l) => l.includes("[DEATH]")) ?? "";
  };
  it("[DEATH] (Unused: …): named under Devotion Aura (the control), not under Concentration Aura", () => {
    expect(deathLine(DEVOTION_AURA)).toContain("(Unused: Aura Mastery)");
    expect(deathLine(CONCENTRATION_AURA_ID)).toContain("[DEATH]");
    expect(deathLine(CONCENTRATION_AURA_ID)).not.toContain("Aura Mastery");
  });

  const available = (running: string) => {
    const p = dying(running);
    return buildKillSequenceBlock({
      matchStartMs: T0,
      // the block is written for rounds under 90 s
      matchEndSeconds: 80,
      owner: p,
      friends: [p],
      enemies: [],
      ownerCDs: ledger,
      teammateCDs: [],
      enemyCDTimeline: { alignedBurstWindows: [], players: [] },
      ccTrinketSummaries: [],
      friendlyDeaths: [{ spec: "x", name: p.name, atSeconds: DEATH_S }],
      enemyDeaths: [],
      isHealer: false,
      pid: (n: string) => n,
      actorLabel: (n: string) => n,
    } as never).filter((l) => l.includes("[DEFENSIVE AVAILABLE]"));
  };
  it("[DEFENSIVE AVAILABLE]: named under Devotion Aura (the control), not under Concentration Aura", () => {
    expect(available(DEVOTION_AURA).join("\n")).toContain(
      "Aura Mastery available but unused",
    );
    expect(available(CONCENTRATION_AURA_ID)).toEqual([]);
  });
});

describe("T213 reader sweep — the [UNNECESSARY] external label", () => {
  const sample = (s: number, cur: number) => ({
    logLine: { timestamp: at(s), parameters: [] },
    timestamp: at(s),
    advancedActorId: "pal",
    advancedActorCurrentHp: cur,
    advancedActorMaxHp: 1000,
  });
  const labelOf = (running: string) => {
    const p = {
      ...paladin(running, 20, undefined, {}, "pal"),
      advancedActions: [sample(19.5, 950), sample(19.9, 950)] as never,
    };
    const combat = {
      startTime: T0,
      endTime: at(120),
      units: { pal: p },
    } as never;
    const cds = annotateDefensiveTimings(
      extractMajorCooldowns(p as never, combat),
      p as never,
      combat,
      { players: [], alignedBurstWindows: [] } as never,
    );
    return cds.find((c) => c.spellId === AURA_MASTERY_ID)!.casts[0]!
      .timingLabel;
  };
  it("对照:a Devotion press at full HP with no pressure is Unnecessary; the immunity is not", () => {
    expect(labelOf(DEVOTION_AURA)).toBe("Unnecessary");
    expect(labelOf(CONCENTRATION_AURA_ID)).not.toBe("Unnecessary");
  });
});
