/**
 * Reliability round 2 W1d — a Mind-Controlled teammate (a5a8d31b, 7b3c556e).
 * The log keeps the player GUID and flips the flags to a PET on the other
 * side's reaction for the duration; a friendly Cleanse cannot touch them,
 * only an offensive purge (141 of 141 sampled corpus MC removals).
 */
import { CombatUnitSpec, type ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  charmedSpans,
  charmedThrough,
  isControlledPlayerFlags,
} from "../src/utils/charmedPlayer";
import { canRemoveFrom } from "../src/utils/dispelAnalysis";

const T0 = 1_000_000;
const ev = (tSec: number, flags: number, destUnitId = "Player-1-A") => ({
  timestamp: T0 + tSec * 1000,
  destUnitId,
  destUnitFlags: flags,
});

describe("isControlledPlayerFlags", () => {
  it("the a5a8d31b flags: 0x512 before, 0x11148 / 0x1148 under Mind Control", () => {
    expect(isControlledPlayerFlags("Player-1-A", 0x512)).toBe(false);
    expect(isControlledPlayerFlags("Player-1-A", 0x10512)).toBe(false);
    expect(isControlledPlayerFlags("Player-1-A", 0x11148)).toBe(true);
    expect(isControlledPlayerFlags("Player-1-A", 0x1148)).toBe(true);
  });
  it("a real pet or totem is not a controlled player", () => {
    expect(isControlledPlayerFlags("Pet-0-1-2-3-4-5", 0x1148)).toBe(false);
    expect(isControlledPlayerFlags("Creature-0-1-2-3-4-5", 0x2148)).toBe(false);
  });
});

describe("charmedSpans / charmedThrough", () => {
  // a5a8d31b shape: friendly flags, then PET flags 72.7 → 75.5, friendly again
  const unit = {
    id: "Player-1-A",
    auraEvents: [ev(72.5, 0x10512), ev(75.54, 0x1148)],
    damageIn: [ev(72.7, 0x11148), ev(74.8, 0x1148), ev(76.0, 0x512)],
    healIn: [],
    actionIn: [],
  } as unknown as ICombatUnit;
  it("one span from the first controlled flag to the next player flag", () => {
    expect(charmedSpans(unit)).toEqual([
      { from: T0 + 72_700, to: T0 + 76_000 },
    ]);
  });
  it("the Mind Control's own window is charmed throughout (under 3 s free)", () => {
    expect(charmedThrough(unit, T0 + 72_540, T0 + 75_540, 3000)).toBe(true);
  });
  it("a 34 s curse with that Mind Control inside is not (443-2-2611 shape)", () => {
    expect(charmedThrough(unit, T0 + 58_500, T0 + 92_900, 3000)).toBe(false);
  });
  it("a unit never flagged as controlled has no spans", () => {
    const free = {
      id: "Player-1-B",
      auraEvents: [ev(10, 0x512, "Player-1-B")],
      damageIn: [],
      healIn: [],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(charmedSpans(free)).toEqual([]);
    expect(charmedThrough(free, T0, T0 + 5000, 3000)).toBe(false);
  });
});

describe("canRemoveFrom — the charmed player is never their own dispeller", () => {
  it("509-1-3009 shape: a purger who is the Mind-Controlled target cannot remove it", () => {
    const evoker = {
      name: "Me-R",
      spec: CombatUnitSpec.Evoker_Devastation,
      info: { pvpTalents: [] },
    } as unknown as ICombatUnit;
    expect(canRemoveFrom(evoker, "Magic", true, "Me-R")).toBe(false);
  });
});

describe("canRemoveFrom", () => {
  const holyPaladin = { spec: CombatUnitSpec.Paladin_Holy } as ICombatUnit;
  it("a Holy Paladin can cleanse Magic off a teammate, not off a charmed one", () => {
    expect(canRemoveFrom(holyPaladin, "Magic", false)).toBe(true);
    expect(canRemoveFrom(holyPaladin, "Magic", true)).toBe(false);
  });
  it("a charmed teammate: nothing but Magic can be removed, even by a purger", () => {
    const shaman = {
      spec: CombatUnitSpec.Shaman_Restoration,
      info: undefined,
    } as unknown as ICombatUnit;
    expect(canRemoveFrom(shaman, "Curse", true)).toBe(false);
  });
});
