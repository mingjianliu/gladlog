import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { ownerCastCancels } from "../src/utils/castCancels";
import type { RawStreams } from "../src/utils/rawStreams";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const start = (spellId: string, s: number) => ({
  ...makeSpellCastEvent(spellId, at(s), "e1", "Enemy", "p1", "Me"),
  logLine: {
    event: LogEvent.SPELL_CAST_START,
    timestamp: at(s),
    parameters: [],
  },
});
const fail = (spellId: string, s: number, reason: string) => ({
  tSeconds: s,
  unitGuid: "p1",
  spellId: Number(spellId),
  spellName: spellId,
  reason,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ownerCastCancels", () => {
  // Flash Heal 2061: completes in 1.5 s twice (median 1.5 s), then
  //  10 s start → "Interrupted" at 10.6 s            → cancel, 40 %
  //  20 s start → "被打断\r" at 20.9 s (CRLF log)      → cancel, 60 %
  //  30 s start → "Interrupted" at 30.5 s, stunned    → CC, not a cancel
  //  40 s start → "Target not in line of sight"       → not a cancel
  //  50 s start → cancelled at 50.3 s, then an enemy Kick at 50.6 s that hit
  //               nothing → a baited kick
  const owner = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
    info: {}, // a real player: kickAudit only audits kicks on players
    castStartEvents: [0, 4, 10, 20, 30, 40, 50].map((s) => start("2061", s)),
    spellCastEvents: [
      makeSpellCastEvent("2061", at(1.5), "p1", "Me", "p1", "Me"),
      makeSpellCastEvent("2061", at(5.5), "p1", "Me", "p1", "Me"),
    ],
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "853", at(30.5), "e1", "p1"),
    ],
  });
  const enemy = makeUnit("e1", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
    info: {},
    spellCastEvents: [
      makeSpellCastEvent("1766", at(50.6), "p1", "Me", "e1", "Enemy"),
    ],
  });
  const combat: any = {
    startTime: T0,
    endTime: at(120),
    units: { p1: owner, e1: enemy },
  };
  const streams: RawStreams = {
    available: true,
    manaSamples: [],
    castFailed: [
      fail("2061", 10.6, "Interrupted"),
      fail("2061", 20.9, "被打断\r"),
      fail("2061", 30.5, "Interrupted"),
      fail("2061", 40.9, "Target not in line of sight"),
      fail("2061", 50.3, "Interrupted"),
    ],
  };

  it("counts self-cancels with progress, skips CC / other reasons, finds the baited kick", () => {
    const r = ownerCastCancels({
      owner,
      friends: [owner],
      enemies: [enemy],
      combat,
      rawStreams: streams,
    })!;
    expect(r.hardcasts).toBe(7);
    expect(r.cancels.map((c) => [c.startS, c.progressPct])).toEqual([
      [10, 40],
      [20, 60],
      [50, 20],
    ]);
    expect(r.baitedKicks.map((b) => b.atSeconds)).toEqual([50.6]);
  });

  it("does not credit a juked kick that followed a CC'd or line-of-sight-failed cast", () => {
    // Kicks right after the stunned (30.5 s) and LoS-failed (40.9 s) casts:
    // kickAudit calls both "juked", neither follows a cancel.
    const e2 = {
      ...enemy,
      spellCastEvents: [
        makeSpellCastEvent("1766", at(30.8), "p1", "Me", "e1", "Enemy"),
        makeSpellCastEvent("1766", at(41.2), "p1", "Me", "e1", "Enemy"),
      ],
    };
    const r = ownerCastCancels({
      owner,
      friends: [owner],
      enemies: [e2 as never],
      combat: { ...combat, units: { p1: owner, e1: e2 } },
      rawStreams: streams,
    })!;
    expect(r.baitedKicks).toEqual([]);
  });

  // codex review 2026-09-26: each fixture below fails on the pre-fix code.
  const run = (o: any, e: any[], failed: any[]) =>
    ownerCastCancels({
      owner: o,
      friends: [o],
      enemies: e,
      combat: {
        ...combat,
        units: Object.fromEntries([o, ...e].map((u) => [u.id, u])),
      },
      rawStreams: { ...streams, castFailed: failed },
    })!;

  it("pairs a success only inside its own start window", () => {
    // Starts at 0 and 1 s, one success at 2 s: only the 1 s start completed
    // (1.0 s), so a 0.5 s cancel at 10 s is 50 % — not 25 % (the old lookup
    // let the 0 s start claim the same success as a 2.0 s bar).
    const o2 = {
      ...owner,
      castStartEvents: [0, 1, 10].map((s) => start("2061", s)),
      spellCastEvents: [
        makeSpellCastEvent("2061", at(2), "p1", "Me", "p1", "Me"),
      ],
      auraEvents: [],
    };
    expect(
      run(o2, [], [fail("2061", 10.5, "Interrupted")]).cancels.map((c) => [
        c.startS,
        c.progressPct,
      ]),
    ).toEqual([[10, 50]]);
  });

  it("drops a progress estimate above 100 %", () => {
    const o2 = {
      ...owner,
      castStartEvents: [0, 10].map((s) => start("2061", s)),
      spellCastEvents: [
        makeSpellCastEvent("2061", at(1), "p1", "Me", "p1", "Me"),
      ],
      auraEvents: [],
    };
    expect(
      run(o2, [], [fail("2061", 11.5, "Interrupted")]).cancels[0]!.progressPct,
    ).toBeNull();
  });

  it("never credits a kick to a cast that started after it", () => {
    // A starts 60, fails on line of sight 60.5; the kick misses at 60.8; B
    // starts 60.9 and is cancelled at 61.0 — the kick was not aimed at B.
    const o2 = {
      ...owner,
      castStartEvents: [start("2061", 60), start("2061", 60.9)],
      spellCastEvents: [],
      auraEvents: [],
    };
    const e2 = {
      ...enemy,
      spellCastEvents: [
        makeSpellCastEvent("1766", at(60.8), "p1", "Me", "e1", "Enemy"),
      ],
    };
    const r = run(
      o2,
      [e2],
      [
        fail("2061", 60.5, "Target not in line of sight"),
        fail("2061", 61.0, "Interrupted"),
      ],
    );
    expect(r.cancels.map((c) => c.startS)).toEqual([60.9]);
    expect(r.baitedKicks).toEqual([]);
  });

  it("joins a juked kick by GUID, not by name", () => {
    // The kick targets p2, a different unit with the owner's name.
    const e2 = {
      ...enemy,
      spellCastEvents: [
        makeSpellCastEvent("1766", at(50.6), "p2", "Me", "e1", "Enemy"),
      ],
    };
    const twin = { ...owner, id: "p2", castStartEvents: [start("2061", 50)] };
    const r = ownerCastCancels({
      owner,
      friends: [owner, twin as never],
      enemies: [e2 as never],
      combat: { ...combat, units: { p1: owner, p2: twin, e1: e2 } },
      rawStreams: streams,
    })!;
    expect(r.baitedKicks).toEqual([]);
  });

  it("is null for a player who did not record the log (no SPELL_CAST_FAILED)", () => {
    expect(
      ownerCastCancels({
        owner,
        friends: [owner],
        enemies: [enemy],
        combat,
        rawStreams: { ...streams, castFailed: [] },
      }),
    ).toBeNull();
    expect(
      ownerCastCancels({ owner, friends: [owner], enemies: [enemy], combat }),
    ).toBeNull();
  });
});
