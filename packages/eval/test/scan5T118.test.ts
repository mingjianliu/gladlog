/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `rootFreedReadUncleansed` (T118, codex 85-tk-L-T118-1d): a
 * missed-cleanse row is judged on the removal that closes its own
 * application — a source recast's re-APPLIED before any removal leaves the
 * product an inferred end, never the next window's removal.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t118";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const NOVA = "122";
const aura = (event: string, s: number, src = "e1") => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  spellId: NOVA,
  spellName: "Frost Nova",
  srcUnitId: src,
  destUnitId: "m",
});
const lust = (s: number) => ({
  timestamp: at(s),
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(s) },
  spellId: "116841",
  spellName: "Tiger's Lust",
  srcUnitId: "h",
  destUnitId: "m",
});

function scan(rows: any[], lustAt: number): number {
  let n = 0;
  const m = { id: "m", name: "Melee", info: { teamId: "0" }, auraEvents: rows };
  const h = {
    id: "h",
    name: "Healer",
    info: { teamId: "0" },
    spellCastEvents: [lust(lustAt)],
  };
  const e1 = { id: "e1", name: "Mage", info: { teamId: "1" } };
  run({
    menu: "  - id=missed-cleanse:Melee:10 type=missed-cleanse t=10.0s units=Melee facts={t=10.0, target=Melee, cc=Frost Nova, duration=4.0, worth=worth}",
    start: START,
    roundEndAt: at(60),
    byName: new Map([["Melee", m]]),
    unitOfPid: () => undefined,
    units: [m, h, e1],
    players: [m, h, e1],
    bump: () => {},
    violate: () => n++,
  } as any);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 rootFreedReadUncleansed", () => {
  it("flags a removal of its own application in the instant of a Tiger's Lust", () => {
    expect(
      scan(
        [
          aura(LogEvent.SPELL_AURA_APPLIED, 10),
          aura(LogEvent.SPELL_AURA_REMOVED, 14),
        ],
        14,
      ),
    ).toBe(1);
  });
  it("does not borrow the next window's removal across a re-APPLIED", () => {
    expect(
      scan(
        [
          aura(LogEvent.SPELL_AURA_APPLIED, 10),
          aura(LogEvent.SPELL_AURA_APPLIED, 14),
          aura(LogEvent.SPELL_AURA_REMOVED, 14.5),
        ],
        14.5,
      ),
    ).toBe(0);
  });
  it("pairs a removal with its own source's application (codex 85-tk-L-T118-1e)", () => {
    expect(
      scan(
        [
          aura(LogEvent.SPELL_AURA_APPLIED, 10, "e1"),
          aura(LogEvent.SPELL_AURA_APPLIED, 12, "e2"),
          aura(LogEvent.SPELL_AURA_REMOVED, 14, "e2"),
          aura(LogEvent.SPELL_AURA_REMOVED, 16, "e1"),
        ],
        14,
      ),
    ).toBe(0);
  });
});
