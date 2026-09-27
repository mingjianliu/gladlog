/**
 * codex post-hoc review of reliability leftovers batches 11–14 (2026-09-27,
 * after agy's pass): each confirmed finding pinned by its counterexample.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { trimFoldedLocksAfter } from "../src/analysis/candidateFindings";
import { evaluateSyncWindow } from "../src/analysis/candidates/cooldownTiming";
import {
  damageEventLabel,
  getTopDamageSourcesInWindow,
} from "../src/context/timelineHelpers";
import {
  groundedControls,
  ownerRejectRuns,
  reflectedSpells,
  sanctuaryRemovals,
} from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";
import { wallTimingPhrase, wallUpAtOpen } from "../src/utils/burstLedger";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const unitAt = (
  id: string,
  spec: unknown,
  xAt: ((s: number) => number) | null,
  extra: Record<string, unknown> = {},
) =>
  ({
    id,
    name: id,
    spec,
    info: undefined,
    spellCastEvents: [],
    castStartEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    advancedActions: xAt
      ? Array.from({ length: 401 }, (_, i) => ({
          timestamp: START + i * 500,
          logLine: { timestamp: START + i * 500 },
          advanced: true,
          advancedActorCurrentHp: 100,
          advancedActorMaxHp: 100,
          advancedActorPositionX: xAt(i / 2),
          advancedActorPositionY: 0,
          advancedActorPowers: [],
        }))
      : [],
    ...extra,
  }) as unknown as ICombatUnit;
const smash = (owner: ICombatUnit, targets: ICombatUnit[]) => ({
  spellId: "167105",
  spellName: "Colossus Smash",
  casts: [] as { timeSeconds: number }[],
  cooldownSeconds: 45,
  neverUsed: true,
  owner,
  ownerEnemyIds: new Set(["Enemy-1", "Enemy-2"]),
  matchStartMs: START,
  reachTargets: targets,
});
const lock = { fromSeconds: 100, toSeconds: 106 };
const kidney = (event: LogEvent, s: number) => ({
  logLine: { event },
  spellId: "408",
  spellName: "Kidney Shot",
  srcUnitId: "Enemy-1",
  srcUnitName: "Enemy-1",
  timestamp: START + s * 1000,
});

describe("batch 11 — reach counts only while the owner can act (codex P1)", () => {
  it("in reach only while stunned (100–102), 25 yd once free → not ready", () => {
    const enemy = unitAt("Enemy-1", 252, (s) => (s < 102 ? 3 : 25));
    const stunned = unitAt("Player-1", 71, () => 0, {
      auraEvents: [
        kidney(LogEvent.SPELL_AURA_APPLIED, 100),
        kidney(LogEvent.SPELL_AURA_REMOVED, 102),
      ],
    });
    expect(
      evaluateSyncWindow(lock, [smash(stunned, [enemy])]).ready,
    ).toHaveLength(0);
    // control: the same geometry without the stun — in reach while free
    const free = unitAt("Player-1", 71, () => 0);
    expect(evaluateSyncWindow(lock, [smash(free, [enemy])]).ready).toHaveLength(
      1,
    );
  });
});

describe("batch 11 — an unpositioned living target abstains (codex P2)", () => {
  it("one enemy at 25 yd, the other never positioned → ready (fail-open, as CD_OUT_OF_RANGE)", () => {
    const warrior = unitAt("Player-1", 71, () => 0);
    const far = unitAt("Enemy-1", 252, () => 25);
    const unseen = unitAt("Enemy-2", 70, null);
    expect(
      evaluateSyncWindow(lock, [smash(warrior, [far, unseen])]).ready,
    ).toHaveLength(1);
    expect(
      evaluateSyncWindow(lock, [smash(warrior, [far])]).ready,
    ).toHaveLength(0);
  });
});

describe("batch 11 — a gap in the owner's own samples is bridged (probe 545-1)", () => {
  it("a rogue 30 yd off the target with a 2 s hole in his positions stays unreachable", () => {
    const rogue = unitAt("Player-1", 259, () => 0);
    // drop the owner's samples for 102–104 s
    (
      rogue as unknown as { advancedActions: { timestamp: number }[] }
    ).advancedActions = (
      rogue as unknown as { advancedActions: { timestamp: number }[] }
    ).advancedActions.filter(
      (a) => a.timestamp < START + 101_000 || a.timestamp > START + 104_500,
    );
    const far = unitAt("Enemy-1", 252, () => 30);
    expect(evaluateSyncWindow(lock, [smash(rogue, [far])]).ready).toHaveLength(
      0,
    );
  });
});

describe("batch 11 — folded locks obey the Solo Shuffle round end (codex P2)", () => {
  const ended = (t: number) => t > 445;
  it("a folded lock after the round-ending death leaves facts.alsoHeldAt", () => {
    const e = { t: 439, facts: { alsoHeldAt: "442、448" } };
    expect(trimFoldedLocksAfter(e, ended).facts.alsoHeldAt).toBe("442");
    const only = { t: 439, facts: { alsoHeldAt: "448" } };
    expect(trimFoldedLocksAfter(only, ended).facts).not.toHaveProperty(
      "alsoHeldAt",
    );
    const inside = { t: 439, facts: { alsoHeldAt: "442" } };
    expect(trimFoldedLocksAfter(inside, ended)).toBe(inside);
  });
});

describe("batch 12 — the up-at-opening test reads the raw offset (codex P2)", () => {
  it("a wall 30 ms after the opening (rounded 0.0) is a reaction, not 'already up'", () => {
    const late = { startOffsetSeconds: 0, startOffsetMs: 30 };
    expect(wallUpAtOpen(late)).toBe(false);
    expect(wallTimingPhrase(late)).toBe("pressed <0.1s after the burst opened");
    expect(wallUpAtOpen({ startOffsetSeconds: 0, startOffsetMs: 0 })).toBe(
      true,
    );
    expect(
      wallUpAtOpen({ startOffsetSeconds: -2.1, startOffsetMs: -2100 }),
    ).toBe(true);
    expect(wallUpAtOpen({})).toBeUndefined();
  });
});

describe("batch 12 — absorbs on documents without attackSpellId (codex P2)", () => {
  const hostile = 0x548;
  const T0 = 1_000_000;
  const victim = (absorbs: object[]) =>
    ({
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [],
      absorbsIn: absorbs,
    }) as never;
  const absorb = (extra: object) => ({
    timestamp: T0 + 5_000,
    absorbedAmount: 108_000,
    attackerId: "Player-B",
    srcUnitFlags: hostile,
    logLine: { timestamp: T0 + 5_000, parameters: [] },
    ...extra,
  });
  const top = (u: never) =>
    getTopDamageSourcesInWindow(
      u,
      T0 + 10_000,
      10_000,
      3,
      new Map(),
      new Map([["Boomy-R-US", 5]]),
      new Map(),
      new Map([["Player-B", "Boomy-R-US"]]),
    );
  it("an older document (no absorb carries the field) never names Melee [Physical]", () => {
    const out = top(victim([absorb({})]));
    expect(out.join("\n")).not.toMatch(/Melee/);
    expect(out[0]).toMatch(/^5 — unrecorded ability/);
  });
  it("a document that records the field: a spell-less absorb is a swing", () => {
    const out = top(
      victim([
        absorb({}),
        absorb({ attackSpellId: "78674", attackSpellName: "Starsurge" }),
      ]),
    );
    expect(out.some((l) => /^5 — Melee/.test(l))).toBe(true);
    expect(out.some((l) => /^5 — Starsurge/.test(l))).toBe(true);
  });
});

describe("batch 12 — a mind-controlled attacker keeps its own roster number (codex P2)", () => {
  it("enemy Alex-Enemy-US logging as friendly is still 4, not friendly Alex (1)", () => {
    const friendlyFlags = 0x511; // reaction friendly, player
    const label = damageEventLabel(
      {
        srcUnitId: "Player-AE",
        srcUnitName: "Alex-Enemy-US",
        srcUnitFlags: friendlyFlags,
        spellId: "78674",
        spellName: "Starsurge",
      } as never,
      new Map([
        ["Alex-Friendly-US", 1],
        ["Alex", 1],
      ]),
      new Map([["Alex-Enemy-US", 4]]),
    );
    expect(label).toMatch(/^4 — /);
  });
});

describe("batch 13 — outcome lines need their own evidence (codex P2)", () => {
  const T0 = 1_000_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unit = (id: string, over: Record<string, unknown> = {}): any => ({
    id,
    name: `${id}-R-US`,
    spellCastEvents: [],
    auraEvents: [],
    missesOut: [],
    damageIn: [],
    absorbsIn: [],
    advancedActions: [0, 10_000, 20_000].map((ms) => ({
      advancedActorId: id,
      advancedActorMaxHp: 500_000,
      advancedActorCurrentHp: 500_000,
      logLine: { timestamp: T0 + ms },
    })),
    ...over,
  });
  const cast = (spellId: string, dest: string, ms: number) => ({
    spellId,
    spellName: "x",
    destUnitId: dest,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + ms },
  });

  it("a control cast whose destination is a Grounding Totem is stated as redirected, with or without a miss line", () => {
    // Hammer of Justice into a totem leaves no SPELL_MISSED and totem deaths
    // are never logged — the destination is the evidence; the line says
    // "redirected into", not "eaten" (codex review of batch 13, revised)
    const totem = "Creature-0-1-1-1-5925-000A";
    const pal = unit("Player-L", {
      spellCastEvents: [cast("853", totem, 10_000)],
    });
    expect(groundedControls([pal], T0, new Set())).toHaveLength(1);
  });

  it("a Kidney Shot trinketed 30 ms before the Sanctuary landed is not the Sanctuary's", () => {
    const pal = unit("Player-Pal", {
      spellCastEvents: [cast("210256", "Player-H", 10_030)],
    });
    const hunterWith = (removeMs: number, trinket: boolean) =>
      unit("Player-H", {
        spellCastEvents: trinket ? [cast("336126", "", 10_000)] : [],
        auraEvents: [
          {
            spellId: "408",
            spellName: "x",
            srcUnitId: "Player-R",
            srcUnitName: "Rogue",
            logLine: {
              event: LogEvent.SPELL_AURA_REMOVED,
              timestamp: T0 + removeMs,
            },
          },
        ],
      });
    expect(sanctuaryRemovals([pal, hunterWith(10_000, true)], T0)).toHaveLength(
      0,
    );
    // removed before the Sanctuary landed, even with no trinket seen
    expect(
      sanctuaryRemovals([pal, hunterWith(10_000, false)], T0),
    ).toHaveLength(0);
    // at the landing, no competing break: the Sanctuary's
    expect(
      sanctuaryRemovals([pal, hunterWith(10_030, false)], T0),
    ).toHaveLength(1);
  });

  it("two reflected Shadow Word: Pains: a tick belongs to the latest reflect only", () => {
    const refl = (dest: string, ms: number) => ({
      spellId: "589",
      spellName: "x",
      missType: "REFLECT",
      destUnitId: dest,
      logLine: { timestamp: T0 + ms },
    });
    const priest = unit("Player-P", {
      missesOut: [refl("Player-A", 5_000), refl("Player-B", 8_000)],
      damageIn: [
        {
          spellId: "589",
          srcUnitId: "Player-P",
          effectiveAmount: -100_000,
          logLine: { timestamp: T0 + 9_000 },
        },
      ],
    });
    const out = reflectedSpells(
      [priest, unit("Player-A"), unit("Player-B")],
      T0,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.reflectorId).toBe("Player-B");
    expect(out[0]!.damageBack).toBe(100_000);
  });

  it("a channel's bolts reflected one after another are one reflect, its damage summed once (Penance)", () => {
    const bolt = (ms: number) => ({
      spellId: "47540",
      spellName: "x",
      missType: "REFLECT",
      destUnitId: "Player-W",
      logLine: { timestamp: T0 + ms },
    });
    const hit = (ms: number) => ({
      spellId: "47540",
      srcUnitId: "Player-W",
      effectiveAmount: -15_000,
      logLine: { timestamp: T0 + ms },
    });
    const priest = unit("Player-P", {
      missesOut: [bolt(16_000), bolt(16_500), bolt(17_000), bolt(17_500)],
      damageIn: [hit(16_100), hit(16_600), hit(17_100), hit(17_600)],
    });
    const out = reflectedSpells([priest, unit("Player-W")], T0);
    expect(out).toHaveLength(1);
    expect(out[0]!.damageBack).toBe(60_000);
  });

  it("the same spell refused for another reason in between splits the run", () => {
    const f = (s: number, reason: string, spellId = 6789) => ({
      tSeconds: s,
      unitGuid: "Player-O",
      spellId,
      spellName: "Mortal Coil",
      reason,
    });
    const alternating = [
      f(10, "Out of range"),
      f(10.5, "Not yet recovered"),
      f(11, "Out of range"),
      f(11.5, "Not yet recovered"),
      f(12, "Out of range"),
    ];
    expect(ownerRejectRuns(alternating, "Player-O")).toHaveLength(0);
    // another spell's not-ready press does not split a Mortal Coil run
    const other = [
      f(10, "Out of range"),
      f(10.5, "Not yet recovered", 172),
      f(11, "Out of range"),
      f(12, "Out of range"),
    ];
    expect(ownerRejectRuns(other, "Player-O")[0]?.count).toBe(3);
  });
});
