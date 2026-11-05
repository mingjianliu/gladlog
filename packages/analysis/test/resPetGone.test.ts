/**
 * GH #128 item 1 (D7, user 2026-10-24: a pet's abilities go with the pet):
 * a hunter's Master's Call / Roar of Sacrifice / Intimidation leave the [RES]
 * line while the hunter's pet is dead and not yet back — c5b55e06 r2 listed
 * Master's Call ready at 1:15–1:16 with the pet dead since 1:15.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildResourceSnapshot,
  computeOnCDDisplayNames,
  computeReadyNames,
} from "../src/context/resourceSnapshot";
import type { DeferredSnapshot } from "../src/context/timelineSections/ctx";
import { resolveDeferredSnapshots } from "../src/context/timelineSections/resolveSnapshots";
import { ensureAnalysisData } from "../src/data/ensure";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import { PET_COMMAND_SPELL_IDS } from "../src/utils/petPresence";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const cd = (spellId: string, spellName: string, casts: number[] = []) =>
  ({
    spellId,
    spellName,
    tag: "Utility",
    cooldownSeconds: 45,
    casts: casts.map((timeSeconds) => ({ timeSeconds })),
    availableWindows: [],
    neverUsed: casts.length === 0,
  }) as unknown as IMajorCooldownInfo;

const hunter = (casts: Array<{ spellId: string; s: number }> = []) =>
  makeUnit("H1", {
    spellCastEvents: casts.map((c) => ({
      spellId: c.spellId,
      timestamp: START + c.s * 1000,
    })) as ICombatUnit["spellCastEvents"],
  });
const pet = (id: string, seenS: number, diedS?: number) =>
  ({
    id,
    ownerId: "H1",
    spellCastEvents: [],
    auraEvents: [{ timestamp: START + seenS * 1000 }],
    deathRecords:
      diedS === undefined ? [] : [{ timestamp: START + diedS * 1000 }],
  }) as unknown as ICombatUnit;

const kit = [
  cd("272682", "Master's Call"),
  cd("19577", "Intimidation"),
  cd("53480", "Roar of Sacrifice"),
  cd("186265", "Aspect of the Turtle"),
];
const ready = (owner: ICombatUnit, units: ICombatUnit[], s: number) =>
  computeReadyNames(s, kit, [], {
    matchStartMs: START,
    ownerUnit: owner,
    allUnits: [owner, ...units],
  });

describe("[RES] — a pet-carried press leaves with the pet (GH #128)", () => {
  const A = "Pet-0-1-1-1-165189-0103F0B9FA";
  const B = "Pet-0-1-1-1-165189-0203F0B9FA";

  it("the three hunter presses are the set", () => {
    expect([...PET_COMMAND_SPELL_IDS].sort()).toEqual([
      "19577",
      "272682",
      "53480",
    ]);
  });

  it("pet alive: all ready; pet dead: only the hunter's own", () => {
    const owner = hunter();
    const units = [pet(A, 0, 75)];
    expect(ready(owner, units, 70)).toEqual([
      "Master's Call",
      "Intimidation",
      "Roar of Sacrifice",
      "Aspect of the Turtle",
    ]);
    expect(ready(owner, units, 76)).toEqual(["Aspect of the Turtle"]);
    // not printed as on cooldown either
    expect(
      computeOnCDDisplayNames(76, kit, [], {
        matchStartMs: START,
        ownerUnit: owner,
        allUnits: [owner, ...units],
      }),
    ).toEqual([]);
  });

  it("back from the Revive Pet cast, before the new pet's first row", () => {
    const owner = hunter([{ spellId: "982", s: 86 }]);
    const units = [pet(A, 0, 75), pet(B, 101)];
    expect(ready(owner, units, 85)).toEqual(["Aspect of the Turtle"]);
    expect(ready(owner, units, 87)).toEqual([
      "Master's Call",
      "Intimidation",
      "Roar of Sacrifice",
      "Aspect of the Turtle",
    ]);
  });

  it("no units handed in: the pet is there, as before", () => {
    const owner = hunter();
    expect(
      computeReadyNames(76, kit, [], { matchStartMs: START, ownerUnit: owner }),
    ).toHaveLength(4);
  });
});

/** the printed [RES] rows of an owner-only ledger, one request per time */
function resRows(
  owner: ICombatUnit,
  units: ICombatUnit[],
  ledger: IMajorCooldownInfo[],
  times: number[],
): string[] {
  const entries = times.map((t, id) => {
    const snap: DeferredSnapshot = {
      type: "resource_snapshot",
      timeSeconds: t,
      forceFull: false,
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
    matchStartMs: START,
    owner,
    resOwnerCDs: ledger,
    snapshotFn: buildResourceSnapshot,
    ownerSpec: "Hunter_Survival",
    ccTrinketSummaries: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    rosterSides: undefined,
    manaFallback: undefined,
    roundBounds: { startTime: START, endTime: START + 300_000 },
    _allUnits: [owner, ...units],
  } as never);
  return entries.map((e) => (e.lines[0] as string | undefined) ?? "");
}

// codex review: a dead holder's entries leave without `-X` because the death
// has its own row; a pet has none, so the row where the entries go is full
describe("[RES] — the row where a pet-carried entry leaves is full (GH #128)", () => {
  const A = "Pet-0-1-1-1-165189-0103F0B9FA";
  const B = "Pet-0-1-1-1-165189-0203F0B9FA";

  it("ready when the pet died: the next row is full and lacks it; the revive adds it back", () => {
    const owner = hunter([
      { spellId: "186265", s: 25 },
      { spellId: "982", s: 40 },
    ]);
    const ledger = [
      cd("272682", "Master's Call"),
      cd("186265", "Aspect of the Turtle", [25]),
    ];
    const [r10, r25, r45] = resRows(
      owner,
      [pet(A, 0, 20), pet(B, 50)],
      ledger,
      [10, 25, 45],
    );
    expect(r10).toContain("rdy:Master's Call");
    expect(r25).not.toContain("Δ");
    expect(r25).not.toContain("Master's Call");
    expect(r45).toContain("+Master's Call");
  });

  it("on cooldown when the pet died: the full row drops it; it is never owed back", () => {
    // codex's case: Master's Call pressed 0:10 (back 0:55), pet dead 0:20,
    // Turtle pressed 0:25 (back 1:10) — as a delta, the 0:25 row said only
    // `-Aspect of the Turtle` and the 1:12 row owed Master's Call's return
    const owner = hunter([
      { spellId: "272682", s: 10 },
      { spellId: "186265", s: 25 },
    ]);
    const ledger = [
      cd("272682", "Master's Call", [10]),
      cd("186265", "Aspect of the Turtle", [25]),
    ];
    const [r12, r25, r72] = resRows(
      owner,
      [pet(A, 0, 20)],
      ledger,
      [12, 25, 72],
    );
    expect(r12).toContain("Master's Call(");
    expect(r25).toContain("[RES] rdy:");
    expect(r25).not.toContain("Δ");
    expect(r25).not.toContain("Master's Call");
    expect(r72).toContain("+Aspect of the Turtle");
    expect(r72).not.toContain("Master's Call");
  });

  it("no pet change: rows stay deltas", () => {
    const owner = hunter([{ spellId: "186265", s: 25 }]);
    const ledger = [
      cd("272682", "Master's Call"),
      cd("186265", "Aspect of the Turtle", [25]),
    ];
    const [, r25] = resRows(owner, [pet(A, 0)], ledger, [10, 25]);
    expect(r25).toContain("rdy:Δ");
  });
});
