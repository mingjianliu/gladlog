/**
 * The delta state of the [RES] rows is what the rows PRINT (found on the
 * 605-file capture of B-tier B14b: the first [RES] row of 182 of 3,520
 * prompts was a delta row, and a row in the round's 6th second printed
 * second 5 — where the ledger reports nothing — while the delta state already
 * held every cooldown as ready).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../resourceSnapshot";
import type { DeferredSnapshot } from "./ctx";
import { resolveDeferredSnapshots } from "./resolveSnapshots";

const ledger = (
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: number[],
): any => ({
  spellId,
  spellName,
  tag: "Defensive",
  cooldownSeconds,
  maxChargesDetected: 1,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  availableWindows: [],
  neverUsed: casts.length === 0,
});

/** Resolve one [RES] request per time; returns the printed row ("" = none). */
function rows(
  casts: { ibf: number[]; ams: number[] },
  requests: Array<number | { t: number; forceFull: boolean }>,
): string[] {
  const entries = requests.map((r, id) => {
    const t = typeof r === "number" ? r : r.t;
    const snap: DeferredSnapshot = {
      type: "resource_snapshot",
      timeSeconds: t,
      forceFull: typeof r === "number" ? false : r.forceFull,
      bypassDebounce: true,
      id,
    };
    return {
      timeSeconds: t,
      lines: [snap] as Array<string | DeferredSnapshot>,
    };
  });
  resolveDeferredSnapshots({
    entries,
    teammateCDs: [],
    playerIdMap: undefined,
    matchStartMs: 1_000_000,
    owner: {
      id: "o",
      name: "Me-Realm",
      deathRecords: [],
      auraEvents: [],
      spellCastEvents: [],
      damageIn: [],
      advancedActions: [],
    },
    resOwnerCDs: [
      ledger("48792", "Icebound Fortitude", 120, casts.ibf),
      ledger("48707", "Anti-Magic Shell", 60, casts.ams),
      ledger("51052", "Anti-Magic Zone", 120, []),
    ],
    snapshotFn: buildResourceSnapshot,
    ownerSpec: "DeathKnight_Frost",
    ccTrinketSummaries: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    rosterSides: undefined,
    manaFallback: undefined,
    roundBounds: { startTime: 1_000_000, endTime: 1_200_000 },
  } as never);
  return entries.map((e) => (e.lines[0] as string | undefined) ?? "");
}

const rdy = (row: string) => row.split("  cd:")[0] ?? "";
const cd = (row: string) => row.split("  cd:")[1] ?? "";

describe("resolveDeferredSnapshots — the delta state is the printed row's", () => {
  it("a request in the round's 6th second with nothing pressed prints nothing, and the next row is the round's first FULL row", () => {
    const [first, second] = rows({ ibf: [], ams: [20] }, [5.7, 20]);
    expect(first).toBe("");
    expect(second).toContain("[RES] rdy:");
    expect(second).not.toContain("rdy:Δ");
    expect(rdy(second)).toContain("Icebound Fortitude");
    expect(rdy(second)).toContain("Anti-Magic Zone");
    expect(cd(second)).toContain("Anti-Magic Shell");
  });

  it("the same when that request asked for a full row (an [OFFENSIVE WINDOW] opening at 0:05)", () => {
    const [first, second] = rows({ ibf: [], ams: [20] }, [
      { t: 5.7, forceFull: true },
      20,
    ]);
    expect(first).toBe("");
    expect(second).not.toContain("rdy:Δ");
    expect(rdy(second)).toContain("Icebound Fortitude");
  });

  it("a press in the 6th second prints second 5 (only that press is on it); the next row ADDS what the ledger had not reported", () => {
    const [first, second] = rows({ ibf: [5.5], ams: [20] }, [5.5, 20]);
    // second 5: the press is spent, nothing else is reported yet
    expect(rdy(first)).toMatch(/rdy:—$/);
    expect(cd(first)).toContain("Icebound Fortitude");
    // the cooldown never pressed appears as newly ready — the reader had not
    // been told; the one pressed at 0:20 goes straight to `cd:`
    expect(second).toContain("rdy:Δ +Anti-Magic Zone");
    expect(second).not.toContain("-Anti-Magic Shell");
    expect(cd(second)).toContain("Anti-Magic Shell");
  });

  it("control: past the 6th second nothing changes — a full first row, then a delta against it", () => {
    const [first, second] = rows({ ibf: [7], ams: [20] }, [7.4, 20]);
    expect(first).not.toContain("rdy:Δ");
    expect(rdy(first)).toContain("Anti-Magic Shell");
    expect(cd(first)).toContain("Icebound Fortitude");
    expect(second).toContain("rdy:Δ -Anti-Magic Shell");
  });
});
