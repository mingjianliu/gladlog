/**
 * B-tier D6 (user rulings 2026-10-06) — three FACTS on existing accusations;
 * none changes a verdict or a reference number:
 *  - B2-① missed-sync-window `enteredNextLock`: a ready CD whose first press
 *    after the lock entered the NEXT healer lock (fe1a9355 @94: Kingsbane,
 *    unpressed through the Seduction, went into the Fear lock that followed);
 *  - B11b missed-sync-window `setupBy`: the lock was the player's own control
 *    (b12bfef4 @109: the owner's Terror of the Skies opened the chain);
 *  - B2-② cd-hoarded `ownBurstPressed`: the player's own offensive cooldowns
 *    pressed in the 2 s before the crisis reading (537209d8 @29).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
  mergeHealerCcWindows,
  missedSyncWindowEvents,
  OWN_BURST_LEAD_S,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const REF = {
  cellKey: "3v3",
  nEntered: 174,
  killEnteredPct: 18,
  nUnentered: 174,
  killUnenteredPct: 8,
};
const probes = (over: Record<string, unknown> = {}) =>
  ({ enemyMinHpPctAt: () => 50, enemyDeathS: [], ref: REF, ...over }) as any;
const lock = (
  from: number,
  to: number,
  spell: string,
  casterName?: string,
) => ({
  fromSeconds: from,
  toSeconds: to,
  spellName: spell,
  spellId: spell,
  healerName: "H1",
  ...(casterName ? { casterName } : {}),
});
const offensive = (spellName: string, casts: number[]) => ({
  spellId: spellName,
  spellName,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  cooldownSeconds: 60,
  neverUsed: casts.length === 0,
});

describe("missed-sync-window enteredNextLock (B2-①)", () => {
  it("names the ready CD whose first press after the lock landed inside the next healer lock", () => {
    const out = missedSyncWindowEvents(
      [lock(94.2, 100.4, "Seduction"), lock(104.3, 107.9, "Fear")],
      [offensive("Kingsbane", [106.5])],
      probes(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.t).toBe(94);
    expect(out[0]!.facts["enteredNextLock"]).toBe(
      "Kingsbane at 106 in the 104–107 lock (Fear)",
    );
  });

  it("is absent when the first press after the lock misses the next lock — the verdict's own entered test, lead included", () => {
    // 3.1 s before the next lock: outside SYNC_ENTER_LEAD_S, and with no
    // owner there is no buff span to carry it in
    const missed = missedSyncWindowEvents(
      [lock(94, 100, "Seduction"), lock(110, 114, "Fear")],
      [offensive("Kingsbane", [106.9])],
      probes(),
    );
    expect(missed[0]!.facts["enteredNextLock"]).toBeUndefined();
    // 1.9 s before it: the lead the verdict accepts
    const lead = missedSyncWindowEvents(
      [lock(94, 100, "Seduction"), lock(110, 114, "Fear")],
      [offensive("Kingsbane", [108.1])],
      probes(),
    );
    expect(lead[0]!.facts["enteredNextLock"]).toBe(
      "Kingsbane at 108 in the 110–114 lock (Fear)",
    );
  });

  it("reads only the FIRST press after the lock: a later press inside the next lock does not count", () => {
    const out = missedSyncWindowEvents(
      [lock(94, 100, "Seduction"), lock(170, 176, "Fear")],
      // pressed at 120 into nothing, again at 172 inside the next lock
      [{ ...offensive("Kingsbane", [120, 172]), cooldownSeconds: 45 }],
      probes(),
    );
    expect(out[0]!.t).toBe(94);
    expect(out[0]!.facts["enteredNextLock"]).toBeUndefined();
  });

  it("drops a next lock, or a press, after the playable end", () => {
    const args = [
      [lock(94, 100, "Seduction"), lock(104, 108, "Fear")],
      [offensive("Kingsbane", [106])],
    ] as const;
    const lockAfter = missedSyncWindowEvents(
      [...args[0]],
      [...args[1]],
      probes({ playableEndS: 103 }),
    );
    expect(lockAfter[0]!.facts["enteredNextLock"]).toBeUndefined();
    const pressAfter = missedSyncWindowEvents(
      [...args[0]],
      [...args[1]],
      probes({ playableEndS: 105 }),
    );
    expect(pressAfter[0]!.facts["enteredNextLock"]).toBeUndefined();
    const inRound = missedSyncWindowEvents(
      [...args[0]],
      [...args[1]],
      probes({ playableEndS: 106.5 }),
    );
    expect(inRound[0]!.facts["enteredNextLock"]).toBeDefined();
  });

  it("does not change which locks are accused", () => {
    const locks = [lock(94, 100, "Seduction"), lock(104, 108, "Fear")];
    const cds = [offensive("Kingsbane", [106])];
    const ids = missedSyncWindowEvents(locks, cds, probes()).map((e) => e.id);
    // the second lock was entered, so only the first is on the menu
    expect(ids).toEqual(["missed-sync-window:H1:Seduction:94"]);
  });
});

describe("missed-sync-window setupBy (B11b)", () => {
  const cds = [offensive("Shadow Blades", [])];
  it("says 'you' when the owner cast the whole lock", () => {
    const out = missedSyncWindowEvents(
      [lock(100, 106, "Freezing Trap", "Owner-R")],
      cds,
      probes({ ownerName: "Owner-R" }),
    );
    expect(out[0]!.facts["setupBy"]).toBe("you");
  });

  it("names the owner's part of a chain shared with a teammate (b12bfef4 @109)", () => {
    const out = missedSyncWindowEvents(
      [
        lock(109.1, 112, "Terror of the Skies", "Owner-R"),
        lock(111, 116.2, "Polymorph", "Mage-R"),
      ],
      cds,
      probes({ ownerName: "Owner-R" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.facts["cc"]).toBe("Terror of the Skies→Polymorph");
    expect(out[0]!.facts["setupBy"]).toBe("you (Terror of the Skies)");
  });

  it("is absent for a teammate's lock, and without an owner name", () => {
    const mates = missedSyncWindowEvents(
      [lock(100, 106, "Polymorph", "Mage-R")],
      cds,
      probes({ ownerName: "Owner-R" }),
    );
    expect(mates[0]!.facts["setupBy"]).toBeUndefined();
    const noOwner = missedSyncWindowEvents(
      [lock(100, 106, "Polymorph", "Owner-R")],
      cds,
      probes(),
    );
    expect(noOwner[0]!.facts["setupBy"]).toBeUndefined();
  });

  it("mergeHealerCcWindows keeps every component's caster, repeats included", () => {
    const [m] = mergeHealerCcWindows([
      lock(10, 14, "Polymorph", "Mage-R"),
      lock(13, 16, "Sleep Walk", "Owner-R"),
      lock(15, 19, "Polymorph", "Mage-R"),
    ]);
    expect(m!.componentCasters).toEqual([
      { spellName: "Polymorph", casterName: "Mage-R" },
      { spellName: "Sleep Walk", casterName: "Owner-R" },
      { spellName: "Polymorph", casterName: "Mage-R" },
    ]);
  });
});

describe("cd-hoarded ownBurstPressed (B2-②)", () => {
  const OWNER = { id: "o", name: "Owner-R" };
  const point = (tSec: number): ICdHoardedCrisisSource["points"][number] => ({
    tSec,
    hpPct: 37,
    dmg2s: 0.3,
    attackers2s: 1,
    enemyBurst: false,
    inCC: false,
    dangerous: true,
  });
  const own = (tSec: number) => ({
    crisisUnit: OWNER,
    own: true,
    points: [point(tSec)],
  });
  const dispersion = {
    spellId: "47585",
    spellName: "Dispersion",
    tag: "Defensive",
    cooldownSeconds: 120,
    casts: [] as { timeSeconds: number }[],
    neverUsed: true,
  };
  // Power Infusion 10060 and Voidform 228260 are in the canonical offensive table
  const burst = (spellId: string, spellName: string, at: number[]) => ({
    spellId,
    spellName,
    tag: "Offensive",
    cooldownSeconds: 120,
    casts: at.map((timeSeconds) => ({ timeSeconds })),
    neverUsed: at.length === 0,
  });

  it("lists the owner's offensive presses in the 2 s before the reading, each with how long before it — never an offset from facts.t (a press at 29.1 before a 29.3 reading is not '+0.1s')", () => {
    const evts = cdHoardedEvents(
      [own(29.3)],
      [
        dispersion,
        burst("10060", "Power Infusion", [27.8]),
        burst("228260", "Voidform", [28.9]),
      ],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Dispersion");
    expect(evts[0]!.facts["ownBurstPressed"]).toBe(
      "Power Infusion 1.5s before; Voidform 0.4s before",
    );
  });

  it("is bounded by OWN_BURST_LEAD_S on raw instants, and ignores presses after the reading", () => {
    expect(OWN_BURST_LEAD_S).toBe(2);
    const evts = cdHoardedEvents(
      [own(29.3)],
      [
        dispersion,
        // 2.1 s before, and 0.4 s after
        burst("10060", "Power Infusion", [27.2]),
        burst("228260", "Voidform", [29.7]),
      ],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["ownBurstPressed"]).toBeUndefined();
  });

  it("reads only the canonical offensive table — a control cooldown pressed inside the 2 s is not a burst", () => {
    const evts = cdHoardedEvents(
      [own(29.3)],
      [
        dispersion,
        {
          spellId: "8122",
          spellName: "Psychic Scream",
          tag: "Control",
          cooldownSeconds: 30,
          // inside the 2 s window: only the table can keep it out
          casts: [{ timeSeconds: 28.5 }],
          neverUsed: false,
        },
      ],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["ownBurstPressed"]).toBeUndefined();
  });

  it("a press in the reading's own second, before the reading, says 'before' — never a positive offset from facts.t", () => {
    // the reading at 29.8 renders t = 29; the press at 29.3 is 0.5 s before it
    const evts = cdHoardedEvents(
      [own(29.8)],
      [dispersion, burst("228260", "Voidform", [29.3])],
      OWNER,
    );
    expect(evts[0]!.facts["t"]).toBe("29");
    expect(evts[0]!.facts["ownBurstPressed"]).toBe("Voidform 0.5s before");
  });
});
