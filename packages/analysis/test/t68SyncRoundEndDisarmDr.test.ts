/**
 * Pipeline T68 (GH #132): the sync-window round-end cut is one function for
 * the candidate, the reference scan and the calibration count; the disarm
 * DR family comes from DB2 (SpellCategories.DiminishType 128) and holds the
 * two disarms the hand list lacked.
 */
import { describe, expect, it } from "vitest";

import {
  syncWindowInRound,
  syncWindowRoundEndS,
} from "../src/analysis/candidates/cooldownTiming";
import { spellClassMap } from "../src/data/drCategories";
import { disarmSpellIds } from "../src/data/spellTags";
import { DR_CATEGORY_MAP } from "../src/utils/drAnalysis";

const START = 1_000_000;
const player = (deaths: number[]) => ({
  info: {},
  deathRecords: deaths.map((s) => ({ timestamp: START + s * 1000 })),
});

describe("syncWindowRoundEndS / syncWindowInRound", () => {
  const shuffle = {
    startInfo: { bracket: "Rated Solo Shuffle" },
    startTime: START,
    endTime: START + 300_000,
  };
  const threes = { ...shuffle, startInfo: { bracket: "3v3" } };

  it("a Solo Shuffle round ends at its first player death; another bracket at the log's end", () => {
    expect(syncWindowRoundEndS(shuffle, [player([]), player([42.5])])).toBe(
      42.5,
    );
    expect(syncWindowRoundEndS(threes, [player([]), player([42.5])])).toBe(
      300,
    );
    expect(syncWindowRoundEndS(shuffle, [player([])])).toBe(300);
    expect(
      syncWindowRoundEndS({ ...shuffle, endTime: 0 }, [player([])]),
    ).toBeUndefined();
  });

  it("a lock is cut at the round's end, dropped when it began at or after it, untouched with no end", () => {
    const w = { fromSeconds: 40, toSeconds: 46, spellName: "x" };
    expect(syncWindowInRound(w, 42.5)).toEqual({ ...w, toSeconds: 42.5 });
    expect(syncWindowInRound(w, 60)).toEqual(w);
    expect(syncWindowInRound(w, 40)).toBeUndefined();
    expect(syncWindowInRound(w, undefined)).toBe(w);
  });
});

describe("the disarm DR family is DB2's (DiminishType 128)", () => {
  const family = new Set(
    (
      spellClassMap.diminishingReturns as Record<string, { spellId: string }[]>
    ).disarm!.map((e) => e.spellId),
  );
  it("holds Disarm, Dismantle, Grapple Weapon — and Faerie Swarm and Sticky Tar Bomb's aura", () => {
    for (const id of ["236077", "207777", "233759", "209749", "407032"]) {
      expect(family.has(id)).toBe(true);
      expect(DR_CATEGORY_MAP[id]).toBe("Disarm");
    }
  });
  it("every disarm aura of the family the product names a disarm; Sticky Tar Bomb 407031 has no DiminishType in DB2", () => {
    for (const id of ["236077", "207777", "233759", "209749", "407032"])
      expect(disarmSpellIds.has(id)).toBe(true);
    expect(family.has("407031")).toBe(false);
  });
});
