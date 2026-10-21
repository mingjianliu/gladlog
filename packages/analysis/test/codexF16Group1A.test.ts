/**
 * codex review of F16, group 1A (2026-10-21) — four findings, each pinned on
 * the fixed behaviour:
 *
 *  A1 a friendly debuff on an enemy (Touch of the Magi 210824) is not an
 *     enemy burst starting: `detectPanicDefensives`' post-cast check
 *     (`offensiveThreatStartedAfter`) skips DEBUFF rows, as
 *     `hasOffensiveSpellActive` already did for the at-cast check.
 *  A2 a deferral shield's SPELL_ABSORBED (Stretch Time 410355) is not
 *     absorbed damage (`isDeferralAbsorb`) — the kill-window bursts and the
 *     window's absorbed total leave it out; a real shield (PW:S 17) counts.
 *  A3 a Grounding redirect of a control whose cast id differs from its aura id
 *     (Lightning Lasso cast 305483, aura 305485) is credited by the cast-side
 *     predicate `isControlCast`, as `[GROUNDED]` (`groundedControls`) is.
 *  A4 `killWindowAcquittal` keeps the press-only qualification when a
 *     maybe-ready cooldown is also present.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { groundedControls } from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import { ccSpellIds } from "../src/data/spellTags";
import { isControlCast } from "../src/utils/castMissRows";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { detectPanicDefensives } from "../src/utils/cooldowns";
import {
  killWindowAcquittal,
  killWindowFactsSuffix,
} from "../src/utils/killWindowFacts";
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("A1 — a friendly debuff on an enemy is not an enemy burst starting", () => {
  const BARKSKIN = "22812";
  const TOUCH_OF_THE_MAGI_AURA = "210824";
  const COMBUSTION = "190319";
  const combat = { startTime: T0, endTime: at(120) };

  const aura = (
    event: LogEvent,
    spellId: string,
    s: number,
    src: string,
    auraType: "BUFF" | "DEBUFF",
  ) => ({
    ...makeAuraEvent(event, spellId, at(s), src, "enemy-1", auraType),
    auraType,
  });

  const setup = (enemyAuras: ReturnType<typeof aura>[]) => {
    const druid = makeUnit("druid-1", {
      name: "Druid",
      spec: CombatUnitSpec.Druid_Balance,
      spellCastEvents: [
        makeSpellCastEvent(BARKSKIN, at(25), "druid-1", "Druid", "druid-1"),
      ] as never,
      damageIn: [],
    });
    const mage = makeUnit("mage-1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Arcane,
    });
    const enemy = makeUnit("enemy-1", {
      reaction: CombatUnitReaction.Hostile,
      auraEvents: enemyAuras as never,
    });
    return detectPanicDefensives([druid, mage], [enemy], combat);
  };

  it("Barkskin at 25 s stays a panic press when our mage's Touch of the Magi lands on the enemy 1 s later", () => {
    const result = setup([
      aura(
        LogEvent.SPELL_AURA_APPLIED,
        TOUCH_OF_THE_MAGI_AURA,
        26,
        "mage-1",
        "DEBUFF",
      ),
      aura(
        LogEvent.SPELL_AURA_REMOVED,
        TOUCH_OF_THE_MAGI_AURA,
        36,
        "mage-1",
        "DEBUFF",
      ),
    ]);
    expect(result.map((r) => r.spellId)).toEqual([BARKSKIN]);
  });

  it("…the same debuff over the cast (20–30 s) does not hide it either", () => {
    const result = setup([
      aura(
        LogEvent.SPELL_AURA_APPLIED,
        TOUCH_OF_THE_MAGI_AURA,
        20,
        "mage-1",
        "DEBUFF",
      ),
      aura(
        LogEvent.SPELL_AURA_REMOVED,
        TOUCH_OF_THE_MAGI_AURA,
        30,
        "mage-1",
        "DEBUFF",
      ),
    ]);
    expect(result.map((r) => r.spellId)).toEqual([BARKSKIN]);
  });

  it("control: the enemy's own Combustion buff 1 s after the cast still makes it a pre-wall", () => {
    const result = setup([
      aura(LogEvent.SPELL_AURA_APPLIED, COMBUSTION, 26, "enemy-1", "BUFF"),
      aura(LogEvent.SPELL_AURA_REMOVED, COMBUSTION, 36, "enemy-1", "BUFF"),
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("A2 — a deferral shield's absorb is not a burst", () => {
  const combat = { startTime: T0, endTime: at(60), units: {} } as never;

  const absorb = (shieldId: string, s: number, amount: number) => ({
    logLine: {
      event: LogEvent.SPELL_ABSORBED,
      timestamp: at(s),
      parameters: [],
    },
    timestamp: at(s),
    spellId: shieldId,
    spellName: shieldId,
    srcUnitId: "e1",
    srcUnitName: "EnemyDruid",
    destUnitId: "e1",
    destUnitName: "EnemyDruid",
    absorbedAmount: amount,
    attackerId: "f1",
    attackSpellId: "133",
    attackSpellName: "Fireball",
  });

  // Barkskin at 2 s is the druid's only tracked wall: it runs out and the
  // druid is defenseless until it returns (offensiveWindowsExternals.test.ts)
  const windowsWith = (shieldId: string) => {
    const enemy = makeUnit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          "22812",
          at(2),
          "e1",
          "EnemyDruid",
          "e1",
          "EnemyDruid",
        ),
      ] as never,
      absorbsIn: [
        absorb(shieldId, 30, 20_000),
        absorb(shieldId, 31, 20_000),
      ] as never,
      damageIn: [],
    });
    const mage = makeUnit("f1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
    });
    const ws = computeOffensiveWindows(
      [enemy] as never,
      [mage] as never,
      combat,
    );
    expect(ws).toHaveLength(1);
    return ws[0]!;
  };

  it("Stretch Time 410355 deferring 40k with nothing landed: no burst, no absorbed figure", () => {
    const w = windowsWith("410355");
    expect(w.friendlyDamageInWindow).toBe(0);
    expect(w.friendlyAbsorbedInWindow).toBe(0);
    expect(w.bursts).toEqual([]);
  });

  it("control: Power Word: Shield 17 eating the same 40k still counts as absorbed and finds the burst", () => {
    const w = windowsWith("17");
    expect(w.friendlyDamageInWindow).toBe(0);
    expect(w.friendlyAbsorbedInWindow).toBe(40_000);
    expect(w.bursts).toHaveLength(1);
    expect(w.bursts[0]).toMatchObject({ damage: 0, absorbed: 40_000 });
  });
});

describe("A3 — a Grounding redirect is credited by the cast-side control predicate", () => {
  const TOTEM = "Creature-0-0-0-0-5925-0000000001";

  const run = (castId: string, castName: string) => {
    const shaman = makeUnit("s1", {
      name: "Shammy",
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [
        makeSpellCastEvent("204336", at(20), "s1", "Shammy", "s1", "Shammy"),
      ] as never,
    });
    const cast = {
      ...makeSpellCastEvent(
        castId,
        at(21),
        TOTEM,
        "Grounding Totem",
        "e1",
        "EnemyShaman",
      ),
      spellName: castName,
    };
    const enemy = makeUnit("e1", {
      name: "EnemyShaman",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Enhancement,
      spellCastEvents: [cast] as never,
    });
    return {
      grounded: groundedControls([enemy], T0, new Set()).map(
        (g) => `${g.spellId}@${g.atSeconds}`,
      ),
      avoided: analyzePlayerCCAndTrinket(shaman, [enemy], {
        startTime: T0,
        endTime: at(60),
        startInfo: { zoneId: "1" },
      }).ccAvoidedInstances.map(
        (x) => `${x.spellId}@${x.atSeconds} via ${x.avoidanceSpellName}`,
      ),
    };
  };

  it("Lightning Lasso's cast id 305483 is not in the aura-keyed set, but is a control cast", () => {
    expect(ccSpellIds.has("305483")).toBe(false);
    expect(ccSpellIds.has("305485")).toBe(true);
    expect(isControlCast("305483")).toBe(true);
  });

  it("Lightning Lasso 305483 into the totem at 21 s is in [GROUNDED] and in ccAvoidedInstances", () => {
    const r = run("305483", "Lightning Lasso");
    expect(r.grounded).toEqual(["305483@21"]);
    expect(r.avoided).toEqual(["305483@21 via Grounding Totem"]);
  });

  it("control: Hex 51514 (same id cast and aura) is credited as before", () => {
    const r = run("51514", "Hex");
    expect(r.grounded).toEqual(["51514@21"]);
    expect(r.avoided).toEqual(["51514@21 via Grounding Totem"]);
  });
});

describe("A4 — killWindowAcquittal keeps the press-only qualification beside a maybe-ready CD", () => {
  const PRESS_ONLY = { readyPressOnlyCds: ["Malevolence [press-only]"] };
  const MAYBE = {
    maybeOffCds: [{ name: "Adrenaline Rush", withinSeconds: 5 }],
  };
  const facts = (extra: object) =>
    ({ readyOffCds: [] as string[], readyAtSecond: 30, ...extra }) as never;

  it("press-only ready + maybe-ready: the acquittal no longer contradicts the ready list", () => {
    const f = facts({ ...PRESS_ONLY, ...MAYBE });
    expect(killWindowFactsSuffix(f)).toBe(
      "team offensive CDs ready at 0:30: Malevolence [press-only] (may already be back: Adrenaline Rush ≤5s)",
    );
    expect(killWindowAcquittal(f)).toBe(
      "no offensive CD certainly ready but [press-only] ones, which are never counted (may already be back: Adrenaline Rush ≤5s)",
    );
  });

  it("maybe-ready only", () => {
    expect(killWindowAcquittal(facts(MAYBE))).toBe(
      "no offensive CD certainly ready (may already be back: Adrenaline Rush ≤5s)",
    );
  });

  it("press-only only", () => {
    expect(killWindowAcquittal(facts(PRESS_ONLY))).toBe(
      "no offensive CD was ready but [press-only] ones, which are never counted",
    );
  });

  it("neither", () => {
    expect(killWindowAcquittal(facts({}))).toBe("no offensive CD was ready");
  });
});
