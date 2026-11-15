/**
 * Pipeline T111 (fact13 D2/D19), user ruling R47 2026-11-15 (option A): a
 * cooldown a spec passive scales by haste (DB2 aura 416) prints no exact
 * return — the repo reads no haste %. `[PRESS]` says the cooldown shortens
 * with haste, and a `[RES]` `cd:` entry reads `(≤Ns)`.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { emitOffListPressEntries } from "../src/context/timelineSections/offListPress";
import {
  HASTE_SCALED_COOLDOWN_NOTE,
  isHasteScaledCooldown,
} from "../src/data/hasteScaledCooldowns";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import type { IOffListPress } from "../src/utils/offListPress";
import { makeUnit } from "./ported/testHelpers";

const PIERCE_THE_VEIL = "1245483";
const EYE_BEAM = "198013";
const ESSENCE_BREAK = "258860";
const EXECUTION_SENTENCE = "343527";
const AVENGERS_SHIELD = "31935";

describe("T111 — the haste-scaled set is DB2's aura 416, by spec", () => {
  it("Devourer's Pierce the Veil, Protection's Avenger's Shield", () => {
    expect(
      isHasteScaledCooldown(
        PIERCE_THE_VEIL,
        CombatUnitSpec.DemonHunter_Devourer,
      ),
    ).toBe(true);
    expect(
      isHasteScaledCooldown(AVENGERS_SHIELD, CombatUnitSpec.Paladin_Protection),
    ).toBe(true);
  });
  it("Execution Sentence is scaled for Protection, not for Retribution", () => {
    expect(
      isHasteScaledCooldown(
        EXECUTION_SENTENCE,
        CombatUnitSpec.Paladin_Protection,
      ),
    ).toBe(true);
    expect(
      isHasteScaledCooldown(
        EXECUTION_SENTENCE,
        CombatUnitSpec.Paladin_Retribution,
      ),
    ).toBe(false);
  });
  it("Essence Break and Eye Beam are not (GH #217 is another cause)", () => {
    expect(
      isHasteScaledCooldown(ESSENCE_BREAK, CombatUnitSpec.DemonHunter_Havoc),
    ).toBe(false);
    expect(
      isHasteScaledCooldown(EYE_BEAM, CombatUnitSpec.DemonHunter_Havoc),
    ).toBe(false);
  });
  it("a 0 % row scales nothing (Preservation 356810)", () => {
    expect(
      isHasteScaledCooldown("373861", CombatUnitSpec.Evoker_Preservation),
    ).toBe(false);
  });
});

const dh = (spec: CombatUnitSpec) =>
  makeUnit("e1", {
    name: "EnemyDH",
    class: CombatUnitClass.DemonHunter,
    spec,
    reaction: CombatUnitReaction.Hostile,
  });
const owner = makeUnit("o1", {
  name: "Owner",
  class: CombatUnitClass.Priest,
  spec: CombatUnitSpec.Priest_Discipline,
  reaction: CombatUnitReaction.Friendly,
});

function pressLine(p: Partial<IOffListPress>): string {
  const lines: string[] = [];
  emitOffListPressEntries({
    owner,
    friends: [owner],
    pid: (n: string) => (n === "Owner" ? "1(DPriest)" : "?"),
    enemyPid: () => "6(DDHunter)",
    addEntry: (_t: number, l: string) => {
      lines.push(l);
      return true;
    },
    entries: [],
    presses: [
      {
        unit: dh(CombatUnitSpec.DemonHunter_Devourer),
        spellId: PIERCE_THE_VEIL,
        timeSeconds: 24.1,
        cooldownSeconds: 30,
        charges: 1,
        readyAgainAtSeconds: 54.1,
        ...p,
      } as IOffListPress,
    ],
  } as unknown as Parameters<typeof emitOffListPressEntries>[0]);
  return lines.join("\n");
}

describe("T111 — [PRESS] prints no exact back for a haste-scaled cooldown", () => {
  it("0a13e993 r0: Pierce the Veil (30s cd) — no `back 0:54`", () => {
    const l = pressLine({});
    expect(l).toContain(
      `Pierce the Veil (30s cd, ${HASTE_SCALED_COOLDOWN_NOTE})`,
    );
    expect(l).not.toMatch(/back \d/);
  });
  it("a cooldown no aura 416 covers keeps its back (Eye Beam)", () => {
    expect(
      pressLine({
        unit: dh(CombatUnitSpec.DemonHunter_Havoc),
        spellId: EYE_BEAM,
        readyAgainAtSeconds: 64.1,
        cooldownSeconds: 40,
      }),
    ).toContain("back 1:04");
  });
  it("a reset at the press still says so", () => {
    expect(pressLine({ readyAgainAtSeconds: 24.1 })).toContain(
      "reset, ready again",
    );
  });
});

describe("T111 — a [RES] cd entry of a haste-scaled cooldown reads ≤Ns", () => {
  const cd = (spellId: string, spellName: string) =>
    ({
      spellId,
      spellName,
      tag: "Offensive",
      cooldownSeconds: 60,
      maxChargesDetected: 1,
      charges: 1,
      casts: [{ timeSeconds: 10 }],
      availableWindows: [],
      neverUsed: false,
      isThroughput: true,
    }) as unknown as IMajorCooldownInfo;
  const res = (spec: CombatUnitSpec) =>
    buildResourceSnapshot({
      timeSeconds: 30,
      ownerCDs: [],
      ownerName: "Owner",
      ownerSpec: "Discipline Priest",
      teammateCDs: [
        {
          cds: [cd(EXECUTION_SENTENCE, "Execution Sentence")],
          playerLabel: "2",
          player: makeUnit("t1", {
            name: "Mate",
            class: CombatUnitClass.Paladin,
            spec,
            reaction: CombatUnitReaction.Friendly,
          }),
        },
      ],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    } as unknown as Parameters<typeof buildResourceSnapshot>[0]);
  it("Protection's Execution Sentence: at most 40 s", () => {
    expect(res(CombatUnitSpec.Paladin_Protection)).toContain(
      "Execution Sentence(≤40s)",
    );
  });
  it("Retribution's: the exact 40 s", () => {
    expect(res(CombatUnitSpec.Paladin_Retribution)).toContain(
      ":Execution Sentence(40s)",
    );
  });
});
