/**
 * Gap-closer state at an instant (`gapCloserStateAt`) — kick-eaten's
 * out-range gate, triage 2026-09-29 F-K6b, user rulings A12 = B and U2.
 */
import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import {
  GAP_CLOSER_BUTTONS,
  GAP_CLOSER_COOLDOWN_UNKNOWN_IDS,
  GAP_CLOSER_SPELL_IDS,
  gapCloserStateAt,
  gapCloserStateOver,
} from "../src/utils/gapClosers";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const CHARGE = "100";
const SHADOWSTEP = "36554";
const DEATH_GRIP = "49576";

/** A kicker who cast `[spellId, seconds]` this round. Talents known (an
 * empty blob) unless `talents` is false — a pet, or a player whose
 * COMBATANT_INFO carried none. */
function kicker(
  casts: Array<[string, number]>,
  spec = CombatUnitSpec.Warrior_Arms,
  talents = true,
) {
  return makeUnit("e1", {
    name: "Kicker",
    spec,
    reaction: CombatUnitReaction.Hostile,
    ...(talents ? { info: { talents: [], pvpTalents: [] } as never } : {}),
    spellCastEvents: casts.map(([id, s]) =>
      makeSpellCastEvent(
        id,
        T0 + s * 1000,
        "e1",
        "Kicker",
        "p1",
        "Owner",
        0,
        id,
      ),
    ),
  });
}
const at = (u: ReturnType<typeof kicker>, s: number) =>
  gapCloserStateAt(u, T0 + s * 1000, T0);

describe("GAP_CLOSER_SPELL_IDS", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("every id is alive in the corpus", () => {
    const seen = new Set((observed as number[]).map(String));
    expect([...GAP_CLOSER_SPELL_IDS].filter((id) => !seen.has(id))).toEqual([]);
  });

  it("every button resolves to a DB2 cooldown through one of its ids, except the pinned unknowns", () => {
    const missing = GAP_CLOSER_BUTTONS.filter((ids) =>
      ids.every((id) => effectiveCooldownSeconds(id) === undefined),
    ).flat();
    expect(missing.sort()).toEqual([...GAP_CLOSER_COOLDOWN_UNKNOWN_IDS].sort());
  });

  it("carries the ids the log writes for a cast: Heroic Leap 52174 and Metamorphosis 200166 sit in the buttons of 6544 / 191427 (605-file scan: 6544 x0 and 191427 x0 as a cast)", () => {
    const buttonOf = (id: string) =>
      GAP_CLOSER_BUTTONS.find((ids) => ids.includes(id));
    expect(buttonOf("52174")).toEqual(buttonOf("6544"));
    expect(buttonOf("200166")).toEqual(buttonOf("191427"));
    expect(GAP_CLOSER_SPELL_IDS.has("3411")).toBe(true); // Intervene
  });

  it("holds no pull (ruling U2: Death Grip moves the target, not the caster)", () => {
    expect(GAP_CLOSER_SPELL_IDS.has(DEATH_GRIP)).toBe(false);
    expect(GAP_CLOSER_SPELL_IDS.has("108199")).toBe(false); // Gorefiend's Grasp
  });
});

