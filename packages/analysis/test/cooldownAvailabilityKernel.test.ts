/**
 * BACKLOG #21 item2 (drift prevention for "the gate predicate is the spec"):
 * this package has two cooldown-availability predicates -- `cdAvailableAt`
 * (cooldowns.ts, reading the already-resolved IMajorCooldownInfo.casts ledger)
 * and `isAvailableAt` (deathOutcomeAnalysis.ts, reading raw
 * unit.spellCastEvents plus an extra resetSpellIds reset expansion). Their data
 * sources differ and they are deliberately not fully unified (see the comments
 * in each file), but the core algorithm -- "available if there is no usage
 * record; otherwise check whether last use + cooldown has reached t" -- is
 * factored into the shared `isCooldownAvailableFromLastUse` that both call.
 *
 * This test guards on two levels:
 * 1. It tests the shared algorithmic kernel's boundary behavior directly.
 * 2. Assert-equal: for exactly corresponding synthetic inputs (no reset spells,
 *    identical cast history), cdAvailableAt and isAvailableAt must reach the
 *    same boolean conclusion -- if either side ever reverts the core criterion
 *    to a locally hand-written formula, this fails the moment it diverges from
 *    the shared kernel's semantics.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  cdAvailableAt,
  cdReadyInTimeAt,
  extractMajorCooldowns,
  IMajorCooldownInfo,
  isCooldownAvailableFromLastUse,
} from "../src/utils/cooldowns";
import {
  isAvailableAt,
  isReadyInTimeAt,
} from "../src/utils/deathOutcomeAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

describe("isCooldownAvailableFromLastUse(共享算法核)", () => {
  it("从未使用(null)→ 全程可用", () => {
    expect(isCooldownAvailableFromLastUse(null, 60, 0)).toBe(true);
    expect(isCooldownAvailableFromLastUse(null, 60, 9999)).toBe(true);
  });

  it("t 恰好等于 上次使用+冷却 → 可用(闭区间)", () => {
    expect(isCooldownAvailableFromLastUse(10, 60, 70)).toBe(true);
  });

  it("t 早于 上次使用+冷却 → 不可用", () => {
    expect(isCooldownAvailableFromLastUse(10, 60, 69)).toBe(false);
  });

  it("t 晚于 上次使用+冷却 → 可用", () => {
    expect(isCooldownAvailableFromLastUse(10, 60, 71)).toBe(true);
  });
});

describe("cdAvailableAt 与 isAvailableAt 在重叠语义上必须同判(断言相等)", () => {
  const SPELL_ID = "642"; // Divine Shield
  const COOLDOWN_SECONDS = 300;
  const MATCH_START = 1_000_000;

  function cdWith(casts: number[]): IMajorCooldownInfo {
    return {
      spellId: SPELL_ID,
      spellName: "Divine Shield",
      tag: "Defensive",
      cooldownSeconds: COOLDOWN_SECONDS,
      maxChargesDetected: 1,
      casts: casts.map((timeSeconds) => ({ timeSeconds })),
      availableWindows: [],
      neverUsed: casts.length === 0,
    };
  }

  function unitWith(casts: number[]) {
    return makeUnit("p1", {
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: casts.map((atSeconds) =>
        makeSpellCastEvent(SPELL_ID, MATCH_START + atSeconds * 1000, "p1"),
      ),
    });
  }

  const scenarios: { name: string; casts: number[]; atSeconds: number }[] = [
    { name: "从未使用", casts: [], atSeconds: 45 },
    { name: "刚用过,CD 未转好", casts: [10], atSeconds: 40 },
    { name: "CD 恰好转好(闭区间边界)", casts: [10], atSeconds: 310 },
    { name: "CD 早已转好", casts: [10], atSeconds: 400 },
    { name: "多次施放取最近一次(仍未转好)", casts: [10, 350], atSeconds: 400 },
    // Follow-up round fix (2026-07-31): isAvailableAt used to take Math.max
    // over every cast of the spellId in the whole match without truncating at
    // atSeconds -- so if the unit cast it again after the query time (450s vs a
    // query at 400s), that future cast was mistaken for the "last use" and a
    // moment that should have been available (one use at 0s, 300s cooldown, so
    // long since ready at 400s) was reported unavailable. Before the fix this
    // scenario failed (viaIsAvailableAt=false, viaCdAvailableAt=true).
    {
      name: "查询时刻之后还有一次重新施放 → 不应倒果为因判定过去不可用",
      casts: [0, 450],
      atSeconds: 400,
    },
    // GH #61 (2026-09-02): both sides read casts through CD_INSTANT_SLACK_S —
    // a press 0.3 s after the instant is "pressed" (same rendered second, as
    // the [RES] ledger shows it), 0.6 s after is not.
    {
      name: "施放落在查询时刻后 0.3s(同一渲染秒)",
      casts: [40.3],
      atSeconds: 40,
    },
    {
      name: "施放落在查询时刻后 0.6s(下一渲染秒)",
      casts: [40.6],
      atSeconds: 40,
    },
  ];

  it("GH #61:查询后 0.3s 内的施放算已按下(不可用),0.6s 后的不算(可用)—— 与 [RES] 台账同容差", () => {
    expect(cdAvailableAt(cdWith([40.3]), 40)).toBe(false);
    expect(
      isAvailableAt(
        unitWith([40.3]),
        SPELL_ID,
        COOLDOWN_SECONDS,
        40,
        MATCH_START,
      ),
    ).toBe(false);
    expect(cdAvailableAt(cdWith([40.6]), 40)).toBe(true);
    expect(
      isAvailableAt(
        unitWith([40.6]),
        SPELL_ID,
        COOLDOWN_SECONDS,
        40,
        MATCH_START,
      ),
    ).toBe(true);
  });

  // Reaction-window twins (REACTION_WINDOW_S, user ruling 2026-09-23): the
  // accusation gates on both paths must agree too, including across the 1 s
  // boundary (back at 310: 310.9 no, 311.1 yes).
  for (const { name, casts, atSeconds } of [
    ...scenarios,
    { name: "转好后 0.9s", casts: [10], atSeconds: 310.9 },
    { name: "转好后 1.1s", casts: [10], atSeconds: 311.1 },
  ]) {
    it(`reaction window: ${name}(casts=${JSON.stringify(casts)}, t=${atSeconds}s)`, () => {
      expect(
        isReadyInTimeAt(
          unitWith(casts),
          SPELL_ID,
          COOLDOWN_SECONDS,
          atSeconds,
          MATCH_START,
        ),
      ).toBe(cdReadyInTimeAt(cdWith(casts), atSeconds));
    });
  }

  for (const { name, casts, atSeconds } of scenarios) {
    it(`${name}(casts=${JSON.stringify(casts)}, t=${atSeconds}s)`, () => {
      const viaCdAvailableAt = cdAvailableAt(cdWith(casts), atSeconds);
      const viaIsAvailableAt = isAvailableAt(
        unitWith(casts),
        SPELL_ID,
        COOLDOWN_SECONDS,
        atSeconds,
        MATCH_START,
      );
      expect(viaIsAvailableAt).toBe(viaCdAvailableAt);
    });
  }
});

/**
 * Task 7 review follow-up (2026-08-14): the assert-equal block above
 * constructs `IMajorCooldownInfo.casts` BY HAND (`cdWith`), so it never runs
 * `extractMajorCooldowns`' own cast-collection logic — it cannot see whether
 * that logic and `isAvailableAt` actually agree on a real code path, only
 * whether their OUTPUTS agree once fed identical hand-built data. This block
 * closes that gap for the aura-only-activation case specifically: it drives
 * `extractMajorCooldowns` for real (the same call the cd ledger/prompt path
 * makes) and asserts its `cdAvailableAt` verdict matches `isAvailableAt`'s,
 * for a unit whose ONLY evidence of Renewing Blaze (374348) is a self-applied
 * buff aura (374349) — zero SPELL_CAST_SUCCESS events, exactly Task 7's
 * confirmed real-world shape (match 76ea5f90). Before `lastCastSeconds` was
 * taught to consume `auraOnlyActivationSeconds`, this failed: the ledger
 * (via `extractMajorCooldowns`) correctly saw the aura and reported the CD on
 * cooldown, while `isAvailableAt` — reading raw `spellCastEvents` only —
 * still called it available.
 */
