/**
 * Task 7 review follow-up (Finding 2): the pure functions in
 * `../src/explore/cdLedgerRot.ts` had zero unit coverage — only exercised
 * indirectly by the full-corpus scan CLI, which nobody reruns except when
 * this tool itself is invoked again ("don't leave a one-shot script" per
 * CLAUDE.md's verification rule; this scanner is meant to run again for the
 * next residual batch). Covers the two things most likely to silently break:
 * `dedupeHits`' key composition (the exact bug it was written to fix — a
 * batch-resume double-append, see that function's own doc comment) and
 * `findSelfAuraEvidence`'s self-cast filter (the independent evidence signal
 * the whole scan is built on).
 */
import { type ICombatUnit,LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  type CdLedgerRotHit,
  dedupeHits,
  findSelfAuraEvidence,
  formatReport,
} from "../src/explore/cdLedgerRot";

function hit(overrides: Partial<CdLedgerRotHit> = {}): CdLedgerRotHit {
  return {
    matchId: "m1",
    roundSeq: undefined,
    unitName: "Alice-Realm",
    spellId: "374348",
    spellName: "Renewing Blaze",
    auraSpellId: "374349",
    auraTimeSeconds: 12.5,
    ...overrides,
  };
}

/** Minimal aura-event stub (ICombatEvent shape) — only the fields
 * `findSelfAuraEvidence` reads (`logLine.event`, `srcUnitId`, `destUnitId`,
 * `spellId`, `timestamp`). */
function auraEvent(overrides: {
  event?: LogEvent;
  srcUnitId?: string;
  destUnitId?: string;
  spellId?: string | null;
  timestamp?: number;
}): ICombatUnit["auraEvents"][number] {
  return {
    logLine: { event: overrides.event ?? LogEvent.SPELL_AURA_APPLIED },
    srcUnitId: overrides.srcUnitId ?? "p1",
    destUnitId: overrides.destUnitId ?? "p1",
    spellId: overrides.spellId ?? "374349",
    timestamp: overrides.timestamp ?? 20_000,
    spellName: "",
    destUnitName: "",
    srcUnitName: "",
    srcUnitFlags: 0,
    destUnitFlags: 0,
  } as unknown as ICombatUnit["auraEvents"][number];
}

function unitWithAuras(auraEvents: ICombatUnit["auraEvents"]): ICombatUnit {
  return { id: "p1", auraEvents } as unknown as ICombatUnit;
}

describe("dedupeHits", () => {
  it("collapses two exact duplicates (the batch-resume double-append bug) to one", () => {
    const a = hit();
    const b = hit(); // structurally identical, e.g. re-appended by a resumed batch
    expect(dedupeHits([a, b])).toEqual([a]);
  });

  it("keeps two hits that differ only in auraTimeSeconds (two independent procs of the same spell)", () => {
    const a = hit({ auraTimeSeconds: 12.5 });
    const b = hit({ auraTimeSeconds: 45.0 });
    expect(dedupeHits([a, b])).toHaveLength(2);
  });

  it("keeps two hits that differ only in spellId", () => {
    const a = hit({ spellId: "374348", spellName: "Renewing Blaze" });
    const b = hit({ spellId: "106898", spellName: "Stampeding Roar" });
    expect(dedupeHits([a, b])).toHaveLength(2);
  });

  it("keeps two hits that differ only in unitName (same spell, two different players)", () => {
    const a = hit({ unitName: "Alice-Realm" });
    const b = hit({ unitName: "Bob-Realm" });
    expect(dedupeHits([a, b])).toHaveLength(2);
  });

  it("keeps two hits that differ only in roundSeq (same match, different shuffle rounds)", () => {
    const a = hit({ roundSeq: 0 });
    const b = hit({ roundSeq: 1 });
    expect(dedupeHits([a, b])).toHaveLength(2);
  });

  it("treats matchId+undefined roundSeq and matchId+roundSeq=0 as distinct keys (no accidental collision)", () => {
    const a = hit({ roundSeq: undefined });
    const b = hit({ roundSeq: 0 });
    expect(dedupeHits([a, b])).toHaveLength(2);
  });

  it("empty input → empty output", () => {
    expect(dedupeHits([])).toEqual([]);
  });
});

describe("findSelfAuraEvidence: self-cast filter", () => {
  const cd = { spellId: "374348", spellName: "Renewing Blaze" };

  it("matches a self-applied SPELL_AURA_APPLIED whose resolved name equals cd.spellName", () => {
    const unit = unitWithAuras([
      auraEvent({ srcUnitId: "p1", destUnitId: "p1", spellId: "374349" }),
    ]);
    const evidence = findSelfAuraEvidence(unit, cd);
    expect(evidence).toEqual({ spellId: "374349", timestamp: 20_000 });
  });

  it("rejects an aura applied BY someone else onto this unit (src !== unit.id)", () => {
    const unit = unitWithAuras([
      auraEvent({ srcUnitId: "healer-2", destUnitId: "p1", spellId: "374349" }),
    ]);
    expect(findSelfAuraEvidence(unit, cd)).toBeUndefined();
  });

  it("rejects an aura this unit applied onto someone ELSE (dest !== unit.id)", () => {
    const unit = unitWithAuras([
      auraEvent({ srcUnitId: "p1", destUnitId: "ally-2", spellId: "374349" }),
    ]);
    expect(findSelfAuraEvidence(unit, cd)).toBeUndefined();
  });

  it("rejects a self-applied aura whose resolved name does not match cd.spellName", () => {
    const unit = unitWithAuras([
      // 361469 resolves to "Living Flame" — exactly the task-7 mix-up this
      // predicate must not repeat.
      auraEvent({ srcUnitId: "p1", destUnitId: "p1", spellId: "361469" }),
    ]);
    expect(findSelfAuraEvidence(unit, cd)).toBeUndefined();
  });

  it("rejects a non-APPLIED aura event (e.g. SPELL_AURA_REMOVED) even if src/dest/name match", () => {
    const unit = unitWithAuras([
      auraEvent({
        event: LogEvent.SPELL_AURA_REMOVED,
        srcUnitId: "p1",
        destUnitId: "p1",
        spellId: "374349",
      }),
    ]);
    expect(findSelfAuraEvidence(unit, cd)).toBeUndefined();
  });

  it("no auraEvents at all → undefined", () => {
    expect(findSelfAuraEvidence(unitWithAuras([]), cd)).toBeUndefined();
  });
});

describe("formatReport", () => {
  it("dedupes before counting/rendering (matches='#' consistent with the printed hit lines)", () => {
    const a = hit();
    const b = hit(); // duplicate
    const report = formatReport({
      tag: "smoke",
      matchesScanned: 5,
      errors: 0,
      hits: [a, b],
    });
    expect(report).toContain(
      "contradictions (flow/aura evidence ∧ ledger neverUsed): 1",
    );
    expect(report.match(/^m1/gm)).toHaveLength(1);
  });

  it("renders (none) when there are zero hits", () => {
    const report = formatReport({
      tag: "smoke",
      matchesScanned: 3,
      errors: 0,
      hits: [],
    });
    expect(report).toContain(
      "contradictions (flow/aura evidence ∧ ledger neverUsed): 0",
    );
    expect(report).toContain("(none)");
  });
});
