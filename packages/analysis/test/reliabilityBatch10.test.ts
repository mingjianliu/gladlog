/**
 * Reliability leftovers batch 10 (2026-09-26): position judgements need to
 * know who moved (round 2 F13 — 06bb, c540, 539f).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
} from "../src/utils/positionAnalysis";

const T0 = 1_000_000;
const END = T0 + 60_000;

function unit(
  id: string,
  name: string,
  spec: CombatUnitSpec,
  xAt: (s: number) => number,
): any {
  const advancedActions = [];
  for (let ms = 0; ms <= 60_000; ms += 500)
    advancedActions.push({
      timestamp: T0 + ms,
      logLine: { timestamp: T0 + ms },
      advanced: true,
      advancedActorCurrentHp: 50,
      advancedActorMaxHp: 100,
      advancedActorPositionX: xAt(ms / 1000),
      advancedActorPositionY: 0,
      advancedActorPowers: [],
    });
  return {
    id,
    name,
    spec,
    advancedActions,
    deathRecords: [],
    damageOut: [],
    damageIn: [],
  };
}

const burst = (from: number, to: number): any => ({
  fromSeconds: from,
  toSeconds: to,
  activeCDs: [],
  threatScore: 1,
  threatLabel: "High",
  dangerScore: 1,
  dangerLabel: "High",
  dampeningPct: 0,
  damageInWindow: 0,
  damageRatio: 0,
  healerCCed: false,
  mostPressuredTarget: {
    unitName: "Owner-R-US",
    startHpPct: 100,
    midHpPct: 50,
    endHpPct: 30,
  },
});

const run = (owner: any, enemies: any[], friends?: any[], extra = {}) =>
  computeOwnerPositionEvents({
    owner,
    enemies,
    combat: { startTime: T0, endTime: END },
    burstWindows: [burst(10, 20)],
    ownerCooldowns: [],
    isHealer: false,
    ownerIsMelee: false,
    ...(friends ? { friends } : {}),
    ...extra,
  });

describe("KITED needs the owner to have moved (F13 c540)", () => {
  it("an enemy walking away from a stationary owner is not a kite", () => {
    const owner = unit(
      "1",
      "Owner-R-US",
      CombatUnitSpec.Rogue_Subtlety,
      () => 0,
    );
    const enemy = unit(
      "2",
      "Pally-R-US",
      CombatUnitSpec.Paladin_Retribution,
      (t) => (t < 10 ? 5 : Math.min(25, 5 + (t - 10) * 3)),
    );
    expect(run(owner, [enemy]).filter((e) => e.type === "KITED")).toHaveLength(
      0,
    );
  });
  it("the owner running away still reads as KITED", () => {
    const owner = unit("1", "Owner-R-US", CombatUnitSpec.Rogue_Subtlety, (t) =>
      t < 10 ? 0 : -Math.min(20, (t - 10) * 3),
    );
    const enemy = unit(
      "2",
      "Pally-R-US",
      CombatUnitSpec.Paladin_Retribution,
      () => 5,
    );
    expect(run(owner, [enemy]).filter((e) => e.type === "KITED")).toHaveLength(
      1,
    );
  });
});

describe("STAYED IN states the owner's own displacement (F13 06bb)", () => {
  it("renders 'you moved N yd yourself' when a chaser kept up", () => {
    // owner walks 18 yd; the enemy follows 2 yd behind
    const owner = unit("1", "Owner-R-US", CombatUnitSpec.Paladin_Holy, (t) =>
      t < 10 ? 0 : Math.min(18, (t - 10) * 2),
    );
    const enemy = unit(
      "2",
      "Dk-R-US",
      CombatUnitSpec.DeathKnight_Unholy,
      (t) => (t < 10 ? 0 : Math.min(18, (t - 10) * 2)) - 2,
    );
    const events = run(owner, [enemy]);
    const stayed = events.filter((e) => e.type === "STAYED_IN");
    expect(stayed).toHaveLength(1);
    expect(stayed[0]!.ownerMovedYards).toBe(18);
    const text = formatPositionEventsForContext(events).join("\n");
    expect(text).toContain("you moved 18 yd yourself (span start→end)");
    expect(text).toContain("says nothing about whether you moved");
  });
});

describe("HEALER TRAINED needs a free camper hitting the healer (F13 539f)", () => {
  const healer = () =>
    unit("1", "Healer-R-US", CombatUnitSpec.Evoker_Preservation, () => 0);
  const dh = () =>
    unit("3", "Dh-R-US", CombatUnitSpec.DemonHunter_Havoc, () => 6);
  const rogue = (hits: Array<[string, number]>) => {
    const u = unit(
      "2",
      "Rogue-R-US",
      CombatUnitSpec.Rogue_Assassination,
      () => 3,
    );
    u.damageOut = [];
    for (let s = 0; s < 60; s++)
      for (const [dest, amt] of hits)
        u.damageOut.push({
          timestamp: T0 + s * 1000,
          destUnitId: dest,
          amount: -amt,
          effectiveAmount: -amt,
        });
    return u;
  };
  const trained = (r: any, extra = {}) => {
    const h = healer();
    return computeOwnerPositionEvents({
      owner: h,
      enemies: [r],
      combat: { startTime: T0, endTime: END },
      burstWindows: [],
      ownerCooldowns: [],
      isHealer: true,
      ownerIsMelee: false,
      friends: [h, dh()],
      ...extra,
    }).filter((e) => e.type === "HEALER_TRAINED");
  };
  it("the healer as the camper's main target → trained", () => {
    expect(
      trained(
        rogue([
          ["1", 1000],
          ["3", 200],
        ]),
      ),
    ).toHaveLength(1);
  });
  it("proximity while hitting someone else harder → not trained", () => {
    expect(
      trained(
        rogue([
          ["1", 200],
          ["3", 1000],
        ]),
      ),
    ).toHaveLength(0);
  });
  it("a camper held in our CC does not camp", () => {
    const ev = trained(rogue([["1", 1000]]), {
      enemyCCSummaries: [
        {
          playerName: "Rogue-R-US",
          ccInstances: [{ atSeconds: 0, durationSeconds: 60 }],
        },
      ],
    });
    expect(ev).toHaveLength(0);
  });
});

describe("damage-source labels name a summon through its owner (round 3, f4da)", () => {
  it("a guardian reads '<owner id>'s guardian', a pet '<owner id>'s pet', unresolved stays [pet]", async () => {
    const { buildSummonOwnerNames, damageEventLabel } = await import(
      "../src/context/timelineHelpers"
    );
    const units: any[] = [
      { id: "Player-1", name: "Lock-R-US" },
      { id: "Creature-imp", name: "小鬼领主", ownerId: "Player-1" },
      { id: "Pet-fg", name: "Felguard", ownerId: "Player-1" },
    ];
    const owners = buildSummonOwnerNames(units);
    const enemyIds = new Map([["Lock-R-US", 5]]);
    const hit = (srcUnitId: string, flags: number): any => ({
      srcUnitId,
      srcUnitName: "x",
      srcUnitFlags: flags,
      spellId: "",
      spellName: "Greater Felbolt",
    });
    // 0x2000 guardian / 0x1000 pet, 0x40 hostile
    expect(damageEventLabel(hit("Creature-imp", 0x2048), undefined, enemyIds, owners)).toMatch(/^5's guardian — /);
    expect(damageEventLabel(hit("Pet-fg", 0x1048), undefined, enemyIds, owners)).toMatch(/^5's pet — /);
    expect(damageEventLabel(hit("Creature-other", 0x2048), undefined, enemyIds, owners)).toMatch(/^\[pet\] — /);
  });
});

describe("codex review 2026-09-26 counterexamples (batch 10)", () => {
  it("a nearer melee hitting someone else does not hide the one training the healer", () => {
    const h = unit("h", "Healer-R-US", CombatUnitSpec.Paladin_Holy, () => 0);
    const f = unit("f", "Friend-R-US", CombatUnitSpec.DemonHunter_Havoc, () => 2);
    const rogue = unit("a", "Rogue-R-US", CombatUnitSpec.Rogue_Assassination, () => 2);
    const warrior = unit("b", "Warrior-R-US", CombatUnitSpec.Warrior_Arms, () => 3);
    for (let t = 0; t < 60; t++) {
      rogue.damageOut.push({ timestamp: T0 + t * 1000, destUnitId: "h", amount: -100, effectiveAmount: -100 });
      rogue.damageOut.push({ timestamp: T0 + t * 1000, destUnitId: "f", amount: -1000, effectiveAmount: -1000 });
      warrior.damageOut.push({ timestamp: T0 + t * 1000, destUnitId: "h", amount: -1000, effectiveAmount: -1000 });
    }
    const ev = computeOwnerPositionEvents({
      owner: h,
      enemies: [rogue, warrior],
      combat: { startTime: T0, endTime: END },
      burstWindows: [],
      ownerCooldowns: [],
      isHealer: true,
      ownerIsMelee: false,
      friends: [h, f],
    }).filter((e) => e.type === "HEALER_TRAINED");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.nearestEnemyName).toBe("Warrior-R-US");
  });

  it("a short name both rosters share does not pick the friendly id for an enemy's summon", async () => {
    const { buildSummonOwnerNames, damageEventLabel } = await import("../src/context/timelineHelpers");
    const friends = new Map([["Alex-Friendly-US", 1], ["Alex", 1]]);
    const enemies = new Map([["Alex-Enemy-US", 5], ["Alex", 5]]);
    const owners = buildSummonOwnerNames([
      { id: "enemy", name: "Alex-Enemy-US" },
      { id: "pet", name: "Imp", ownerId: "enemy" },
    ] as any);
    const label = damageEventLabel(
      { srcUnitId: "pet", srcUnitName: "Imp", srcUnitFlags: 0x2048, spellId: "", spellName: "Greater Felbolt" } as any,
      friends,
      enemies,
      owners,
    );
    expect(label.startsWith("5's guardian")).toBe(true);
  });
});
