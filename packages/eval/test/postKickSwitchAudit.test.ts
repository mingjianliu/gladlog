import { ensureAnalysisData } from "@gladlog/analysis";
import { COMPANION_SUCCESS_MS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { beforeAll, describe, expect, it } from "vitest";

import { switchTrigger } from "../scripts/postKickSwitchAudit";

// codex 30-RV-04 #3 / #4 — the audit's lookup of the cast production named
// (`switchSpellName`), on synthetic SUCCESS rows: a Nature-school kick
// (Regrowth) at 10 s; Living Flame (Fire) is the companion row of a hard-cast
// Chrono Flames (Fire + Arcane), so production names Chrono Flames.

const REGROWTH = "8936";
const LIVING_FLAME = "361509";
const CHRONO_FLAMES = "431443";
const inst = {
  atSeconds: 10,
  interruptedSpellId: REGROWTH,
  switchSpellName: "Chrono Flames",
};

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("switchTrigger — production's English switchSpellName against localized logs (codex 30-RV-04 #3)", () => {
  it("a zhCN log: Living Flame 11.998 s, Chrono Flames 12 s → Chrono Flames", () => {
    const casts = [
      { t: 11.998, spellId: LIVING_FLAME, spellName: "生命之焰" },
      { t: 12, spellId: CHRONO_FLAMES, spellName: "时光之焰" },
    ];
    expect(switchTrigger(casts, inst)?.spellId).toBe(CHRONO_FLAMES);
  });
  it("an English log still matches", () => {
    const casts = [
      { t: 11.998, spellId: LIVING_FLAME, spellName: "Living Flame" },
      { t: 12, spellId: CHRONO_FLAMES, spellName: "Chrono Flames" },
    ];
    expect(switchTrigger(casts, inst)?.spellId).toBe(CHRONO_FLAMES);
  });
});

describe("switchTrigger — the named companion may land past the window end (codex 30-RV-04 #4)", () => {
  it("Living Flame 14.999 s, its Chrono Flames 15.001 s → Chrono Flames", () => {
    const casts = [
      { t: 14.999, spellId: LIVING_FLAME, spellName: "Living Flame" },
      { t: 15.001, spellId: CHRONO_FLAMES, spellName: "Chrono Flames" },
    ];
    expect(switchTrigger(casts, inst)?.spellId).toBe(CHRONO_FLAMES);
  });
  it("…but no further than production's COMPANION_SUCCESS_MS past it", () => {
    const tooLate = 15 + (COMPANION_SUCCESS_MS + 5) / 1000;
    const casts = [
      { t: 14.999, spellId: LIVING_FLAME, spellName: "Living Flame" },
      { t: tooLate, spellId: CHRONO_FLAMES, spellName: "Chrono Flames" },
    ];
    expect(switchTrigger(casts, inst)?.spellId).toBe(LIVING_FLAME);
  });
});