describe("gapCloserStateAt", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a gap-closer cast in the last second is 'used' (dfcccbf2 @79.3: Charge 0.33 s before the cast start)", () => {
    const s = at(kicker([[CHARGE, 77.788]]), 78.116);
    expect(s).toMatchObject({ state: "used", spellName: "Charge" });
    expect(s?.state === "used" ? s.agoS : NaN).toBeCloseTo(0.328, 3);
  });

  it("condition 3 alone: seen earlier, off cooldown, not used in the window → 'ready'", () => {
    expect(at(kicker([[CHARGE, 5]]), 60)).toMatchObject({
      state: "ready",
      spellName: "Charge",
    });
  });

  it("on cooldown at the instant → null", () => {
    expect(at(kicker([[CHARGE, 50]]), 60)).toBeNull();
  });

  it("recharge boundary: back at the instant though not one second earlier → 'ready' (no reaction-window look-back)", () => {
    // Charge: 20 s recharge, 1 charge. Cast at 1.0 s → back at 21.0 s.
    const u = kicker([[CHARGE, 1.0]]);
    expect(at(u, 21.5)).toMatchObject({ state: "ready" });
    expect(at(u, 20.5)).toBeNull();
  });

  it("a gap-closer seen from the unit with no DB2 cooldown is 'unknown' — and unknown closes", () => {
    expect(
      at(kicker([[SHADOWSTEP, 5]], CombatUnitSpec.Rogue_Subtlety), 60),
    ).toMatchObject({ state: "unknown", spellName: "Shadowstep" });
  });

  it("a gap-closer the unit never cast this round is not counted", () => {
    expect(at(kicker([]), 60)).toBeNull();
    expect(at(kicker([["6552", 30]]), 60)).toBeNull(); // only Pummel
  });

  it("a pull is not a gap-closer (U2)", () => {
    expect(
      at(kicker([[DEATH_GRIP, 59.8]], CombatUnitSpec.DeathKnight_Frost), 60),
    ).toBeNull();
  });

  it("Wild Charge's forms are one cooldown (138e632d @138: cat-form cast 3.4 s earlier, bear-form id cast later)", () => {
    const feral = kicker(
      [
        ["49376", 134.634],
        ["16979", 172.574],
      ],
      CombatUnitSpec.Druid_Feral,
    );
    expect(at(feral, 138.0)).toBeNull(); // 15 s cooldown still running
    expect(at(feral, 150.0)).toMatchObject({ state: "ready" });
  });

  it("Heroic Leap is seen through its logged cast id and priced by 6544's cooldown (49643222 @154.9)", () => {
    const warrior = kicker([["52174", 100]]);
    expect(at(warrior, 100.5)).toMatchObject({
      state: "used",
      spellName: "Heroic Leap",
    });
    expect(at(warrior, 105)).toBeNull(); // 45 s cooldown running
    expect(at(warrior, 160)).toMatchObject({ state: "ready" });
  });

  it("without the unit's talents the cooldown is only the base: not up by it is 'unknown', up by it is 'ready' (a Felguard's Pursuit)", () => {
    const pet = kicker([[CHARGE, 50]], CombatUnitSpec.Warrior_Arms, false);
    expect(at(pet, 60)).toMatchObject({
      state: "unknown",
      spellName: "Charge",
    });
    expect(at(pet, 80)).toMatchObject({ state: "ready" });
  });

  it("'used' wins over another gap-closer that is ready", () => {
    const s = at(
      kicker([
        ["6544", 5], // Heroic Leap, long since back
        [CHARGE, 59.7],
      ]),
      60,
    );
    expect(s).toMatchObject({ state: "used", spellName: "Charge" });
  });
});

describe("gapCloserStateOver — from the cast's start to the kick", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const over = (u: ReturnType<typeof kicker>, fromS: number, toS: number) =>
    gapCloserStateOver(u, T0 + fromS * 1000, T0 + toS * 1000, T0);

  it("the state at the start when there is one", () => {
    expect(over(kicker([[CHARGE, 5]]), 60, 61.5)).toMatchObject({
      state: "ready",
    });
    expect(over(kicker([[CHARGE, 59.6]]), 60, 61.5)).toMatchObject({
      state: "used",
    });
  });

  it("a gap-closer cast during the cast closes: Charge back 0.1 s after the start and pressed before the Pummel", () => {
    // Charge at -1.4 s, 20 s recharge -> back at 18.6 s; cast start 18.5 s
    const u = kicker([
      [CHARGE, -1.4],
      [CHARGE, 19.2],
    ]);
    expect(at(u, 18.5)).toBeNull();
    const s = over(u, 18.5, 20.0);
    expect(s).toMatchObject({ state: "used-during", spellName: "Charge" });
    expect(s?.state === "used-during" ? s.afterS : NaN).toBeCloseTo(0.7, 3);
  });

  it("one that came off cooldown during the cast and was not pressed is 'ready-during'", () => {
    const u = kicker([[CHARGE, -1.4]]);
    expect(over(u, 18.5, 20.0)).toMatchObject({ state: "ready-during" });
    // still down at the kick: nothing
    expect(over(u, 16.0, 18.0)).toBeNull();
  });
});
