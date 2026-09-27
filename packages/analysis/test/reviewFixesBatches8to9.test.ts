/**
 * codex post-hoc review of reliability leftovers batches 8–9 (2026-09-27):
 * each counterexample pinned.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { creditedAnswer } from "../src/context/burstAnswered";
import { ensureAnalysisData } from "../src/data/ensure";
import { buildAuraIntervals, dropAuraRebroadcasts } from "../src/utils/auraIntervals";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const aura = (event: string, spellId: string, tS: number, src = "S", dest = "D") => ({
  spellId,
  spellName: "x",
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  timestamp: T0 + tS * 1000,
  logLine: { event, timestamp: T0 + tS * 1000 },
});

describe("batch 9 — rebroadcast ordering", () => {
  it("APPLIED then REMOVED at the same ms is a duplicate application and the real end, not a rebroadcast", () => {
    const ev = [
      aura(LogEvent.SPELL_AURA_APPLIED, "102342", 10),
      aura(LogEvent.SPELL_AURA_APPLIED, "102342", 14),
      aura(LogEvent.SPELL_AURA_REMOVED, "102342", 14),
    ];
    expect(dropAuraRebroadcasts(ev)).toHaveLength(3);
  });
  it("REMOVED then APPLIED at the same ms is still one aura", () => {
    const ev = [
      aura(LogEvent.SPELL_AURA_APPLIED, "102342", 10),
      aura(LogEvent.SPELL_AURA_REMOVED, "102342", 14),
      aura(LogEvent.SPELL_AURA_APPLIED, "102342", 14),
    ];
    expect(dropAuraRebroadcasts(ev)).toHaveLength(1);
  });
});

describe("batch 9 — a cast whose aura has another id is a real recast", () => {
  it("two Fears (cast 5782 → aura 118699) with no removals are two intervals, not one", () => {
    const caster: any = {
      id: "S",
      name: "S",
      spellCastEvents: [10, 14].map((t) => ({
        spellId: "5782",
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + t * 1000 },
      })),
    };
    const victim: any = {
      id: "D",
      name: "D",
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "118699", 10), aura(LogEvent.SPELL_AURA_APPLIED, "118699", 14)],
    };
    const iv = buildAuraIntervals(victim, { startTime: T0, endTime: T0 + 60_000, units: { S: caster, D: victim } }).filter(
      (i) => i.spellId === "118699",
    );
    expect(iv).toHaveLength(2);
  });
});

describe("batch 8 — a group external covers the pressured unit", () => {
  it("Spirit Link (destination 0000000000000000) is credited; an external on another player is not", () => {
    const p = (destId: string): any => ({
      pressured: { unitId: "Player-V", minHpSec: 15, minHpPct: 20 },
      responseCasts: [{ category: "external", destId, casterId: "Player-H", effectEndSec: 18 }],
    });
    expect(creditedAnswer(p("0000000000000000"))).toBeDefined();
    expect(creditedAnswer(p("Player-X"))).toBeUndefined();
  });
});
