/**
 * Triage 2026-09-29, group G5 (part 1) — the death-setup facts and menu:
 *  - death-kill F-S1 (ruling A16): name the qualifying CC that ends latest;
 *  - crisis-external F-AS1: `chain` / `chainFrom` over every cannot-cast run
 *    touching the 12 s before the death (not clipped), roots tagged
 *    `(root)`, `landedWhileLocked`; death-kill F-S1's `lockedS`;
 *  - crisis-external F-D2 (ruling A′5): `freeBeforeDeathS`;
 *  - crisis-external F-D3 (ruling A49 = B): a death / death-setup after the
 *    log owner's own death leaves the menu;
 *  - death-kill F-M1: the missed-options lock test asks the cannot-cast
 *    predicate (a silence locks a caster);
 *  - death-kill F-M2: the tag says the longest free stretch and what held
 *    the caster through the death.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractCandidateFindings } from "../src/analysis/candidateFindings";
import { deathSetupEvents } from "../src/analysis/candidates/death";
import { ensureAnalysisData } from "../src/data/ensure";
import { freeMsBefore } from "../src/utils/cannotCastIntervals";
import {
  deathWindowFreedom,
  formatDeathOutcomeForContext,
  wasLockedOutByCannotCast,
  wasLockedOutThroughWindow,
} from "../src/utils/deathOutcomeAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const victim = { id: "v1", name: "Victim-R" };
const cc = (atSeconds: number, durationSeconds: number, spellName: string) => ({
  atSeconds,
  durationSeconds,
  spellName,
  sourceName: "E",
});
const iv = (fromS: number, toS: number, spellId: string, lockout = false) => ({
  from: START + fromS * 1000,
  to: START + toS * 1000,
  spellId,
  lockout,
});

describe("death-kill F-S1 — the lock nearest the death", () => {
  it("names the qualifying CC that ends latest, not the first listed", () => {
    // 9c6ab747 shape: Storm Bolt 95.7 (3 s), Song of Chi-Ji 97 (6 s), death 101.975
    const [e] = deathSetupEvents({
      deathT: 101.975,
      victim,
      healerCC: {
        healerName: "Healer-R",
        ccInstances: [cc(95.7, 3, "Storm Bolt"), cc(97, 6, "Song of Chi-Ji")],
      },
    });
    expect(e!.facts["cc"]).toBe("Song of Chi-Ji");
    expect(e!.id).toBe("death-setup:v1:102:healer-locked");
    // no interval data → no chain facts (hand-built fixture)
    expect(e!.facts["chain"]).toBeUndefined();
    expect(e!.facts["freeBeforeDeathS"]).toBeUndefined();
  });
});

describe("crisis-external F-AS1 / F-D2 — the lock chain and the free time", () => {
  // 5677ba13 shape: Sleet 104.0–108.0 → Scream 107.5–112.0 → Polymorph
  // 111.9–116.4 (one run from 104.0), Chastise 117.1–120.1, death 123.0
  const parts = {
    deathT: 123,
    victim,
    healerCC: {
      healerName: "Healer-R",
      ccInstances: [
        cc(107.5, 4.5, "Psychic Scream"),
        cc(117.1, 3, "Holy Word: Chastise"),
      ],
      cannotCast: [
        iv(104, 108, "207167"), // Blinding Sleet
        iv(107.5, 112, "8122"), // Psychic Scream
        iv(111.9, 116.4, "118"), // Polymorph
        iv(117.1, 120.1, "88625"), // Holy Word: Chastise
        iv(118, 119, "2139", true), // a kick lockout inside it
      ],
      roots: [{ atSeconds: 112, durationSeconds: 4, spellName: "Frost Nova" }],
      matchStartMs: START,
    },
  };

  it("chain starts at the run's own start, not at death − 12", () => {
    const [e] = deathSetupEvents(parts);
    expect(e!.facts["chainFrom"]).toBe("104");
    expect(e!.facts["chain"]).toBe(
      "Blinding Sleet 104; Psychic Scream 107.5; Polymorph 111.9; Frost Nova (root) 112; Holy Word: Chastise 117.1",
    );
  });

  it("lockedS counts the window's cannot-cast seconds once; freeBeforeDeathS the gap after the last run", () => {
    const [e] = deathSetupEvents(parts);
    // window 111–123: 111–116.4 and 117.1–120.1 → 5.4 + 3.0
    expect(e!.facts["lockedS"]).toBe("8.4");
    expect(e!.facts["freeBeforeDeathS"]).toBe("2.9");
    // the named CC (Chastise) landed after the healer was free again
    expect(e!.facts["cc"]).toBe("Holy Word: Chastise");
    expect(e!.facts["landedWhileLocked"]).toBe("false");
  });

  it("landedWhileLocked: the named CC landed inside an earlier interval", () => {
    const [e] = deathSetupEvents({
      ...parts,
      deathT: 115,
      healerCC: {
        ...parts.healerCC,
        ccInstances: [cc(111.9, 4.5, "Polymorph")],
      },
    });
    expect(e!.facts["cc"]).toBe("Polymorph");
    expect(e!.facts["landedWhileLocked"]).toBe("true");
    expect(e!.facts["freeBeforeDeathS"]).toBe("0");
  });

  it("freeMsBefore: undefined when no run starts before the instant", () => {
    expect(freeMsBefore([{ from: 5, to: 9 }], 5)).toBeUndefined();
    expect(freeMsBefore([], 5)).toBeUndefined();
    expect(freeMsBefore([{ from: 1, to: 3 }], 5)).toBe(2);
  });
});

describe("crisis-external F-D3 — events after the owner's death leave the menu", () => {
  const unit = (
    id: string,
    reaction: number,
    spec: string,
    deathMs?: number,
  ) => ({
    id,
    name: `${id}-R`,
    type: 1,
    reaction,
    spec,
    deathRecords: deathMs === undefined ? [] : [{ timestamp: deathMs }],
    spellCastEvents: [],
    advancedActions: [],
    info: { teamId: reaction === 1 ? "0" : "1" },
  });
  const combat = (mateDiesAtMs: number): any => ({
    startTime: 0,
    endTime: 60_000,
    units: {
      a: unit("a", 1, "256", 30_000), // the owner (Disc), dies at 30
      c: unit("c", 1, "71", mateDiesAtMs), // a teammate
      b: unit("b", 2, "577"),
    },
  });

  it("a teammate's death after the owner's is not on the menu; the owner's own stays", () => {
    const ids = extractCandidateFindings(combat(40_000), "a").map((e) => e.id);
    expect(ids).toContain("death:a:30");
    expect(ids).not.toContain("death:c:40");
  });

  it("control: a teammate's death before the owner's stays", () => {
    const ids = extractCandidateFindings(combat(20_000), "a").map((e) => e.id);
    expect(ids).toContain("death:c:20");
    expect(ids).toContain("death:a:30");
  });
});

describe("death-kill F-M1 — a silence locks a caster for the missed-options tags", () => {
  it("Strangulate across the 5 s window: cannot-cast locked, hard-CC free", () => {
    // 2c6e85ec shape: silenced from 2 s before the window to the death
    const caster = makeUnit("c1", {
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "47476",
            START + 94_000,
            "e1",
            "c1",
          ),
          spellName: "Strangulate",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "47476",
            START + 101_000,
            "e1",
            "c1",
          ),
          spellName: "Strangulate",
        },
      ],
    });
    expect(wasLockedOutByCannotCast(caster, new Set(["e1"]), START, 100)).toBe(
      true,
    );
    // the hard-CC test (still [DEATH] Unused's input) sees no CC
    expect(
      wasLockedOutThroughWindow({ playerName: "c1", ccInstances: [] }, 100),
    ).toBe(false);
  });
});

describe("death-kill F-M2 — longest free stretch, and what held the caster at the death", () => {
  const aura = (
    event: LogEvent,
    spellId: string,
    ms: number,
    name: string,
  ) => ({
    ...makeAuraEvent(event, spellId, START + ms, "e1", "c1"),
    spellName: name,
  });
  // 9c6ab747 shape: Paralysis to 96.97, free 96.97–99.844, Song of Chi-Ji
  // 99.844 through the death at 101.975
  const caster = makeUnit("c1", {
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, "115078", 94_805, "Paralysis"),
      aura(LogEvent.SPELL_AURA_REMOVED, "115078", 96_970, "Paralysis"),
      aura(LogEvent.SPELL_AURA_APPLIED, "198909", 99_844, "Song of Chi-Ji"),
      aura(LogEvent.SPELL_AURA_REMOVED, "198909", 103_097, "Song of Chi-Ji"),
    ],
  });

  it("measures the longest contiguous gap and names the interval covering the death", () => {
    const f = deathWindowFreedom(caster, new Set(["e1"]), START, 101.975)!;
    // the window opens at 96.975 (death − 5 s), after Paralysis ended
    expect(f.longestFreeS).toBeCloseTo(2.869, 3);
    expect(f.heldAtDeath).toMatchObject({
      spellName: "Song of Chi-Ji",
      fromSeconds: 99.844,
      lockout: false,
    });
  });

  it("renders the stretch and the held-at-death clause on the missed-options line", () => {
    const freedom = deathWindowFreedom(
      caster,
      new Set(["e1"]),
      START,
      101.975,
    )!;
    const text = formatDeathOutcomeForContext({
      events: [
        {
          deadPlayer: "Victim-R",
          deadPlayerSpec: "Arms Warrior",
          atSeconds: 101.975,
          availableImmunities: [],
          missedExternals: [
            {
              casterName: "Caster-R",
              casterSpec: "Arms Warrior",
              spellId: "97462",
              spellName: "Rallying Cry",
              casterWasInCC: false,
              casterFreedom: freedom,
            },
          ],
        },
      ],
    } as never);
    expect(text).toContain(
      "Victim-R died — Caster-R had Rallying Cry available, caster's longest free stretch 2.9s of the last 5s, then in Song of Chi-Ji from 1:39 through the death",
    );
  });
});
