/**
 * Pipeline T108 (fact13 D24, ec49887a r0 1:12): a vision-obscured refusal
 * names what the fight shows obscured the target — an aura-322 aura on
 * another unit (Burrow), else a Smoke Bomb area still down — and no cause
 * when there is neither, never a fixed Smoke Bomb.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  REFUSAL_WHY_WORDS,
  refusalWhy,
} from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  VISION_OBSCURING_AREA_CASTS,
  VISION_OBSCURING_AURAS,
} from "../src/data/visionObscuringAuraGenerated";
import type { RawStreams } from "../src/utils/rawStreams";
import {
  OBSCURING_AREA_SLACK_S,
  VISION_OBSCURED_CAUSE_NAMES,
  visionObscuringWindows,
  withVisionObscuredCauses,
} from "../src/utils/visionObscured";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const VO = "Your vision of the target is obscured";
const LOS = "Target not in line of sight";
const BURROW = "409293";
const SMOKE = "212182";

function fight() {
  const mage = makeUnit("Player-O", { reaction: CombatUnitReaction.Friendly });
  // the enemy Shaman burrows 71.9 s → 76.9 s
  const shaman = makeUnit("Player-E", {
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BURROW,
        T0 + 71_900,
        "Player-E",
        "Player-E",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BURROW,
        T0 + 76_900,
        "Player-E",
        "Player-E",
        "BUFF",
      ),
    ],
  });
  // an enemy Rogue's Smoke Bomb at 120 s
  const rogue = makeUnit("Player-R", {
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      makeSpellCastEvent(SMOKE, T0 + 120_000, "", "", "Player-R", "R"),
    ],
  });
  return {
    startTime: T0,
    endTime: T0 + 300_000,
    units: {
      [mage.id]: mage,
      [shaman.id]: shaman,
      [rogue.id]: rogue,
    },
  };
}

const row = (tSeconds: number, reason = VO, unitGuid = "Player-O") => ({
  tSeconds,
  unitGuid,
  spellId: 44425,
  spellName: "Arcane Barrage",
  reason,
});
const streams = (rows: ReturnType<typeof row>[]): RawStreams => ({
  available: true,
  manaSamples: [],
  castFailed: rows,
});

describe("the generated tables (DB2 aura 322 / same-name area casts)", () => {
  it("hold Burrow and the two Smoke Bomb casts, by their English names", () => {
    expect(VISION_OBSCURING_AURAS[BURROW]).toBe("Burrow");
    expect(VISION_OBSCURING_AREA_CASTS["212182"]).toBe("Smoke Bomb");
    expect(VISION_OBSCURING_AREA_CASTS["359053"]).toBe("Smoke Bomb");
    expect([...VISION_OBSCURED_CAUSE_NAMES].sort()).toEqual([
      "Burrow",
      "Smoke Bomb",
    ]);
  });

  it("every cause wording is one the gates accept", () => {
    for (const n of VISION_OBSCURED_CAUSE_NAMES)
      expect(REFUSAL_WHY_WORDS).toContain(`vision obscured (${n})`);
    expect(REFUSAL_WHY_WORDS).toContain("vision obscured");
  });
});

describe("withVisionObscuredCauses", () => {
  it("names the Burrow up on an enemy (ec49887a r0: nine refusals inside it, no Rogue)", () => {
    const tagged = withVisionObscuredCauses(
      streams([row(72.05), row(76.14), row(77.5)]),
      fight(),
    );
    expect(tagged.castFailed.map((h) => h.obscuredBy)).toEqual([
      "Burrow",
      "Burrow",
      undefined,
    ]);
    expect(
      tagged.castFailed.map((h) => refusalWhy(h.reason, h.obscuredBy)),
    ).toEqual([
      "vision obscured (Burrow)",
      "vision obscured (Burrow)",
      "vision obscured",
    ]);
  });

  it("names a Smoke Bomb for its official 5 s plus the slack, and nothing after", () => {
    const edge = 120 + 5 + OBSCURING_AREA_SLACK_S;
    const tagged = withVisionObscuredCauses(
      streams([row(120), row(edge), row(edge + 0.01), row(119.9)]),
      fight(),
    );
    expect(tagged.castFailed.map((h) => h.obscuredBy)).toEqual([
      "Smoke Bomb",
      "Smoke Bomb",
      undefined,
      undefined,
    ]);
  });

  it("never names the caster's own aura, and tags no other reason", () => {
    const tagged = withVisionObscuredCauses(
      streams([row(73, VO, "Player-E"), row(73, LOS)]),
      fight(),
    );
    expect(tagged.castFailed.map((h) => h.obscuredBy)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("a friendly's Burrow is never the cause: the enemy Smoke Bomb is, or nothing (codex 85-tk-N-T108-1)", () => {
    const combat = fight();
    const ally = makeUnit("Player-F", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          BURROW,
          T0 + 118_000,
          "Player-F",
          "Player-F",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          BURROW,
          T0 + 130_000,
          "Player-F",
          "Player-F",
          "BUFF",
        ),
      ],
    });
    const withAlly = {
      ...combat,
      units: { ...combat.units, [ally.id]: ally },
    };
    const tagged = withVisionObscuredCauses(
      streams([row(119), row(121), row(129)]),
      withAlly,
    );
    expect(tagged.castFailed.map((h) => h.obscuredBy)).toEqual([
      undefined,
      "Smoke Bomb",
      undefined,
    ]);
  });

  it("an enemy caster inside the owner's side's Burrow names it; an unknown caster names no aura", () => {
    const combat = fight();
    const ally = makeUnit("Player-F", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          BURROW,
          T0 + 200_000,
          "Player-F",
          "Player-F",
          "BUFF",
        ),
      ],
    });
    const withAlly = {
      ...combat,
      units: { ...combat.units, [ally.id]: ally },
    };
    const tagged = withVisionObscuredCauses(
      streams([row(201, VO, "Player-E"), row(201, VO, "Creature-0-1")]),
      withAlly,
    );
    expect(tagged.castFailed.map((h) => h.obscuredBy)).toEqual([
      "Burrow",
      undefined,
    ]);
  });

  it("copies rows, never writes them; a tagged stream passes through as it is", () => {
    const raw = streams([row(72.05)]);
    const combat = fight();
    const tagged = withVisionObscuredCauses(raw, combat);
    expect(tagged).not.toBe(raw);
    expect(raw.castFailed[0]).not.toHaveProperty("obscuredBy");
    expect(withVisionObscuredCauses(tagged, combat)).toBe(tagged);
    expect(withVisionObscuredCauses(raw, combat)).toBe(tagged);
  });

  it("a stream with no vision-obscured row, or no streams, is returned unchanged", () => {
    const raw = streams([row(72.05, LOS)]);
    expect(withVisionObscuredCauses(raw, fight())).toBe(raw);
    expect(withVisionObscuredCauses(undefined, fight())).toBeUndefined();
    const off: RawStreams = {
      available: false,
      manaSamples: [],
      castFailed: [],
    };
    expect(withVisionObscuredCauses(off, fight())).toBe(off);
  });

  it("the windows are read per round start (the same units, another clock)", () => {
    const combat = fight();
    const shifted = { ...combat, startTime: T0 + 10_000 };
    expect(visionObscuringWindows(combat)[0]!.fromS).toBeCloseTo(71.9, 6);
    expect(visionObscuringWindows(shifted)[0]!.fromS).toBeCloseTo(61.9, 6);
  });
});
