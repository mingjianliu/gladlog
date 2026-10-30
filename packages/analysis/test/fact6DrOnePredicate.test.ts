/**
 * fact6 F20 (D10 D29): one DR walk (`getDRLevel`), two queries — the level
 * an application landed at (`drLevelAtLanding`, itself out by identity) and
 * the level a control lands at at an instant (`drLevelNextAt`, landings at
 * ≤ that ms count) — over one history whose sources are
 * `isDrHistorySource`'s (every source but a holder-self aura that is not a
 * control).
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ccRemainingSeconds } from "../src/utils/ccBreakAnalysis";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  buildCcCategoryHistory,
  detectTeammateDrClashes,
  drLevelAtLanding,
  drLevelNextAt,
  getDRCategory,
  getDRLevel,
  getDRLevelAtTime,
  type IOutgoingCCApplication,
  type IOutgoingCCChain,
  isDrHistorySource,
} from "../src/utils/drAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// a pre-12.1 epoch: the reset window is 16 s (`drResetMsAt`)
const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;
const RESET_S = 16;
const SLEEP_WALK = "360806";
const FEAR = "118699";
const entry = (from: number, to: number, spellId = FEAR, src = "e") => ({
  applyMs: S(from),
  removeMs: S(to),
  spellId,
  srcUnitId: src,
});

describe("getDRLevel — the one walk", () => {
  it("a control landing on the queried ms counts (Q2, D10's shape)", () => {
    // Sigil of Misery 10.9–13.9 long reset; Cyclone lands at 35.905 — a
    // control asked about at 35.905 lands on top of it at 50 %
    const h = [entry(35.905, 39.877, "33786")];
    expect(drLevelNextAt(h, S(35.905))).toBe("50%");
    expect(drLevelNextAt(h, S(35.904))).toBe("Full");
    expect(
      getDRLevelAtTime(
        [
          {
            atSeconds: 35.905,
            durationSeconds: 3.97,
            drInfo: { category: "Disorient", level: "Full", sequenceIndex: 0 },
          },
        ],
        "Disorient",
        35.905,
        T0,
      ),
    ).toBe("50%");
  });

  it("a gap of exactly the reset window resets (≥)", () => {
    const h = [entry(0, 4)];
    expect(getDRLevel(h, S(4 + RESET_S)).level).toBe("Full");
    expect(getDRLevel(h, S(4 + RESET_S - 0.001)).level).toBe("50%");
  });

  it("the chain ends at its LATEST end: a short control inside a long one does not end it", () => {
    // 0–8 and 1–2; at 2 + 16 + 1 = 19 s the long one ended only 11 s before
    const h = [entry(0, 8), entry(1, 2, SLEEP_WALK)];
    expect(getDRLevel(h, S(19)).level).toBe("Immune");
    expect(getDRLevel(h, S(8 + RESET_S)).level).toBe("Full");
  });
});

describe("drLevelAtLanding — the application itself out by identity, not by time", () => {
  it("its own entry does not diminish it", () => {
    const h = [entry(10, 16)];
    expect(
      drLevelAtLanding(h, { applyMs: S(10), spellId: FEAR, srcUnitId: "e" }),
    ).toBe("Full");
  });

  it("another source's control landing on the same ms does", () => {
    const h = [entry(10, 16), entry(10, 13, SLEEP_WALK, "e2")];
    expect(
      drLevelAtLanding(h, { applyMs: S(10), spellId: FEAR, srcUnitId: "e" }),
    ).toBe("50%");
  });

  it("a landing a re-send moved is still found by its span", () => {
    const h = [entry(10, 16)];
    expect(
      drLevelAtLanding(h, { applyMs: S(10.4), spellId: FEAR, srcUnitId: "e" }),
    ).toBe("Full");
  });
});

describe("the DR history's sources (isDrHistorySource)", () => {
  it("every source but a holder-self aura that is not a control", () => {
    expect(isDrHistorySource("h", "e", FEAR, "DEBUFF")).toBe(true);
    expect(isDrHistorySource("h", "h", SLEEP_WALK, "DEBUFF")).toBe(true); // reflected
    expect(isDrHistorySource("h", "h", "1", "DEBUFF")).toBe(false);
  });

  it("the holder's own BUFF under a control's id is not reflected (F20 residual)", () => {
    // 321d51ac 1:48: Illidan's Grasp 205630 is a BUFF on the Demon Hunter
    // channelling it — not a stun reflected back onto it
    expect(isDrHistorySource("h", "h", "205630", "BUFF")).toBe(false);
    expect(isDrHistorySource("h", "h", "205630", "DEBUFF")).toBe(true);
    const dh = makeUnit("h", {
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "205630",
          S(10),
          "h",
          "h",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "205630",
          S(14.5),
          "h",
          "h",
          "BUFF",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "200200", S(19), "pri", "h"), // Chastise (stun)
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "200200", S(22), "pri", "h"),
      ],
    });
    const h = buildCcCategoryHistory(dh as never, getDRCategory("200200"), T0);
    expect(h.map((x) => x.spellId)).toEqual(["200200"]);
    expect(
      drLevelAtLanding(h, {
        applyMs: S(19),
        spellId: "200200",
        srcUnitId: "pri",
      }),
    ).toBe("Full");
  });

  it("buildCcCategoryHistory holds a control reflected back onto the holder and a pet's", () => {
    const holder = makeUnit("h", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, SLEEP_WALK, S(10), "h", "h"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          SLEEP_WALK,
          S(10.6),
          "h",
          "h",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "6358", S(30), "imp", "h"), // Seduction
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "6358", S(33), "imp", "h"),
      ],
    });
    const h = buildCcCategoryHistory(holder as never, getDRCategory(FEAR), T0);
    expect(h.map((x) => [x.spellId, x.srcUnitId, x.atSeconds])).toEqual([
      [SLEEP_WALK, "h", 10],
      ["6358", "imp", 30],
    ]);
  });
});

describe("a REFRESH its source recast for is a DR step (ruling A51)", () => {
  // a400c9d8-r0 1:47–1:54: Fear APPLIED, the Warlock recasts Fear onto the
  // still-feared target 3.5 s later (only a REFRESH is logged), it ends 3 s
  // after that; the Howl of Terror 6.5 s later is logged IMMUNE
  const holderWith = () =>
    makeUnit("h", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FEAR, S(10), "lock", "h"),
        makeAuraEvent(LogEvent.SPELL_AURA_REFRESH, FEAR, S(13.5), "lock", "h"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, FEAR, S(16.5), "lock", "h"),
      ],
    });
  const lock = (recast: boolean) =>
    makeUnit("lock", {
      spellCastEvents: [
        makeSpellCastEvent("5782", S(10), "h", "H", "lock"),
        ...(recast
          ? [makeSpellCastEvent("5782", S(13.5), "h", "H", "lock")]
          : []),
      ],
    });
  const history = (recast: boolean) =>
    buildCcCategoryHistory(
      holderWith() as never,
      getDRCategory(FEAR),
      T0,
      new Map([["lock", lock(recast) as never]]),
    );

  it("recast: two applications, and the next control is immune", () => {
    const h = history(true);
    expect(h.map((x) => [x.atSeconds, x.durationSeconds])).toEqual([
      [10, 3.5],
      [13.5, 3],
    ]);
    expect(drLevelNextAt(h, S(23))).toBe("Immune");
  });

  it("a bare REFRESH (no recast) is a DR step too (F20 dr: the game re-times it at the next tier)", () => {
    // 605 corpus: 29 of 32 bare REFRESHes of a control that ran out ended at
    // REFRESH + the next tier's length, none at the first landing's end; the
    // next same-family control within 20 s was IMMUNE 7 / 7
    const h = history(false);
    expect(h.map((x) => [x.atSeconds, x.durationSeconds])).toEqual([
      [10, 3.5],
      [13.5, 3],
    ]);
    expect(drLevelNextAt(h, S(23))).toBe("Immune");
  });
});

describe("[CC BROKEN]'s remainder reads the whole DR history (D29)", () => {
  it("a Fear 9.4 s after a Sleep Walk reflected back onto the holder ran at 50 %", () => {
    const holder = makeUnit("h", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, SLEEP_WALK, S(10), "h", "h"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          SLEEP_WALK,
          S(10.6),
          "h",
          "h",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FEAR, S(20), "lock", "h"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_BROKEN_SPELL,
          FEAR,
          S(20.7),
          "lock",
          "h",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, FEAR, S(20.7), "lock", "h"),
      ],
    });
    const left = ccRemainingSeconds({
      spellId: FEAR,
      holder: holder as never,
      caster: undefined,
      applyMs: S(20),
      endMs: S(20.7),
      srcUnitId: "lock",
      matchStartMs: T0,
      roarAtApply: false,
    });
    // 6 s × 50 % − 0.7 s held (it read 5.3 s with opponent sources only)
    expect(left).toBeCloseTo(2.3, 5);
  });
});

describe("[DR CLASH] whose real predecessor is DR-only is not printed", () => {
  const app = (
    at: number,
    caster: string,
    level: "Full" | "50%",
    drOnly?: true,
  ): IOutgoingCCApplication & { drOnly?: true } => ({
    atSeconds: at,
    durationSeconds: 2,
    spellId: FEAR,
    spellName: "Fear",
    casterName: caster,
    casterSpec: "x",
    drInfo: {
      category: "Disorient",
      level,
      sequenceIndex: level === "Full" ? 0 : 1,
    },
    ...(drOnly ? { drOnly } : {}),
  });
  const chain = (
    history: Array<IOutgoingCCApplication & { drOnly?: true }>,
  ): IOutgoingCCChain => ({
    targetName: "t",
    targetSpec: "x",
    applications: history.filter((a) => !a.drOnly),
    drHistory: history,
  });

  it("a teammate's predecessor: a clash", () => {
    expect(
      detectTeammateDrClashes(
        [chain([app(10, "mate", "Full"), app(15, "me", "50%")])],
        T0,
      ),
    ).toHaveLength(1);
  });

  it("a control reflected back onto the target in between: none", () => {
    expect(
      detectTeammateDrClashes(
        [
          chain([
            app(1, "mate", "Full"),
            app(10, "t", "Full", true),
            app(15, "me", "50%"),
          ]),
        ],
        T0,
      ),
    ).toHaveLength(0);
  });
});

describe("F20 residual — the holder's own BUFF under a control's id is no CC on it", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("321d51ac 1:48: a friendly Demon Hunter's Illidan's Grasp BUFF is no [CC ON TEAM] instance and no Stun step", () => {
    const dh = makeUnit("h", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "205630",
          S(10),
          "h",
          "h",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "205630",
          S(14.5),
          "h",
          "h",
          "BUFF",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "200200", S(19), "pri", "h"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "200200", S(22), "pri", "h"),
      ],
    });
    const pri = makeUnit("pri", { reaction: CombatUnitReaction.Hostile });
    const { ccInstances } = analyzePlayerCCAndTrinket(
      dh as never,
      [pri] as never,
      {
        startTime: T0,
        endTime: T0 + 300_000,
        startInfo: { zoneId: "1672" },
      } as never,
    );
    expect(
      ccInstances.map((c) => [c.spellId, c.drInfo?.level ?? null]),
    ).toEqual([["200200", "Full"]]);
  });
});

describe("codex 20-F20-28 #1 — Q1 does not count a landing the log wrote after it on the same ms", () => {
  it("Fear then Blind on 49.009, the Fear broken 2.5 s in: Fear at Full, 3.5 s left (it read the Blind's 50 %: 0.5 s)", () => {
    const BLIND = "2094";
    const holder = makeUnit("h", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          FEAR,
          S(49.009),
          "lock",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          BLIND,
          S(49.009),
          "rogue",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_BROKEN_SPELL,
          FEAR,
          S(51.509),
          "lock",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          FEAR,
          S(51.509),
          "lock",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          BLIND,
          S(52.009),
          "rogue",
          "h",
        ),
      ],
    });
    const left = (spellId: string, src: string, endS: number) =>
      ccRemainingSeconds({
        spellId,
        holder: holder as never,
        caster: undefined,
        applyMs: S(49.009),
        endMs: S(endS),
        srcUnitId: src,
        matchStartMs: T0,
        roarAtApply: false,
      });
    expect(left(FEAR, "lock", 51.509)).toBeCloseTo(3.5, 5);
    // the Blind, logged second, is at 50 % behind the Fear
    const history = buildCcCategoryHistory(
      holder as never,
      getDRCategory(FEAR),
      T0,
    );
    expect(
      drLevelAtLanding(history, {
        applyMs: S(49.009),
        spellId: BLIND,
        srcUnitId: "rogue",
      }),
    ).toBe("50%");
  });
});
