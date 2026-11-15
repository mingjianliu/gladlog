/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `ledgerPressedNotAtPress` (T114, codex 85-tk-K-T114-1): the wall's
 * aura and press are found without the printed Z, so a wrong Z is a
 * violation, not a line out of coverage.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t114";

const START = 1_000_000;
const at = (s: number): number => START + s * 1000;
const BOP = "1022";
const ev = (
  event: string,
  s: number,
  spellId: string,
  spellName: string,
  srcUnitId: string,
  destUnitId: string,
) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  spellId,
  spellName,
  srcUnitId,
  destUnitId,
});

function scan(printed: string): { checked: number; details: string[] } {
  const owner = {
    id: "O",
    name: "Owner",
    spellCastEvents: [
      ev(LogEvent.SPELL_CAST_SUCCESS, 10, "31884", "Avenging Wrath", "O", "O"),
    ],
    auraEvents: [],
  };
  const pal = {
    id: "P",
    name: "Holy",
    spellCastEvents: [
      ev(
        LogEvent.SPELL_CAST_SUCCESS,
        15.51,
        BOP,
        "Blessing of Protection",
        "P",
        "T",
      ),
    ],
  };
  const target = {
    id: "T",
    name: "Pala",
    auraEvents: [
      ev(
        LogEvent.SPELL_AURA_APPLIED,
        16.74,
        BOP,
        "Blessing of Protection",
        "P",
        "T",
      ),
      ev(
        LogEvent.SPELL_AURA_REMOVED,
        21.14,
        BOP,
        "Blessing of Protection",
        "P",
        "T",
      ),
    ],
  };
  const units = [owner, pal, target];
  let checked = 0;
  const details: string[] = [];
  run({
    lines: [
      "  Burst #1 — 0:10–0:20 | Avenging Wrath",
      "  Target: Pala 90% → 40%",
      `  Target had a major defensive up: Blessing of Protection active ON THE TARGET 4.4s of this burst (pressed ${printed}s after the burst opened)`,
    ],
    start: START,
    units,
    players: units,
    owner,
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 ledgerPressedNotAtPress — coverage does not hang on Z", () => {
  it("the press's own reading passes", () => {
    expect(scan("5.5")).toEqual({ checked: 1, details: [] });
  });
  it("the aura's start is a violation", () => {
    const got = scan("6.7");
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
  it("a Z near neither is a violation, not out of coverage", () => {
    const got = scan("5.0");
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
});
