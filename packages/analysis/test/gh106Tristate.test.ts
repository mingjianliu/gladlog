/**
 * GH #106 step 3 — tri-state readiness for cooldowns combat shortens:
 * certainly ready (static cooldown elapsed) / maybe ready (past the corpus
 * floor) / certainly on cooldown.
 */
import { describe, expect, it } from "vitest";

import {
  buildResourceSnapshot,
  computeOnCDDisplayNames,
  computeReadyNames,
} from "../src/context/resourceSnapshot";
import CD_RECAST_FLOORS from "../src/data/cdRecastFloorGenerated.json";
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  earliestCooldownSecondsFor,
  type IMajorCooldownInfo,
} from "../src/utils/cooldowns";

const avatar = {
  casts: [{ timeSeconds: 10 }],
  cooldownSeconds: 90,
  earliestCooldownSeconds: 60,
  neverUsed: false,
  charges: 1,
};

describe("cdMaybeAvailableAt", () => {
  it("before the floor: certainly on cooldown", () => {
    expect(cdAvailableAt(avatar, 50)).toBe(false);
    expect(cdMaybeAvailableAt(avatar, 50)).toBe(false);
  });
  it("between the floor and the static cooldown: maybe", () => {
    expect(cdAvailableAt(avatar, 80)).toBe(false);
    expect(cdMaybeAvailableAt(avatar, 80)).toBe(true);
  });
  it("past the static cooldown: certainly ready, not 'maybe'", () => {
    expect(cdAvailableAt(avatar, 100)).toBe(true);
    expect(cdMaybeAvailableAt(avatar, 100)).toBe(false);
  });
  it("no floor measured: never 'maybe'", () => {
    const { earliestCooldownSeconds: _, ...plain } = avatar;
    void _;
    expect(cdMaybeAvailableAt(plain, 80)).toBe(false);
  });
  it("proc-only: neither", () => {
    expect(cdMaybeAvailableAt({ ...avatar, isProcOnly: true }, 80)).toBe(false);
  });
});

describe("cdRecastFloorGenerated.json", () => {
  const floors = CD_RECAST_FLOORS.floors as Record<
    string,
    {
      floorRatio: number;
      staticBreak: number;
      holdoutStaticBreak: number;
      nTrain: number;
      nHoldout: number;
      holdoutBelow: number;
    }
  >;
  it("every floor is a real shortening that the hold-out half upheld", () => {
    for (const [key, f] of Object.entries(floors)) {
      expect(f.floorRatio, key).toBeGreaterThan(0);
      expect(f.floorRatio, key).toBeLessThan(0.99);
      // ≥ 1 % of recasts beat the static model on BOTH halves — one
      // mislogged press cannot open a range on a cooldown the model gets right
      expect(f.staticBreak, key).toBeGreaterThanOrEqual(0.01);
      expect(f.holdoutStaticBreak, key).toBeGreaterThanOrEqual(0.01);
      expect(f.nTrain, key).toBeGreaterThanOrEqual(50);
      expect(f.nHoldout, key).toBeGreaterThanOrEqual(50);
      expect(f.holdoutBelow, key).toBeLessThanOrEqual(0.03);
    }
  });
  it("earliestCooldownSecondsFor scales the unit's own modelled cooldown", () => {
    const [key, f] = Object.entries(floors)[0] ?? [];
    if (!key || !f) return; // empty table: nothing to scale
    const [spellId, spec] = key.split("|");
    expect(earliestCooldownSecondsFor(spellId!, spec!, 100)).toBeCloseTo(
      100 * f.floorRatio,
      0,
    );
    expect(earliestCooldownSecondsFor("0", "0", 100)).toBeUndefined();
  });
});


