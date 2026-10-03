/**
 * Triage 2026-09-29, cc-dr theme-local entries:
 *  - F-RT1: `[ROOT]` says what a rooted unit cast on others meanwhile
 *    instead of "this stretch worked like hard CC";
 *  - F-CR1: `[CC REMOVED]` says how long the CC held and how much was left.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { sanctuaryRemovals } from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import { formatRootReachabilityEntries } from "../src/utils/rootReachability";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const root = (over: object) =>
  ({
    atSeconds: 23,
    durationSeconds: 6,
    rootedId: "o",
    rootedName: "Eaxlol-Sargeras-US",
    rootedIsFriendly: true,
    rootedRole: "melee",
    sourceName: "Shatters-Garrosh-US",
    sourceLabel: "Shatters-Garrosh-US",
    spellId: "122",
    spellName: "Frost Nova",
    unreachableSeconds: 5,
    sampledSeconds: 6,
    significant: true,
    ...over,
  }) as never;

describe("cc-dr F-RT1 — a rooted unit that acted is not locked out", () => {
  it("names the casts on others in place of 'worked like hard CC'", () => {
    const [e] = formatRootReachabilityEntries(
      [root({ castsOnOthers: [{ spellName: "Blind", destId: "e4" }] })],
      "o",
      (id) => (id === "e4" ? "4(RShaman)" : id),
    );
    expect(e!.line).toContain(
      "could not attack; cast 1 spell on others meanwhile (Blind → 4(RShaman))",
    );
    expect(e!.line).not.toContain("worked like hard CC");
  });
  it("control: no casts on others keeps the hard-CC wording", () => {
    const [e] = formatRootReachabilityEntries([root({})], "o");
    expect(e!.line).toContain(
      "could not attack; this stretch worked like hard CC",
    );
  });
});

describe("cc-dr F-CR1 — a Sanctuary removal says held and left", () => {
  const START = 1_000_000;
  const removal = (ccId: string) => {
    const rogue = makeUnit("rogue", {
      name: "Rogue-R",
      reaction: CombatUnitReaction.Hostile,
    });
    const target = makeUnit("hp", {
      name: "Priest-R",
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            ccId,
            START + 37_024,
            "rogue",
            "hp",
          ),
          srcUnitName: "Rogue-R",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            ccId,
            START + 40_000,
            "rogue",
            "hp",
          ),
          srcUnitName: "Rogue-R",
        },
      ],
    });
    const pal = makeUnit("pal", {
      name: "Paladin-R",
      spellCastEvents: [
        makeSpellCastEvent("210256", START + 39_990, "hp", "Priest-R", "pal"),
      ],
    });
    return sanctuaryRemovals([pal, target, rogue], START)[0]!;
  };
  it("0777a8e0 shape: Cheap Shot held 2.976 s of 4 → ~1 s left", () => {
    const r = removal("1833");
    expect(r.heldSeconds).toBeCloseTo(2.976, 3);
    expect(r.leftSeconds).toBeCloseTo(1.024, 2);
  });
  it("1c12961d shape: Maim has no known full duration → held only", () => {
    const r = removal("203123");
    expect(r.heldSeconds).toBeCloseTo(2.976, 3);
    expect(r.leftSeconds).toBe(null);
  });

  // codex review 35-CD-34: both lookups must stop at the specific event in
  // the stream, not at its timestamp.
  const aura = (ev: LogEvent, id: string, ms: number) => ({
    ...makeAuraEvent(ev, id, START + ms, "rogue", "hp"),
    srcUnitName: "Rogue-R",
  });
  const run = (auras: object[]) => {
    const rogue = makeUnit("rogue", {
      name: "Rogue-R",
      reaction: CombatUnitReaction.Hostile,
    });
    const target = makeUnit("hp", {
      name: "Priest-R",
      auraEvents: auras as never,
    });
    const pal = makeUnit("pal", {
      name: "Paladin-R",
      spellCastEvents: [
        makeSpellCastEvent("210256", START + 12_990, "hp", "Priest-R", "pal"),
      ],
    });
    return sanctuaryRemovals([pal, target, rogue], START)[0]!;
  };
  it("a re-application after the removal at the same ms is not the application", () => {
    const r = run([
      aura(LogEvent.SPELL_AURA_APPLIED, "1833", 10_000),
      aura(LogEvent.SPELL_AURA_REMOVED, "1833", 13_000),
      aura(LogEvent.SPELL_AURA_APPLIED, "1833", 13_000),
    ]);
    expect(r.heldSeconds).toBeCloseTo(3, 3);
    expect(r.leftSeconds).toBeCloseTo(1, 2);
  });
  it("a Roar removed after the application at the same ms still lengthens it", () => {
    const r = run([
      aura(LogEvent.SPELL_AURA_APPLIED, "372048", 9_000),
      aura(LogEvent.SPELL_AURA_APPLIED, "1833", 10_000),
      aura(LogEvent.SPELL_AURA_REMOVED, "372048", 10_000),
      aura(LogEvent.SPELL_AURA_REMOVED, "1833", 13_000),
    ]);
    expect(r.heldSeconds).toBeCloseTo(3, 3);
    expect(r.leftSeconds).toBeCloseTo(4 * 1.3 - 3, 2);
  });
});
