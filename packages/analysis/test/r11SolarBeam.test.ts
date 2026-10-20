/**
 * fact1215 R11 (user approved 2026-10-19): Solar Beam's silence 81261 is
 * never logged; its source and window come from DB2 — the cast's official
 * effect aura (`nominatedEffectAurasOfCast`) and that aura's 8 s length.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { nominatedEffectAurasOfCast } from "../src/data/castEffectAuras";
import { ensureAnalysisData } from "../src/data/ensure";
import { spellEffectData } from "../src/data/spellEffectData";
import { isSilenceEffectAura } from "../src/utils/cannotCastIntervals";
import { getDRCategory } from "../src/utils/drAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("Solar Beam's unlogged silence", () => {
  it("DB2 names 81261 as Solar Beam's effect; it is a silence of 8 s", () => {
    expect(nominatedEffectAurasOfCast("78675")).toContain("81261");
    expect(getDRCategory("81261")).toBe("Silence");
    expect(spellEffectData["81261"]?.durationSeconds).toBe(8);
  });
  it("only a class-owned effect counts: Arcane Torrent's TBC silence does not (codex 20-F15-36)", () => {
    const silenceOf = (cast: string) =>
      nominatedEffectAurasOfCast(cast, { classOwned: true }).filter(
        isSilenceEffectAura,
      );
    expect(silenceOf("78675")).toContain("81261");
    // the name still nominates 33390; the racial today only dispels
    expect(nominatedEffectAurasOfCast("28730")).toContain("33390");
    expect(silenceOf("28730")).toEqual([]);
  });
  it("covering and nominating read one silence predicate: 81261 is one", () => {
    expect(isSilenceEffectAura("81261")).toBe(true);
  });
  it("an id DB2 nominates nothing for has none", () => {
    expect(nominatedEffectAurasOfCast("0")).toEqual([]);
  });
});
