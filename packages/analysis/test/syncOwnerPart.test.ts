/**
 * L04 (c) (user ruling 2026-10-11) — in Solo Shuffle a missed-sync-window
 * row reaches the log owner's menu only when part of it is the owner's: one
 * of its ready cooldowns, or the lock. 2v2 / 3v3 keep every row. The cut is
 * made after the cap.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  missedSyncWindowEvents,
  syncRowHasOwnerPart,
  syncRowNarrowedToOwnerPart,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";
import { SOLO_SHUFFLE_BRACKET } from "../src/utils/roundEnd";

beforeAll(async () => {
  await ensureAnalysisData();
});

const ref = (cellKey: string) => ({
  cellKey,
  nEntered: 174,
  killEnteredPct: 18,
  nUnentered: 174,
  killUnenteredPct: 8,
});
const ME = { id: "Player-1", name: "Me-Realm-EU" };
const MATE = { id: "Player-2", name: "Glaivemeomg-Stormscale-EU" };
const MATE2 = { id: "Player-3", name: "Klamphugger-Auchindoun-EU" };
const probes = (cellKey: string, over: Record<string, unknown> = {}) =>
  ({
    enemyMinHpPctAt: () => 50,
    enemyDeathS: [],
    ref: ref(cellKey),
    ownerId: ME.id,
    ownerName: ME.name,
    ...over,
  }) as any;
const lock = (from: number, to: number, spell: string, casterName: string) => ({
  fromSeconds: from,
  toSeconds: to,
  spellName: spell,
  spellId: spell,
  healerName: "H1",
  casterName,
});
const cd = (
  spell: string,
  owner: { id: string; name: string },
  casts: number[] = [],
) => ({
  spellId: spell,
  spellName: spell,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  cooldownSeconds: 60,
  neverUsed: casts.length === 0,
  owner,
});

describe("syncRowNarrowedToOwnerPart / syncRowHasOwnerPart", () => {
  it("only the Solo Shuffle cell is narrowed", () => {
    expect(syncRowNarrowedToOwnerPart(SOLO_SHUFFLE_BRACKET)).toBe(true);
    expect(syncRowNarrowedToOwnerPart("3v3")).toBe(false);
    expect(syncRowNarrowedToOwnerPart("2v2")).toBe(false);
    expect(syncRowNarrowedToOwnerPart(undefined)).toBe(false);
  });

  it("the owner's part: a (yours) entry, or setupBy — whole or part of a chain", () => {
    expect(syncRowHasOwnerPart({ readyCds: "The Hunt (A-B's)" })).toBe(false);
    expect(
      syncRowHasOwnerPart({ readyCds: "The Hunt (A-B's)、Zenith (yours)" }),
    ).toBe(true);
    expect(
      syncRowHasOwnerPart({ readyCds: "The Hunt (A-B's)", setupBy: "you" }),
    ).toBe(true);
    expect(
      syncRowHasOwnerPart({
        readyCds: "The Hunt (A-B's)",
        setupBy: "you (Fear)",
      }),
    ).toBe(true);
    expect(
      syncRowHasOwnerPart({
        readyCds: "The Hunt (A-B's)",
        alsoHeldSetupBy: "100: you (Polymorph)",
      }),
    ).toBe(true);
    // a bare name states no holder — not the owner's
    expect(syncRowHasOwnerPart({ readyCds: "Zenith" })).toBe(false);
  });
});

describe("missed-sync-window in Solo Shuffle (L04 (c))", () => {
  // d7fbdf1a round 5, owner a Restoration Shaman: the Demon Hunter's Chaos
  // Nova at 85 s with his own The Hunt ready — nothing of it the owner's
  const mateLock = [lock(85, 88, "Chaos Nova", MATE.name)];
  const mateCd = [cd("The Hunt", MATE)];

  it("neither the cooldown nor the control is the owner's: no row", () => {
    expect(
      missedSyncWindowEvents(
        mateLock,
        mateCd as any,
        probes(SOLO_SHUFFLE_BRACKET),
      ),
    ).toEqual([]);
  });

  it("the same round in 3v3 / 2v2 keeps the row", () => {
    for (const bracket of ["3v3", "2v2"]) {
      const rows = missedSyncWindowEvents(
        mateLock,
        mateCd as any,
        probes(bracket),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.facts.readyCds).toBe(
        "The Hunt (Glaivemeomg-Stormscale-EU's)",
      );
    }
  });

  it("the owner holds one of the ready cooldowns: the row stays, teammates' entries with it", () => {
    const [e] = missedSyncWindowEvents(
      mateLock,
      [cd("The Hunt", MATE), cd("Touch of the Magi", ME)] as any,
      probes(SOLO_SHUFFLE_BRACKET),
    );
    expect(e!.facts.readyCds).toBe(
      "The Hunt (Glaivemeomg-Stormscale-EU's)、Touch of the Magi (yours)",
    );
    expect(e!.facts.setupBy).toBeUndefined();
  });

  it("the owner cast the control: the row stays (setupBy=you), whoever holds the cooldown", () => {
    const [e] = missedSyncWindowEvents(
      [lock(85, 88, "Hex", ME.name)],
      mateCd as any,
      probes(SOLO_SHUFFLE_BRACKET),
    );
    expect(e!.facts.setupBy).toBe("you");
    expect(e!.facts.readyCds).toBe("The Hunt (Glaivemeomg-Stormscale-EU's)");
  });

  it("the owner cast a lock folded into the row: alsoHeldSetupBy names it and the row stays (codex R6C-01 #3)", () => {
    const [e, ...rest] = missedSyncWindowEvents(
      [lock(85, 88, "Chaos Nova", MATE.name), lock(100, 104, "Polymorph", ME.name)],
      mateCd as any,
      probes(SOLO_SHUFFLE_BRACKET),
    );
    expect(rest).toEqual([]);
    expect(e!.facts.setupBy).toBeUndefined();
    expect(e!.facts.alsoHeldAt).toBe("100");
    expect(e!.facts.alsoHeldSetupBy).toBe("100: you");
    // HAS TEETH: the same folded lock a teammate's — nothing of it the owner's
    expect(
      missedSyncWindowEvents(
        [
          lock(85, 88, "Chaos Nova", MATE.name),
          lock(100, 104, "Polymorph", MATE2.name),
        ],
        mateCd as any,
        probes(SOLO_SHUFFLE_BRACKET),
      ),
    ).toEqual([]);
  });

  it("the cut is made after the cap: a removed row lets no shorter lock in", () => {
    // three locks, each with another ready cooldown (a press between them
    // makes each its own hold): the two longest are teammates', the shortest
    // the owner's own
    const locks = [
      lock(40, 46, "Chaos Nova", MATE.name), // 6 s
      lock(110, 115, "Dragon's Breath", MATE2.name), // 5 s
      lock(180, 183, "Chaos Nova", MATE.name), // 3 s
    ];
    const cds = [
      cd("The Hunt", MATE, [60]), // ready at 40, pressed 60, back at 120
      cd("Arcane Surge", MATE2, [130]), // ready at 110
      cd("Zenith", ME, [10, 80]), // on cooldown until 140: ready at 180 only
    ];
    const uncapped = missedSyncWindowEvents(locks, cds as any, probes("3v3"), {
      cap: 99,
    });
    expect(uncapped.map((e) => e.t)).toEqual([40, 110, 180]);
    expect(uncapped[2]!.facts.readyCds).toContain("Zenith (yours)");
    // 3v3: the cap keeps the two longest
    expect(
      missedSyncWindowEvents(locks, cds as any, probes("3v3")).map((e) => e.t),
    ).toEqual([40, 110]);
    // Solo Shuffle: both go, and the 180 s lock does not take their place
    expect(
      missedSyncWindowEvents(locks, cds as any, probes(SOLO_SHUFFLE_BRACKET)),
    ).toEqual([]);
  });

  it("with no owner in the question nothing is cut (the calibration counts)", () => {
    expect(
      missedSyncWindowEvents(
        mateLock,
        mateCd as any,
        probes(SOLO_SHUFFLE_BRACKET, {
          ownerId: undefined,
          ownerName: undefined,
        }),
      ),
    ).toHaveLength(1);
  });
});

describe("missed-sync-window refusedInLock / ownerFollowUpCc (work order 2026-10-14b fix 13)", () => {
  it("a refused press of the owner's ready cooldown inside the lock is stated, the lock still counts", () => {
    const [e] = missedSyncWindowEvents(
      [lock(110.635, 115.637, "Cyclone", MATE.name)],
      [cd("Volley", ME)] as any,
      probes("3v3", {
        ownerRefusedAt: (ids: readonly string[], from: number, to: number) =>
          ids.includes("Volley") && from <= 111.785 && 111.785 <= to
            ? [{ spellName: "Volley", tS: 111.785, why: "not ready yet" }]
            : [],
      }),
    );
    expect(e!.facts.refusedInLock).toBe("110: Volley +1.1s (not ready yet)");
  });

  it("the owner's own control right after the lock is stated apart, not chained", () => {
    const rows = missedSyncWindowEvents(
      [
        lock(101.409, 104.422, "Storm Bolt", MATE.name),
        lock(104.958, 105.77, "Blinding Sleet", ME.name),
      ],
      [cd("Army of the Dead", ME)] as any,
      probes("3v3"),
    );
    const first = rows.find((r) => r.facts.cc === "Storm Bolt")!;
    expect(first.facts.windowEndT).toBe("104");
    expect(first.facts.ownerFollowUpCc).toBe("Blinding Sleet +0.5s (1s)");
  });
});
