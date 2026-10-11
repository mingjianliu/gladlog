/**
 * Triage 2026-09-29, cc-dr theme-local entries:
 *  - F-RT1: `[ROOT]` says what a rooted unit cast on others meanwhile
 *    instead of "this stretch worked like hard CC";
 *  - F-CR1: `[CC REMOVED]` says how long the CC held and how much was left.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { sanctuaryRemovals } from "../src/context/spellOutcomeLines";
import { emitSpellOutcomeEntries } from "../src/context/timelineSections/spellOutcomes";
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
  it("FT board item: 给了按名字查标签的函数时,被定身者、来源和受伤队友都印花名册标签", () => {
    const label = (n: string) =>
      ({
        "Eaxlol-Sargeras-US": "1(ARogue)",
        "Shatters-Garrosh-US": "5(FMage)",
        "Mender-Illidan-US": "2(RDruid)",
      })[n] ?? n;
    const [mine] = formatRootReachabilityEntries(
      [root({ sourcePlayerName: "Shatters-Garrosh-US" })],
      "o",
      undefined,
      label,
    );
    expect(mine!.line).toContain(
      "Frost Nova (from 5(FMage)) rooted friendly [YOU] 1(ARogue) (melee) for 6.0s",
    );
    const [totem] = formatRootReachabilityEntries(
      [
        root({
          rootedId: "h",
          rootedName: "Mender-Illidan-US",
          rootedRole: "healer",
          sourceLabel: "Shatters's totem",
          sourcePlayerName: "Shatters-Garrosh-US",
          sourceKind: "totem",
          worstAlly: { name: "Eaxlol-Sargeras-US", seconds: 4 },
        }),
      ],
      "o",
      undefined,
      label,
    );
    expect(totem!.line).toContain(
      "(from 5(FMage)'s totem) rooted friendly 2(RDruid) (healer)",
    );
    expect(totem!.line).toContain("1(ARogue) (taking damage) out of range/LoS");
    // 没给函数:原样(名字),旧调用方不受影响
    const [plain] = formatRootReachabilityEntries([root({})], "o");
    expect(plain!.line).toContain(
      "(from Shatters-Garrosh-US) rooted friendly [YOU] Eaxlol-Sargeras-US",
    );
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
  const scene = (ccId: string, appliedAtMs = 37_024) => {
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
            START + appliedAtMs,
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
    return { pal, target, rogue };
  };
  const removal = (ccId: string) => {
    const { pal, target, rogue } = scene(ccId);
    return sanctuaryRemovals([pal, target, rogue], START)[0]!;
  };
  /** The `[CC REMOVED]` line of a Cheap Shot (4 s) applied at `appliedAtMs`
   *  and removed at 40.000 by the Sanctuary cast at 39.990. */
  const removedLine = (appliedAtMs: number): string => {
    const { pal, target, rogue } = scene("1833", appliedAtMs);
    const lines: string[] = [];
    emitSpellOutcomeEntries({
      actorLabel: (name: string) => name,
      owner: pal,
      _allUnits: [pal, target, rogue],
      matchEndSeconds: 60,
      matchStartMs: START,
      friends: [pal, target],
      enemies: [rogue],
      pid: (name: string) => name,
      enemyPid: (name: string) => name,
      addEntry: (_t: number, line: string) => lines.push(line),
      rawStreams: undefined,
    } as never);
    const line = lines.find((l) => l.includes("[CC REMOVED]"));
    expect(line).toBeDefined();
    return line!;
  };
  it("a whole second and more prints as before: `after 3s (~1s of it left)`", () => {
    expect(removedLine(37_024)).toMatch(
      /0:39 {2}\[CC REMOVED\] .* removed Rogue-R's Cheap Shot from Priest-R after 3s \(~1s of it left\)$/,
    );
  });
  it("held under half a second reads `after <1s`, not `after 0s`", () => {
    // applied 0.3 s before the removal: 3.7 s of the 4 left
    const line = removedLine(39_700);
    expect(line).toMatch(/ after <1s \(~4s of it left\)$/);
    expect(line).not.toMatch(/after 0s/);
  });
  it("a positive remainder under half a second reads `~<1s of it left`", () => {
    // held 3.7 s of 4: 0.3 s left
    const line = removedLine(36_300);
    expect(line).toMatch(/ after 4s \(~<1s of it left\)$/);
    expect(line).not.toMatch(/~0s/);
  });
  it("a control that had run its full length had nothing left: `~0s` stays", () => {
    // held 4.6 s of 4: `ccRemainingSeconds` clamps at zero
    expect(removedLine(35_400)).toMatch(/ after 5s \(~0s of it left\)$/);
  });
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
