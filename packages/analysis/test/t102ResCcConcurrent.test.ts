/**
 * T102 (fact13 D4 / D6): concurrent controls of one kind on a unit were
 * collapsed to one `[RES] cc:` entry. The kick slot kept the first active
 * lockout, and the root and disarm slots did the same. 16a56b26 r0 1:40:
 * `cc:1/Counter Shot-<1s[kick]` while a Rebuke on Nature held 2.2 s more.
 * Now every active lockout is listed (each locks its own school), and a
 * root or disarm names the one that holds longest, as hard CC already did.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";

const START = 1_000_000;

function snapshotAt(t: number, summary: Record<string, unknown>): string {
  return buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Devastation Evoker",
    teammateCDs: [],
    ccTrinketSummaries: [
      {
        playerName: "Owner",
        ccInstances: [],
        trinketUseTimes: [],
        rootInstances: [],
        disarmInstances: [],
        interruptInstances: [],
        ...summary,
      },
    ],
    enemyCDTimeline: { players: [] },
    playerIdMap: new Map([["Owner", 1]]),
    matchStartMs: START,
  } as never);
}

const kick = (
  atSeconds: number,
  lockoutDurationSeconds: number,
  kickSpellName: string,
) => ({
  atSeconds,
  lockoutDurationSeconds,
  kickSpellName,
});
const held = (
  atSeconds: number,
  durationSeconds: number,
  spellName: string,
) => ({
  atSeconds,
  durationSeconds,
  spellName,
  spellId: "0",
});

describe("[RES] cc: concurrent controls of one kind (T102)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("lists every active kick lockout, not the first found (D4: 16a56b26 1:40)", () => {
    const line = snapshotAt(100, {
      interruptInstances: [
        kick(97.43, 3, "Counter Shot"),
        kick(99.18, 3, "Rebuke"),
      ],
    });
    expect(line).toContain("cc:1/Counter Shot-<1s[kick],1/Rebuke-2s[kick]");
  });

  it("a lockout that has run out is not listed", () => {
    const line = snapshotAt(101, {
      interruptInstances: [
        kick(97.43, 3, "Counter Shot"),
        kick(99.18, 3, "Rebuke"),
      ],
    });
    expect(line).toContain("cc:1/Rebuke-");
    expect(line).not.toContain("Counter Shot");
  });

  it("a root and a disarm name the one that holds longest, whatever was found first", () => {
    const line = snapshotAt(10, {
      rootInstances: [held(8, 3, "Frost Nova"), held(9, 6, "Entangling Roots")],
      disarmInstances: [
        held(9.5, 1, "Grapple Weapon"),
        held(7, 5, "Dismantle"),
      ],
    });
    expect(line).toContain("1/Entangling Roots-5s[root]");
    expect(line).not.toContain("Frost Nova");
    expect(line).toContain("1/Dismantle-2s[disarm]");
    expect(line).not.toContain("Grapple Weapon");
  });
});
