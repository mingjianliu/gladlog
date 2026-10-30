/**
 * L04 (user ruling 2026-10-11) — a missed-sync-window row says whose each
 * ready cooldown is: `X (yours)` for the log owner's, `X (Name-Realm's)` for
 * a teammate's. The holder is the unit `evaluateSyncWindow` read the
 * cooldown from.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  missedSyncWindowEvents,
  parseSyncReadyCdEntry,
  SYNC_READY_CD_YOURS,
  syncReadyCdEntry,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

// a fixed-team bracket: every row reaches the owner (L04 (c) narrows Solo
// Shuffle only — `syncOwnerPart.test.ts`)
const REF = {
  cellKey: "3v3",
  nEntered: 174,
  killEnteredPct: 18,
  nUnentered: 174,
  killUnenteredPct: 8,
};
const probes = (over: Record<string, unknown> = {}) =>
  ({
    enemyMinHpPctAt: () => 50,
    enemyDeathS: [],
    ref: REF,
    ...over,
  }) as any;
const lock = (from: number, to: number, spell: string) => ({
  fromSeconds: from,
  toSeconds: to,
  spellName: spell,
  spellId: spell,
  healerName: "H1",
});
const cd = (spell: string, owner?: { id: string; name: string }) => ({
  spellId: spell,
  spellName: spell,
  casts: [],
  cooldownSeconds: 60,
  neverUsed: true,
  ...(owner ? { owner } : {}),
});
const ME = { id: "Player-1", name: "Me-Realm-EU" };
const MATE = { id: "Player-2", name: "Glaivemeomg-Stormscale-EU" };
const MATE2 = { id: "Player-3", name: "Klamphugger-Auchindoun-EU" };

describe("syncReadyCdEntry / parseSyncReadyCdEntry", () => {
  it("the owner's reads (yours), a teammate's by the unit name, and both parse back", () => {
    expect(syncReadyCdEntry("The Hunt", ME.name, true)).toBe(
      `The Hunt (${SYNC_READY_CD_YOURS})`,
    );
    expect(syncReadyCdEntry("The Hunt", MATE.name, false)).toBe(
      "The Hunt (Glaivemeomg-Stormscale-EU's)",
    );
    expect(parseSyncReadyCdEntry("The Hunt (yours)")).toEqual({
      spell: "The Hunt",
      yours: true,
      holder: null,
    });
    expect(
      parseSyncReadyCdEntry("The Hunt (Glaivemeomg-Stormscale-EU's)"),
    ).toEqual({
      spell: "The Hunt",
      yours: false,
      holder: "Glaivemeomg-Stormscale-EU",
    });
  });

  it("a bare name states no holder; a name with its own brackets keeps them", () => {
    expect(syncReadyCdEntry("Zenith", undefined, false)).toBe("Zenith");
    expect(parseSyncReadyCdEntry("Zenith")).toEqual({
      spell: "Zenith",
      yours: false,
      holder: null,
    });
    expect(
      parseSyncReadyCdEntry(syncReadyCdEntry("Spell (Rank 2)", "A-B", false)),
    ).toEqual({ spell: "Spell (Rank 2)", yours: false, holder: "A-B" });
    // the serializer's no-break space inside a name does not hide the holder
    expect(
      parseSyncReadyCdEntry("Invoke Xuen,\u00a0the White Tiger (yours)"),
    ).toMatchObject({ yours: true });
  });
});

describe("missed-sync-window readyCds (L04)", () => {
  it("d7fbdf1a r5 @85 shape: a teammate's cooldown is named as that teammate's", () => {
    const [e] = missedSyncWindowEvents(
      [lock(85, 88, "Chaos Nova")],
      [cd("The Hunt", MATE)] as any,
      probes({ ownerId: ME.id, ownerName: ME.name }),
    );
    expect(e!.facts.readyCds).toBe("The Hunt (Glaivemeomg-Stormscale-EU's)");
  });

  it("the owner's own cooldown reads (yours) beside the teammates'", () => {
    const [e] = missedSyncWindowEvents(
      [lock(99, 102, "Dragon's Breath")],
      [
        cd("The Hunt", MATE),
        cd("Touch of the Magi", ME),
        cd("Arcane Surge", MATE2),
      ] as any,
      probes({ ownerId: ME.id, ownerName: ME.name }),
    );
    expect(e!.facts.readyCds).toBe(
      "The Hunt (Glaivemeomg-Stormscale-EU's)、Touch of the Magi (yours)、Arcane Surge (Klamphugger-Auchindoun-EU's)",
    );
    // every entry parses back to a holder
    for (const entry of e!.facts.readyCds!.split("、")) {
      const p = parseSyncReadyCdEntry(entry);
      expect(p.yours || p.holder !== null).toBe(true);
    }
  });

  it("two teammates holding the same cooldown are two entries with two holders", () => {
    const [e] = missedSyncWindowEvents(
      [lock(85, 88, "Chaos Nova")],
      [cd("The Hunt", MATE), cd("The Hunt", MATE2)] as any,
      probes({ ownerId: ME.id }),
    );
    expect(e!.facts.readyCds).toBe(
      "The Hunt (Glaivemeomg-Stormscale-EU's)、The Hunt (Klamphugger-Auchindoun-EU's)",
    );
  });

  it("without an owner id nobody is `yours`; without a holder unit the name stays bare", () => {
    const [named] = missedSyncWindowEvents(
      [lock(85, 88, "Chaos Nova")],
      [cd("Touch of the Magi", ME)] as any,
      probes(),
    );
    expect(named!.facts.readyCds).toBe("Touch of the Magi (Me-Realm-EU's)");
    const [bare] = missedSyncWindowEvents(
      [lock(85, 88, "Chaos Nova")],
      [cd("Zenith")] as any,
      probes({ ownerId: ME.id }),
    );
    expect(bare!.facts.readyCds).toBe("Zenith");
  });
});
