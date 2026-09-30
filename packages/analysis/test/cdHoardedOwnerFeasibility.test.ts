import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { afterShuffleRoundEnd } from "../src/analysis/candidateFindings";
import { cdHoardedEvents } from "../src/analysis/candidates/cooldownTiming";
import {
  actWindowFor,
  couldRespondFor,
} from "../src/utils/cannotCastIntervals";

describe("afterShuffleRoundEnd — Solo Shuffle ends at the first player death (W1a)", () => {
  const units = [
    { info: {}, deathRecords: [{ timestamp: 1_000_000 + 106_378 }] },
    { info: {}, deathRecords: [] },
    { deathRecords: [{ timestamp: 1_000_000 + 50_000 }] }, // a pet: ignored
  ];
  const shuffle = { startInfo: { bracket: "Rated Solo Shuffle" } };

  it("drops seconds after the round-ending death, keeps its own displayed second", () => {
    const after = afterShuffleRoundEnd(shuffle, units, 1_000_000)!;
    expect(after(107)).toBe(true);
    expect(after(106)).toBe(false);
    expect(after(60)).toBe(false);
  });

  it("does nothing outside Solo Shuffle, or with no player death", () => {
    expect(
      afterShuffleRoundEnd({ startInfo: { bracket: "3v3" } }, units, 1_000_000),
    ).toBeUndefined();
    expect(
      afterShuffleRoundEnd(
        shuffle,
        [{ info: {}, deathRecords: [] }],
        1_000_000,
      ),
    ).toBeUndefined();
  });
});

/**
 * Reliability round 2 W1a (2026-09-25): cd-hoarded must not accuse an owner
 * who could not act during the response window. `p.inCC` describes the crisis
 * unit only, so a teammate crisis never checked the owner at all (6fcb:
 * Garrote - Silence on the healer 58.5–61.5 s at a 1:00 teammate crisis).
 */
const OWNER = { id: "h", name: "Healer-R" };
const MATE = { id: "m", name: "Mate-R" };
const point = (tSec: number) => ({
  tSec,
  hpPct: 30,
  dmg2s: 0.3,
  attackers2s: 1,
  enemyBurst: false,
  inCC: false,
  dangerous: true,
});
// Pain Suppression — an external that can reach a teammate
const cd = () => ({
  spellId: "33206",
  spellName: "Pain Suppression",
  tag: "Defensive",
  cooldownSeconds: 180,
  casts: [] as { timeSeconds: number }[],
  neverUsed: true,
});

describe("cdHoardedEvents — owner feasibility (W1a)", () => {
  const run = (couldRespond?: (fromS: number, toS: number) => boolean) =>
    cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point(60)] }],
      [cd()],
      OWNER,
      undefined,
      undefined,
      undefined,
      couldRespond,
    );

  it("accuses when the owner could act, and not when the owner could not", () => {
    expect(run(() => true)).toHaveLength(1);
    expect(run(() => false)).toHaveLength(0);
  });

  it("asks about the same window 'spent' uses: [t − 1.5 s, t + 5 s]", () => {
    const seen: Array<[number, number]> = [];
    run((a, b) => {
      seen.push([a, b]);
      return true;
    });
    expect(seen).toEqual([[58.5, 65]]);
  });

  it("without the callback (no combat clock) the old behaviour stands", () => {
    expect(run(undefined)).toHaveLength(1);
  });
});

describe("couldRespondFor — the one could-react predicate (W1a)", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const enemyIds = new Set(["e"]);
  const unitWith = (
    auras: Array<[string, number, LogEvent]>,
    deathS?: number,
  ) =>
    ({
      id: "h",
      auraEvents: auras.map(([spellId, s, event]) => ({
        spellId,
        spellName: spellId,
        srcUnitId: "e",
        srcUnitName: "Rogue-R",
        timestamp: at(s),
        logLine: { event },
      })),
      actionIn: [],
      deathRecords: deathS === undefined ? [] : [{ timestamp: at(deathS) }],
    }) as unknown as ICombatUnit;

  it("a silence covering the whole window → could not respond", () => {
    const u = unitWith([
      ["1330", 58, LogEvent.SPELL_AURA_APPLIED],
      ["1330", 66, LogEvent.SPELL_AURA_REMOVED],
    ]);
    expect(couldRespondFor(u, enemyIds, T0)(58.5, 65)).toBe(false);
  });

  it("a silence that leaves ≥ 1 s free → could respond", () => {
    const u = unitWith([
      ["1330", 58, LogEvent.SPELL_AURA_APPLIED],
      ["1330", 62, LogEvent.SPELL_AURA_REMOVED],
    ]);
    expect(couldRespondFor(u, enemyIds, T0)(58.5, 65)).toBe(true);
  });

  it("dead before the window → could not respond", () => {
    const u = unitWith([], 50);
    expect(couldRespondFor(u, enemyIds, T0)(58.5, 65)).toBe(false);
  });

  // triage 2026-09-29 H4: time after the match end is not playable
  it("free only after the match end → could not respond", () => {
    const u = unitWith([
      ["1330", 58, LogEvent.SPELL_AURA_APPLIED],
      ["1330", 62, LogEvent.SPELL_AURA_REMOVED],
    ]);
    expect(couldRespondFor(u, enemyIds, T0, at(61.5))(58.5, 65)).toBe(false);
    // without the round end the post-end seconds counted (the old answer)
    expect(couldRespondFor(u, enemyIds, T0)(58.5, 65)).toBe(true);
  });

  it("1.87 s free before the match end → could respond (9c6ab747 shape)", () => {
    const u = unitWith([]);
    expect(couldRespondFor(u, enemyIds, T0, at(116.371))(114.5, 121)).toBe(
      true,
    );
  });
});