describe("cdAvailableAt 与 isAvailableAt 对「仅有光环证据」的技能也必须同判(374348 Renewing Blaze,穿两条真实代码路径)", () => {
  const SPELL_ID = "374348";
  const AURA_ID = "374349";
  const COOLDOWN_SECONDS = 90; // spellEffectOverrides' value for 374348, no CD_TALENT_MODIFIERS entry
  const MATCH_START = 1_000_000;

  function unitWithAuraOnly(auraAtSeconds: number) {
    return makeUnit("p1", {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Devastation,
      spellCastEvents: [], // zero cast evidence — proc-only ability, by design
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          AURA_ID,
          MATCH_START + auraAtSeconds * 1000,
          "p1",
          "p1",
          "BUFF",
        ),
      ],
    });
  }

  const scenarios: {
    name: string;
    auraAt: number;
    atSeconds: number;
    timerDone: boolean;
  }[] = [
    { name: "光环刚触发,CD 未转好", auraAt: 10, atSeconds: 40, timerDone: false },
    { name: "CD 恰好转好(闭区间边界)", auraAt: 10, atSeconds: 100, timerDone: true },
    { name: "CD 早已转好", auraAt: 10, atSeconds: 300, timerDone: true },
  ];

  for (const { name, auraAt, atSeconds, timerDone } of scenarios) {
    it(`${name}(aura@${auraAt}s, t=${atSeconds}s)`, () => {
      const unit = unitWithAuraOnly(auraAt);
      const combat = {
        startTime: MATCH_START,
        endTime: MATCH_START + 300_000,
        units: { p1: unit },
      } as unknown as AtomicArenaCombat;

      const cds = extractMajorCooldowns(unit, combat);
      const renewingBlaze = cds.find((cd) => cd.spellId === SPELL_ID);
      expect(renewingBlaze).toBeDefined();
      const viaCdAvailableAt = cdAvailableAt(renewingBlaze!, atSeconds);

      const viaIsAvailableAt = isAvailableAt(
        unit,
        SPELL_ID,
        COOLDOWN_SECONDS,
        atSeconds,
        MATCH_START,
      );

      expect(viaIsAvailableAt).toBe(viaCdAvailableAt);
      // GH #106 step 2: Renewing Blaze has no button, so both predicates say
      // "not available" at every instant ...
      expect(viaCdAvailableAt).toBe(false);
      // ... while the aura evidence still drives the ledger's timer exactly as
      // before (the gate is the only difference).
      expect(
        cdAvailableAt({ ...renewingBlaze!, isProcOnly: false }, atSeconds),
      ).toBe(timerDone);
    });
  }
});
