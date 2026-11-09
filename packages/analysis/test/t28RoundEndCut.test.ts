/**
 * T28: `[RES]` listed a living enemy's effect with time left past a Solo
 * Shuffle round's end when the log shows every aura of it gone by then
 * (f22d547e: `Power Infusion/Discipline Priest(10s left)` on the death row —
 * the span had no observed end and ran to the official 15 s). A Solo
 * Shuffle round's end cuts it (`cutAtRoundEnd`); the corpus check is
 * scan5 fact12 `resEnemyEffectAfterDeath` kind `effect over (round over)`.
 */
import {
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { burstCastSpan } from "../src/utils/burstLedger";
import {
  casterAuraOutlives,
  cutAtRoundEnd,
  type IEnemyCDCast,
} from "../src/utils/enemyCDs";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;
const PI = "10060";
const ROUND_END_S = 20;

const priest = (removedAtS: number | null, appliedAtS = 10): ICombatUnit => {
  const p = makeUnit("e2", {
    name: "Priest",
    spec: CombatUnitSpec.Priest_Discipline,
  });
  const mate = makeUnit("e1", {
    name: "Mate",
    spec: CombatUnitSpec.Warrior_Arms,
    auraEvents: [
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          PI,
          START + appliedAtS * 1000,
          "e2",
          "e1",
          "BUFF",
        ),
        srcUnitName: "Priest",
      },
      ...(removedAtS === null
        ? []
        : [
            {
              ...makeAuraEvent(
                LogEvent.SPELL_AURA_REMOVED,
                PI,
                START + removedAtS * 1000,
                "e2",
                "e1",
                "BUFF",
              ),
              srcUnitName: "Priest",
            },
          ]),
    ],
  });
  (p as unknown as { mate: ICombatUnit }).mate = mate;
  return p;
};
const combatOf = (p: ICombatUnit) =>
  ({
    startTime: START,
    endTime: START + 24_000,
    units: { e2: p, e1: (p as unknown as { mate: ICombatUnit }).mate },
  }) as unknown as Parameters<typeof cutAtRoundEnd>[2];
const piCast = (): IEnemyCDCast =>
  ({
    spellId: PI,
    spellName: "Power Infusion",
    castTimeSeconds: 10,
    cooldownSeconds: 120,
    availableAgainAtSeconds: 130,
    dangerWeight: 1,
    buffEndSeconds: 25,
  }) as IEnemyCDCast;

const enemyField = (cd: IEnemyCDCast, t: number) =>
  buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Restoration Druid",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: {
      players: [
        {
          playerName: "Priest",
          specName: "Discipline Priest",
          offensiveCDs: [cd],
        },
      ],
      alignedBurstWindows: [],
    } as never,
    matchStartMs: START,
  }).match(/enemy:(.+?)(?: {2}|$)/)?.[1];

