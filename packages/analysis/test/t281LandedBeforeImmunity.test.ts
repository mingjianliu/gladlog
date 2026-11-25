/**
 * Pipeline T281 — a cast that landed before the immunity or the wall is not
 * a cast into it. The corpus check is `packages/eval/scripts/scan5/t281.ts`.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  PRESS_LANDED_SAME_INSTANT_MS,
  pressImmuneMissRows,
  pressLandedOn,
} from "../src/utils/castMissRows";
import {
  landedBeforeWallRow,
  refusedByAnotherAura,
} from "../src/utils/offensiveWasteAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T281 — a hit of the press before its IMMUNE row", () => {
  // audit-1215 17 D1 (0d211b8b r1): Merithra's Blessing 1256581 pressed
  // 92.744, healed the target 93.125, Cyclone on the target 93.189, a later
  // pulse IMMUNE 93.880
  const MERITHRA = "1256581";
  const heal = (ms: number) => ({
    spellId: MERITHRA,
    spellName: "Merithra's Blessing",
    destUnitId: "T",
    timestamp: ms,
    logLine: { event: LogEvent.SPELL_HEAL, timestamp: ms },
  });
  const immune = {
    spellId: MERITHRA,
    missType: "IMMUNE",
    destUnitId: "T",
    timestamp: 93_880,
    logLine: { event: LogEvent.SPELL_MISSED },
  };
  const landed = (rows: unknown[]) =>
    pressLandedOn(
      rows as never,
      MERITHRA,
      "Merithra's Blessing",
      [92_744],
      92_744,
      "T",
      93_880,
    );
  it("the heal 755 ms before the refusal is the press landing", () => {
    expect(landed([heal(93_125)])).toBe(true);
  });
  it("a hit after the refusal's instant, or a periodic row, is not", () => {
    expect(landed([heal(93_880 + PRESS_LANDED_SAME_INSTANT_MS + 1)])).toBe(
      false,
    );
    expect(
      landed([
        {
          ...heal(93_125),
          logLine: { event: LogEvent.SPELL_PERIODIC_HEAL, timestamp: 93_125 },
        },
      ]),
    ).toBe(false);
  });
  it("a hit of an earlier press of the spell is not this press landing", () => {
    // pressed again at 93.5: the 93.125 heal is the first press's
    expect(
      pressLandedOn(
        [heal(93_125)] as never,
        MERITHRA,
        "Merithra's Blessing",
        [92_744, 93_500],
        93_500,
        "T",
        93_880,
      ),
    ).toBe(false);
  });
  it("the press's refusal reading drops the row, and keeps it with no hit", () => {
    const rows = (hits: unknown[]) =>
      pressImmuneMissRows(
        [immune],
        MERITHRA,
        [92_744],
        92_744,
        undefined,
        hits as never,
      );
    expect(rows([heal(93_125)])).toHaveLength(0);
    expect(rows([])).toHaveLength(1);
  });
});

describe("T281 — a landing row before the wall's APPLIED row in one millisecond", () => {
  // audit-1215 10 D1 (50b433c2 r5): Wrath's damage row and Ironbark's
  // APPLIED both at 20:10:57.795, the Wrath logged first
  it("the log's order decides inside the wall's opening millisecond", () => {
    expect(landedBeforeWallRow({ atMs: 5_000, lineIndex: 10 }, 5_000, 11)).toBe(
      true,
    );
    expect(landedBeforeWallRow({ atMs: 5_000, lineIndex: 12 }, 5_000, 11)).toBe(
      false,
    );
  });
  it("another millisecond, or no line number on either side, keeps the instant's reading", () => {
    expect(landedBeforeWallRow({ atMs: 5_001, lineIndex: 10 }, 5_000, 11)).toBe(
      false,
    );
    expect(landedBeforeWallRow({ atMs: 5_000 }, 5_000, 11)).toBe(false);
    expect(
      landedBeforeWallRow({ atMs: 5_000, lineIndex: 10 }, 5_000, undefined),
    ).toBe(false);
  });
});

describe("T281 — an IMMUNE landing under a damage-reduction wall", () => {
  const IRONBARK = "102342";
  const ICE_BLOCK = "45438";
  const ICEBOUND = "48792";
  const STARSURGE = "78674";
  const KIDNEY_SHOT = "408";
  it("a Starsurge logged IMMUNE under Ironbark was refused by something else", () => {
    expect(
      refusedByAnotherAura(IRONBARK, STARSURGE, "Starsurge", { immune: true }),
    ).toBe(true);
  });
  it("a landing that is no IMMUNE row stays the wall's", () => {
    expect(refusedByAnotherAura(IRONBARK, STARSURGE, "Starsurge", {})).toBe(
      false,
    );
  });
  it("an immunity keeps its own refusals", () => {
    expect(
      refusedByAnotherAura(ICE_BLOCK, STARSURGE, "Starsurge", { immune: true }),
    ).toBe(false);
  });
  it("a stun refused by Icebound Fortitude is that wall's refusal", () => {
    expect(
      refusedByAnotherAura(ICEBOUND, KIDNEY_SHOT, "Kidney Shot", {
        immune: true,
      }),
    ).toBe(false);
  });
});
