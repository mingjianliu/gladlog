/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `ledgerCopyHoldsPress` (T98, codex 85-tk-K-T98-1c): the press that
 * refreshes a copy is its own source's — another unit's cast of the wall on
 * the holder is that unit's own application.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t98";

const START = 1_000_000;
const at = (s: number): number => START + s * 1000;
const PS = "33206";
const row = (
  event: string,
  s: number,
  srcUnitId: string,
  destUnitId = "H",
) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  spellId: PS,
  spellName: "Pain Suppression",
  srcUnitId,
  destUnitId,
});

function scan(units: any[]): { checked: number; details: string[] } {
  let checked = 0;
  const details: string[] = [];
  run({
    lines: [
      "  Burst #1 — 0:10–0:20 | Avenging Wrath",
      "  Target: Holder 90% → 40%",
      "  Target had a major defensive up: Pain Suppression active ON THE TARGET 8.0s of this burst (3.5s after the burst opened [no press logged])",
    ],
    start: START,
    end: at(120),
    units,
    players: units,
    owner: units[0],
    unitOfPid: () => undefined,
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 ledgerCopyHoldsPress — the press is the copy source's", () => {
  const holder = (casts: any[]) => ({
    id: "H",
    name: "Holder",
    auraEvents: [
      row(LogEvent.SPELL_AURA_APPLIED, 13.5, "H"),
      row(LogEvent.SPELL_AURA_APPLIED, 15.5, "P2"),
      row(LogEvent.SPELL_AURA_REMOVED, 21.5, "H"),
      row(LogEvent.SPELL_AURA_REMOVED, 23.5, "P2"),
    ],
    spellCastEvents: casts,
  });
  const cast = (s: number, src: string) => ({
    ...row(LogEvent.SPELL_CAST_SUCCESS, s, src),
  });
  it("another priest's cast on the holder is not the copy's press", () => {
    const got = scan([
      holder([]),
      { id: "P2", name: "Other", spellCastEvents: [cast(15.5, "P2")] },
    ]);
    expect(got).toEqual({ checked: 1, details: [] });
  });
  it("the holder's own press inside the copy is one", () => {
    const got = scan([holder([cast(16, "H")])]);
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
});