describe("[RES] rendering of the three states", () => {
  const cd = (over: Partial<IMajorCooldownInfo>): IMajorCooldownInfo =>
    ({
      spellId: "107574",
      spellName: "Avatar",
      tag: "Offensive",
      cooldownSeconds: 90,
      maxChargesDetected: 1,
      charges: 1,
      casts: [{ timeSeconds: 10 }],
      availableWindows: [],
      neverUsed: false,
      isThroughput: true,
      ...over,
    }) as IMajorCooldownInfo;
  const res = (cds: IMajorCooldownInfo[], t: number) =>
    buildResourceSnapshot({
      timeSeconds: t,
      ownerCDs: cds,
      ownerName: "Owner",
      ownerSpec: "Arms Warrior",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    });

  it("before the floor: a range, certainly still down", () => {
    // cast 10, floor 60 → back no sooner than 70; static 90 → at t=30: 40–70 s
    expect(res([cd({ earliestCooldownSeconds: 60 })], 30)).toContain(
      "cd:Avatar(40–70s)",
    );
  });
  it("past the floor: at most N s, maybe back", () => {
    expect(res([cd({ earliestCooldownSeconds: 60 })], 80)).toContain(
      "cd:Avatar(≤20s)",
    );
  });
  it("past the static cooldown: ready", () => {
    expect(res([cd({ earliestCooldownSeconds: 60 })], 100)).toContain(
      "rdy:Avatar",
    );
  });
  it("no floor: the exact seconds, as before", () => {
    expect(res([cd({})], 30)).toContain("cd:Avatar(70s)");
  });
  it("a per-cast override never renders a range (Guardian Angel's saved branch)", () => {
    const gs = cd({
      earliestCooldownSeconds: 20,
      casts: [{ timeSeconds: 10, cooldownSecondsOverride: 60 }],
    });
    expect(cdMaybeAvailableAt(gs, 40)).toBe(false);
    expect(res([gs], 40)).toContain("cd:Avatar(30s)");
  });
});

describe("cdSecondsUntilReady with charges (sequential recharge)", () => {
  it("counts to the NEXT charge, not the oldest cast", () => {
    // 2 charges / 20 s, casts at 0 and 5: the timer started at 0 → first
    // charge back at 20, second at 40. At t=10 both are spent: 10 s to go.
    const c = {
      casts: [{ timeSeconds: 0 }, { timeSeconds: 5 }],
      cooldownSeconds: 20,
      charges: 2,
      neverUsed: false,
    };
    expect(cdAvailableAt(c, 10)).toBe(false);
    expect(cdSecondsUntilReady(c, 10)).toBe(10);
    expect(cdSecondsUntilReady(c, 25)).toBe(0);
  });
});

describe("codex astra review of GH #106 step 3", () => {
  const base = {
    spellName: "Avatar",
    tag: "Offensive",
    maxChargesDetected: 1,
    availableWindows: [],
    neverUsed: false,
    isThroughput: true,
  };
  const snap = (
    cds: IMajorCooldownInfo[],
    t: number,
    prev?: { ready: string[]; onCd: string[] },
  ) =>
    buildResourceSnapshot({
      timeSeconds: t,
      ownerCDs: cds,
      ownerName: "Owner",
      ownerSpec: "Arms Warrior",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ...(prev ? { prevReadyNames: prev.ready, prevOnCDNames: prev.onCd } : {}),
    });

  it("a recast while 'maybe ready' is printed again in delta mode", () => {
    const at140 = {
      ...base,
      spellId: "107574",
      cooldownSeconds: 90,
      earliestCooldownSeconds: 67,
      charges: 1,
      casts: [{ timeSeconds: 10 }, { timeSeconds: 80 }],
    } as IMajorCooldownInfo;
    const prev = {
      ready: computeReadyNames(140, [at140], []),
      onCd: computeOnCDDisplayNames(140, [at140], []),
    };
    const at150 = {
      ...at140,
      casts: [...at140.casts, { timeSeconds: 150 }],
    } as IMajorCooldownInfo;
    expect(snap([at150], 150, prev)).toContain("cd:Avatar(67–90s)");
  });

  it("charges are a range when the cooldown may already be back", () => {
    const iceBarrier = {
      ...base,
      spellId: "11426",
      spellName: "Ice Barrier",
      tag: "Defensive",
      isThroughput: false,
      cooldownSeconds: 30,
      earliestCooldownSeconds: 25,
      charges: 2,
      casts: [{ timeSeconds: 10 }, { timeSeconds: 15 }],
    } as IMajorCooldownInfo;
    const line = snap([iceBarrier], 36);
    expect(line).toContain("Ice Barrier(≤4s)[0–1/2]");
    expect(line).not.toContain("[0/2]");
  });
});
