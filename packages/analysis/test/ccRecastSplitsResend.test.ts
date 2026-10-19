/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact1215 112-1: a control's REMOVED → APPLIED inside the re-send gap is a
 * NEW application when its source recast it (Cheap Shot 07.118 → 11.131,
 * recast landing 11.132, taken by the Medallion 12.015); with no recast it is
 * the same aura re-sent.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { dropAuraRebroadcasts } from "../src/utils/auraIntervals";
import { ccRecastSplitsResend } from "../src/utils/drAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const CHEAP_SHOT = "1833";
const aura = (event: LogEvent, atMs: number) =>
  ({
    spellId: CHEAP_SHOT,
    srcUnitId: "R",
    destUnitId: "H",
    timestamp: T0 + atMs,
    logLine: { event, timestamp: T0 + atMs },
  }) as any;
const rogue = (castsAtMs: number[]) =>
  ({
    id: "R",
    spellCastEvents: castsAtMs.map((t) => ({
      spellId: CHEAP_SHOT,
      destUnitId: "H",
      timestamp: T0 + t,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + t },
    })),
  }) as any;

describe("ccRecastSplitsResend", () => {
  const auras = [
    aura(LogEvent.SPELL_AURA_APPLIED, 7118),
    aura(LogEvent.SPELL_AURA_REMOVED, 11_131),
    aura(LogEvent.SPELL_AURA_APPLIED, 11_132),
    aura(LogEvent.SPELL_AURA_REMOVED, 12_015),
  ];
  it("112-1 0:54: the recast keeps the expiry and the new landing", () => {
    const r = rogue([7100, 11_120]);
    const kept = dropAuraRebroadcasts(
      auras,
      ccRecastSplitsResend("H", auras, (id) => (id === "R" ? r : undefined)),
    );
    expect(kept).toHaveLength(4);
  });
  it("no recast: the same aura re-sent, the pair dropped as before", () => {
    const r = rogue([7100]);
    const kept = dropAuraRebroadcasts(
      auras,
      ccRecastSplitsResend("H", auras, (id) => (id === "R" ? r : undefined)),
    );
    expect(kept).toHaveLength(2);
    expect(dropAuraRebroadcasts(auras)).toHaveLength(2);
  });
});
