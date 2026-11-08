/**
 * T05 (fact12 A6 / B7 / C19): a Havoc Metamorphosis pressed before a Solo
 * Shuffle round's deciding death whose 200166 landing row was logged after
 * it is this round's press. 52a97230 r0: the 162264 aura went up at
 * 0:32.885, the deciding death came at 0:33.744 and the landing at 0:33.809;
 * the kit read `Metamorphosis [120s] [UNUSED]` while `[ENEMY CD]` (the aura
 * start) printed the press. The corpus check is
 * `packages/eval/scripts/scan5/fact12e.ts`.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { extractMajorCooldowns } from "../src/utils/cooldowns";
import { metamorphosisPressActivationMs } from "../src/utils/offensiveAuraOccurrences";
import { SOLO_SHUFFLE_BRACKET } from "../src/utils/roundEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const DEATH_S = 33.744;
const AURA_S = 32.885;
const LANDING_S = 33.809;

beforeAll(async () => {
  await ensureAnalysisData();
});

const dh = (auraS: number | null, landingS: number): ICombatUnit =>
  makeUnit("player-1", {
    name: "Dh",
    class: CombatUnitClass.DemonHunter,
    spec: CombatUnitSpec.DemonHunter_Havoc,
    info: {},
    spellCastEvents: [makeSpellCastEvent("200166", at(landingS), "player-1")],
    auraEvents:
      auraS === null
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_APPLIED,
              "162264",
              at(auraS),
              "player-1",
              "player-1",
              "BUFF",
            ),
          ],
  });

const mate = () =>
  makeUnit("player-2", {
    name: "Mate",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Arms,
    info: {},
    deathRecords: [{ timestamp: at(DEATH_S) }],
  });

const metaOf = (u: ICombatUnit) => {
  const combat = {
    startTime: T0,
    endTime: at(DEATH_S + 2),
    startInfo: { bracket: SOLO_SHUFFLE_BRACKET },
    units: { [u.id]: u, "player-2": mate() },
  } as never;
  return extractMajorCooldowns(u, combat).find((c) => c.spellId === "191427");
};

describe("T05 — a Metamorphosis up before the round's end is its press", () => {
  it("the activation is the press's own 162264 APPLIED", () => {
    expect(
      metamorphosisPressActivationMs(dh(AURA_S, LANDING_S), at(LANDING_S)),
    ).toBe(at(AURA_S));
    // no aura in the landing lag: the row itself
    expect(
      metamorphosisPressActivationMs(dh(null, LANDING_S), at(LANDING_S)),
    ).toBe(at(LANDING_S));
  });

  it("52a97230 r0 shape: the kit is not [UNUSED]", () => {
    const meta = metaOf(dh(AURA_S, LANDING_S));
    expect(meta?.neverUsed).toBe(false);
  });

  it("a landing with no aura up before the death stays out of the round", () => {
    const meta = metaOf(dh(null, LANDING_S));
    expect(meta === undefined || meta.neverUsed).toBe(true);
  });
});
