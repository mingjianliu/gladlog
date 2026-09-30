import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  afterShuffleRoundEnd,
  dropCdHoardedBesideExternalUnused,
} from "../src/analysis/candidateFindings";
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

// Triage 2026-09-29 F-H2 / F-H5 / F-H7 / F-H9, user rulings 2026-09-30
// (R1 = B, R3 = A, R4 = B, R5 = B): facts only, the verdict is unchanged.
describe("cdHoardedEvents — signed 09-30 facts", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const stunned = (fromS: number, toS: number, deathS?: number) =>
    ({
      id: "h",
      auraEvents: [
        {
          spellId: "119381",
          spellName: "Leg Sweep",
          srcUnitId: "e",
          timestamp: at(fromS),
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "119381",
          spellName: "Leg Sweep",
          srcUnitId: "e",
          timestamp: at(toS),
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
      actionIn: [],
      deathRecords: deathS === undefined ? [] : [{ timestamp: at(deathS) }],
    }) as unknown as ICombatUnit;
  const run = (
    u: ICombatUnit,
    extra: {
      rawStreams?: unknown;
      teamLedgers?: Parameters<typeof cdHoardedEvents>[9];
    } = {},
  ) => {
    const act = actWindowFor(u, new Set(["e"]), T0);
    return cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point(60)] }],
      [cd()],
      OWNER,
      undefined,
      extra.rawStreams as never,
      [],
      act.couldRespond,
      undefined,
      act.stateIn,
      extra.teamLedgers,
    );
  };

  it("F-H2: rejected presses carry their offsets and the free seconds after the last one", () => {
    const rawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [58.6, 59.4].map((tSeconds) => ({
        tSeconds,
        unitGuid: "h",
        spellId: 33206,
        spellName: "Pain Suppression",
        reason: "Can't do that while stunned",
      })),
    };
    const [e] = run(stunned(58, 59.8), { rawStreams });
    expect(e!.facts!.attempted).toContain("stunned×2");
    expect(e!.facts!.attemptedAt).toBe("-1.4…-0.6s");
    // free from the 59.8 stun end to 65: 5.2 s
    expect(e!.facts!.freeAfterAttemptS).toBe("5.2");
  });

  it("F-H2: freeAfterAttemptS is floored so 0.96 s never renders as 1.0 (the legend threshold)", () => {
    const rawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: 64.04,
          unitGuid: "h",
          spellId: 33206,
          spellName: "Pain Suppression",
          reason: "Can't do that while stunned",
        },
      ],
    };
    const [e] = run(stunned(50, 51), { rawStreams });
    expect(e!.facts!.freeAfterAttemptS).toBe("0.9");
  });

  it("F-H5: windowS only when the owner's death (or the round end) cuts the 5 s", () => {
    const [short] = run(stunned(50, 51, 61.4));
    expect(short!.facts!.windowS).toBe("1.4");
    const [full] = run(stunned(50, 51));
    expect(full!.facts!.windowS).toBeUndefined();
  });

  it("F-H7 / F-H9: the crisis unit's own save and another teammate's ally save are stated, not credited", () => {
    const save = (spellId: string, spellName: string, s: number) => ({
      spellId,
      spellName,
      tag: "Defensive",
      cooldownSeconds: 180,
      casts: [{ timeSeconds: s }],
      neverUsed: false,
    });
    const out = run(stunned(50, 51), {
      teamLedgers: [
        { unit: OWNER, cds: [cd()] },
        { unit: MATE, cds: [save("45438", "Ice Block", 61.1)] },
        {
          unit: { id: "p", name: "Priest-R" },
          cds: [save("47788", "Guardian Spirit", 60.2)],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.facts!.crisisUnitSaved).toBe("Ice Block +1.1s");
    expect(out[0]!.facts!.teamAnswered).toBe(
      "Guardian Spirit (Priest-R) +0.2s",
    );
  });

  it("F-H7 / F-H9: an ally save aimed at someone else is not listed; a self wall aimed at an enemy is (it lands on its caster)", () => {
    const save = (
      spellId: string,
      spellName: string,
      s: number,
      targetName?: string,
    ) => ({
      spellId,
      spellName,
      tag: "Defensive",
      cooldownSeconds: 180,
      casts: [{ timeSeconds: s, targetName }],
      neverUsed: false,
    });
    const [e] = run(stunned(50, 51), {
      teamLedgers: [
        {
          unit: MATE,
          cds: [save("363916", "Obsidian Scales", 61.1, "Enemy-R")],
        },
        {
          unit: { id: "p", name: "Priest-R" },
          cds: [save("47788", "Guardian Spirit", 60.2, "Other-R")],
        },
      ],
    });
    expect(e!.facts!.crisisUnitSaved).toBe("Obsidian Scales +1.1s");
    expect(e!.facts!.teamAnswered).toBeUndefined();
  });

  it("F-H7: an own=yes line never carries crisisUnitSaved", () => {
    const act = actWindowFor(stunned(50, 51), new Set(["e"]), T0);
    const [e] = cdHoardedEvents(
      [{ crisisUnit: OWNER, own: true, points: [point(60)] }],
      [{ ...cd(), spellId: "45438", spellName: "Ice Block" }],
      OWNER,
      undefined,
      undefined,
      [],
      act.couldRespond,
      undefined,
      act.stateIn,
      [
        {
          unit: OWNER,
          cds: [
            {
              spellId: "22812",
              spellName: "Barkskin",
              tag: "Defensive",
              cooldownSeconds: 60,
              casts: [{ timeSeconds: 70 }],
              neverUsed: false,
            },
          ],
        },
      ],
    );
    expect(e?.facts?.crisisUnitSaved).toBeUndefined();
  });
});

// F-H21 (triage 2026-09-29, ruling 2026-09-30 R11 = B): one decision, one
// card — external-unused stays, the cd-hoarded card for the same victim
// within 5 s of the death goes (ba8c0510 :47 / :48)
describe("dropCdHoardedBesideExternalUnused", () => {
  const ev = (type: string, t: number, facts: Record<string, string>) =>
    ({ id: `${type}:${t}`, type, t, unitNames: [], facts }) as never;
  it("drops the same victim's cd-hoarded within 5 s, keeps the rest", () => {
    const out = dropCdHoardedBesideExternalUnused([
      ev("external-unused", 48, { victim: "Zug-R" }),
      ev("cd-hoarded", 47, { crisisUnit: "Zug-R" }),
      ev("cd-hoarded", 30, { crisisUnit: "Zug-R" }),
      ev("cd-hoarded", 46, { crisisUnit: "Other-R" }),
    ]) as Array<{ id: string }>;
    expect(out.map((e) => e.id)).toEqual([
      "external-unused:48",
      "cd-hoarded:30",
      "cd-hoarded:46",
    ]);
  });
  it("the death's fractional instant is compared on the render grid (48.9 vs 43 → 5 s)", () => {
    const out = dropCdHoardedBesideExternalUnused([
      ev("external-unused", 48.9, { victim: "Zug-R" }),
      ev("cd-hoarded", 43, { crisisUnit: "Zug-R" }),
      ev("cd-hoarded", 42, { crisisUnit: "Zug-R" }),
    ]) as Array<{ id: string }>;
    expect(out.map((e) => e.id)).toEqual([
      "external-unused:48.9",
      "cd-hoarded:42",
    ]);
  });
  it("no external-unused on the menu (e.g. 2v2) → nothing removed", () => {
    const menu = [ev("cd-hoarded", 47, { crisisUnit: "Zug-R" })];
    expect(dropCdHoardedBesideExternalUnused(menu)).toBe(menu);
  });
});

// F-H6 (ruling 2026-09-30 A8): an unaffordable cooldown is not named ready;
// unknown (null) does not gate; the response set is untouched
describe("cdHoardedEvents — ownerAffordable (F-H6)", () => {
  const run = (afford: (id: string) => boolean | null) =>
    cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point(60)] }],
      [cd()],
      OWNER,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      (spellId, fromS, toS) => {
        expect([fromS, toS]).toEqual([60, 65]);
        return afford(spellId);
      },
    );
  it("false → not ready → no line", () => {
    expect(run(() => false)).toHaveLength(0);
  });
  it("null (unknown) or true → the line stands", () => {
    expect(run(() => null)).toHaveLength(1);
    expect(run(() => true)).toHaveLength(1);
  });
});