// triage 2026-09-29 H1: the gate lets an owner CC'd for most of the window
// through (1 s standard, ruling 2026-09-23/26); the facts say what it saw.
describe("cdHoardedEvents — ownerCc / ownerFreeS facts (H1)", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  // Blind (2094) −4.4 … +0.6 s around a crisis at 60 s (e10c6bea shape)
  const owner = {
    id: "h",
    auraEvents: [
      {
        spellId: "2094",
        spellName: "致盲",
        srcUnitId: "e",
        timestamp: at(55.6),
        logLine: { event: LogEvent.SPELL_AURA_APPLIED },
      },
      {
        spellId: "2094",
        spellName: "致盲",
        srcUnitId: "e",
        timestamp: at(60.625),
        logLine: { event: LogEvent.SPELL_AURA_REMOVED },
      },
    ],
    actionIn: [],
    deathRecords: [],
  } as unknown as ICombatUnit;
  const run = (u: ICombatUnit) => {
    const act = actWindowFor(u, new Set(["e"]), T0);
    return cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point(60)] }],
      [cd()],
      OWNER,
      undefined,
      undefined,
      undefined,
      act.couldRespond,
      undefined,
      act.stateIn,
    );
  };

  it("names the blocker with offsets from t and the free seconds after t", () => {
    const [e] = run(owner);
    expect(e!.facts!.ownerCc).toBe("Blind -4.4…+0.6s");
    expect(e!.facts!.ownerFreeS).toBe("4.4");
  });

  it("a free owner carries neither fact", () => {
    const [e] = run({ ...owner, auraEvents: [] } as unknown as ICombatUnit);
    expect(e!.facts!.ownerCc).toBeUndefined();
    expect(e!.facts!.ownerFreeS).toBeUndefined();
  });

  it("a kick lockout and a second blocker are named in start order (138e632d shape)", () => {
    const u = {
      ...owner,
      auraEvents: [
        {
          spellId: "99",
          spellName: "夺魂咆哮",
          srcUnitId: "e",
          timestamp: at(60.871),
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "99",
          spellName: "夺魂咆哮",
          srcUnitId: "e",
          timestamp: at(63.882),
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
      actionIn: [
        {
          spellId: "93985",
          srcUnitId: "e",
          timestamp: at(58.921),
          logLine: { event: LogEvent.SPELL_INTERRUPT },
        },
      ],
    } as unknown as ICombatUnit;
    const [e] = run(u);
    expect(e!.facts!.ownerCc).toMatch(
      /^Skull Bash lockout -1\.1…\+\d\.\ds; Incapacitating Roar \+0\.9…\+3\.9s$/,
    );
  });

  it("a CC that lands after the round end is not named, like the gate never saw it", () => {
    const late = {
      ...owner,
      auraEvents: [
        {
          spellId: "8122",
          spellName: "Psychic Scream",
          srcUnitId: "e",
          timestamp: at(62),
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "8122",
          spellName: "Psychic Scream",
          srcUnitId: "e",
          timestamp: at(64),
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
    } as unknown as ICombatUnit;
    const act = actWindowFor(late, new Set(["e"]), T0, at(61));
    expect(act.stateIn(58.5, 65, 60)!.blocks).toEqual([]);
    const [e] = cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point(60)] }],
      [cd()],
      OWNER,
      undefined,
      undefined,
      undefined,
      act.couldRespond,
      undefined,
      act.stateIn,
    );
    expect(e!.facts!.ownerCc).toBeUndefined();
  });

  it("the free seconds stop at the round end, like the gate", () => {
    const act = actWindowFor(owner, new Set(["e"]), T0, at(62));
    expect(act.stateIn(58.5, 65, 60)!.freeAfterS).toBeCloseTo(1.375, 3);
  });
});