describe("T28 — an effect the round's end ended is over from its second", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("every aura gone by the round end's cascade: cut at the round end", () => {
    const p = priest(ROUND_END_S + 0.02);
    const cd = piCast();
    cutAtRoundEnd([cd], START + ROUND_END_S * 1000, combatOf(p), p);
    expect(cd.deathCutAtSeconds).toBeCloseTo(ROUND_END_S, 3);
    expect(enemyField(cd, 19)).toContain(
      "Power Infusion/Discipline Priest(6s left)",
    );
    expect(enemyField(cd, ROUND_END_S)).toBeUndefined();
    // codex 80-PIPE-29-B29 #1: the burst span ends at the cut too, the
    // official end kept beside it
    expect(cd.buffEndSeconds).toBeCloseTo(ROUND_END_S, 3);
    expect(cd.deathCutOfficialEndSeconds).toBe(25);
    expect(burstCastSpan(cd).to).toBeCloseTo(ROUND_END_S, 3);
  });

  it("an aura running past the round's end: no cut", () => {
    for (const removed of [23, null]) {
      const p = priest(removed);
      const cd = piCast();
      cutAtRoundEnd([cd], START + ROUND_END_S * 1000, combatOf(p), p);
      expect(cd.deathCutAtSeconds).toBeUndefined();
    }
  });

  it("no aura of the name (the log cannot say), a span ending by the round end, no round end: no cut", () => {
    const p = priest(ROUND_END_S + 0.02);
    const other = { ...piCast(), spellId: "107574", spellName: "Avatar" };
    const early = { ...piCast(), buffEndSeconds: 18.5 };
    cutAtRoundEnd([other, early], START + ROUND_END_S * 1000, combatOf(p), p);
    for (const cd of [other, early])
      expect(cd.deathCutAtSeconds).toBeUndefined();
    const none = piCast();
    cutAtRoundEnd([none], undefined, combatOf(p), p);
    cutAtRoundEnd([none], START + 24_000, combatOf(p), p);
    expect(none.deathCutAtSeconds).toBeUndefined();
  });

  // 1-6-16 r6: a press in the log's tail past the round (Touch of the Magi
  // after the round-ending death) is over from the round's end too
  it("a press after the round's end, its name's auras gone by then: cut at the round end", () => {
    const p = priest(ROUND_END_S + 0.02);
    const late = { ...piCast(), castTimeSeconds: 20.5, buffEndSeconds: 20.5 };
    cutAtRoundEnd([late], START + ROUND_END_S * 1000, combatOf(p), p);
    expect(late.deathCutAtSeconds).toBeCloseTo(ROUND_END_S, 3);
    expect(enemyField(late, ROUND_END_S)).toBeUndefined();
  });

  // 24-1-127 r1: an effect ended in the round end's own second, before it
  // (Avatar REMOVED 39.9 s, the round over 39.966 s) — `(1s left)` on the
  // death row
  it("an effect ending inside the round end's second: cut, not listed on the end's row", () => {
    const p = priest(ROUND_END_S + 0.02);
    const cd = { ...piCast(), buffEndSeconds: 20.6 };
    const endMs = START + 20_700;
    cutAtRoundEnd([cd], endMs, combatOf(p), p);
    expect(cd.deathCutAtSeconds).toBeCloseTo(20.7, 3);
    expect(enemyField(cd, 20)).toBeUndefined();
  });

  it("an earlier cut keeps its instant; a later one — the caster's death after the round's end — gives way to the round's end (codex T28-1 #2)", () => {
    const p = priest(ROUND_END_S + 0.02);
    const cd = { ...piCast(), deathCutAtSeconds: 18 };
    cutAtRoundEnd([cd], START + ROUND_END_S * 1000, combatOf(p), p);
    expect(cd.deathCutAtSeconds).toBe(18);
    const later = { ...piCast(), deathCutAtSeconds: 21.05 };
    cutAtRoundEnd([later], START + ROUND_END_S * 1000, combatOf(p), p);
    expect(later.deathCutAtSeconds).toBeCloseTo(ROUND_END_S, 3);
    expect(enemyField(later, ROUND_END_S)).toBeUndefined();
  });

  // codex T28-1 #1: pressed 50 ms before the round's end, applied 150 ms
  // after it, ran 3 s on — the effect outlives the round's end
  it("an aura applied after the round's end and running on: no cut", () => {
    const p = priest(23, ROUND_END_S + 0.15);
    const cd = { ...piCast(), castTimeSeconds: 19.95, buffEndSeconds: 23 };
    cutAtRoundEnd([cd], START + ROUND_END_S * 1000, combatOf(p), p);
    expect(cd.deathCutAtSeconds).toBeUndefined();
    expect(enemyField(cd, 21)).toContain(
      "Power Infusion/Discipline Priest(2s left)",
    );
  });

  // codex T28-1b: a later, unrelated application — retained past the
  // combat's end, clamped by the builder to a zero-length interval — is no
  // copy of the effect being cut
  it("a later application (clamped to the combat's end) does not outlive the cut", () => {
    const p = priest(15);
    const mate = (p as unknown as { mate: ICombatUnit }).mate;
    (mate.auraEvents as unknown[]).push({
      ...makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        PI,
        START + 40_000,
        "e2",
        "e1",
        "BUFF",
      ),
      srcUnitName: "Priest",
    });
    const combat = {
      startTime: START,
      endTime: START + 17_000,
      units: { e2: p, e1: mate },
    };
    expect(
      casterAuraOutlives(p, "Power Infusion", START + 15_140, combat),
    ).toEqual({ any: true, outlives: false });
  });

  // codex T28-1c: the only application of the name lies past the combat's
  // end — the log shows no aura of it inside the round, so it cannot say the
  // round's end ended the effect
  it("an application only past the combat's end is no evidence: no cut", () => {
    const p = makeUnit("e2", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
    });
    const mate = makeUnit("e1", {
      name: "Mate",
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            PI,
            START + 40_000,
            "e2",
            "e1",
            "BUFF",
          ),
          srcUnitName: "Priest",
        },
      ],
    });
    const combat = {
      startTime: START,
      endTime: START + 17_000,
      units: { e2: p, e1: mate },
    };
    expect(
      casterAuraOutlives(p, "Power Infusion", START + 15_040, combat),
    ).toEqual({ any: false, outlives: false });
    const cd = piCast();
    cutAtRoundEnd(
      [cd],
      START + 15_040,
      combat as unknown as Parameters<typeof cutAtRoundEnd>[2],
      p,
    );
    expect(cd.deathCutAtSeconds).toBeUndefined();
  });
});
