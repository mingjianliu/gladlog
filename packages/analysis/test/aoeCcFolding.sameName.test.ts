/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { prepareAoeCcFolding } from "../src/context/timelineSections/aoeCcFolding";
import { AOE_CC_LANDING_WINDOW_S } from "../src/utils/drAnalysis";

/** One Static Charge landing by `casterName` on `target` at `atSeconds`. */
function chain(casterName: string, target: string, atSeconds: number): any {
  return {
    targetName: target,
    targetSpec: "Unknown",
    applications: [
      {
        atSeconds,
        durationSeconds: 3,
        spellId: "118905",
        spellName: "Capacitor Totem",
        casterName,
        casterSpec: "Unknown",
        drInfo: { category: "Stun", level: "Full", sequenceIndex: 0 },
      },
    ],
  };
}

const LANDING = AOE_CC_LANDING_WINDOW_S["192058"]!;

function fold(ownerName: string, teammateName: string, chains: any[]) {
  // the roster keys both the full and the character name, as the prompt's
  // id map does; the later registration wins the shared character name
  const ids = new Map<string, number>();
  for (const [name, id] of [
    [ownerName, 1],
    [teammateName, 2],
  ] as const) {
    ids.set(name, id);
    ids.set(name.split("-")[0]!, id);
  }
  const pid = (name: string) =>
    String(ids.get(name) ?? ids.get(name.split("-")[0]!) ?? name);
  return prepareAoeCcFolding({
    outgoingCCChains: chains,
    owner: { name: ownerName } as any,
    pid,
    enemyPid: (n: string) => n,
  });
}

describe("AoE CC fold — a delayed landing belongs to the caster whose totem it was", () => {
  it("two same-named shamans from two realms: the owner's empty totem does not take the teammate's stun", () => {
    const owner = "Storm-RealmA-US";
    const mate = "Storm-RealmB-US";
    // owner casts at 10.0 and stuns nobody; the teammate casts at 10.1 and
    // the stun lands at 12.1 — inside both casts' landing windows
    const { findAndConsumeAoeCC } = fold(owner, mate, [
      chain(mate, "Enemy1-Realm-US", 12.1),
    ]);
    expect(
      findAndConsumeAoeCC(10.0, owner, "Capacitor Totem", true, LANDING),
    ).toBeUndefined();
    expect(
      findAndConsumeAoeCC(10.1, mate, "Capacitor Totem", false, LANDING)
        ?.targets,
    ).toEqual([{ name: "Enemy1-Realm-US", durationSeconds: 3 }]);
  });

  it("the same two, the other way round: the teammate's cast line does not take the owner's stun", () => {
    const owner = "Storm-RealmA-US";
    const mate = "Storm-RealmB-US";
    const { findAndConsumeAoeCC } = fold(owner, mate, [
      chain(owner, "Enemy1-Realm-US", 12.0),
    ]);
    expect(
      findAndConsumeAoeCC(10.1, mate, "Capacitor Totem", false, LANDING),
    ).toBeUndefined();
    expect(
      findAndConsumeAoeCC(10.0, owner, "Capacitor Totem", true, LANDING),
    ).toBeDefined();
  });

  it("a caster name without a realm still matches its full roster name", () => {
    const owner = "Storm-RealmA-US";
    const mate = "Tide-RealmB-US";
    const { findAndConsumeAoeCC } = fold(owner, mate, [
      chain("Tide", "Enemy1-Realm-US", 12.1),
    ]);
    expect(
      findAndConsumeAoeCC(10.0, owner, "Capacitor Totem", true, LANDING),
    ).toBeUndefined();
    expect(
      findAndConsumeAoeCC(10.1, mate, "Capacitor Totem", false, LANDING),
    ).toBeDefined();
  });
});
