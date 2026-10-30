/**
 * B-tier D11 B1 (user ruling 2026-10-07, variant B of the 605 scan):
 * cd-hoarded gains `otherAttempts` — a defensive that is NOT among the ready
 * ones, pressed inside the response window [t − 1.5, t + 5] and rejected as
 * not ready while the ledger says it was on its own cooldown. A fact: the
 * event is not waived. 14055cb2 @63: two Ice Barrier presses right after an
 * Ice Storm cast, Ice Barrier itself on cooldown.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const OWNER = { id: "o", name: "Mage-R" };
const MATE = { id: "m", name: "Ally-R" };

const point = (tSec: number): ICdHoardedCrisisSource["points"][number] => ({
  tSec,
  hpPct: 30,
  dmg2s: 0.3,
  attackers2s: 1,
  enemyBurst: false,
  inCC: false,
  dangerous: true,
});
const cd = (
  spellId: string,
  spellName: string,
  casts: number[] = [],
  cooldownSeconds = 300,
) => ({
  spellId,
  spellName,
  tag: "Defensive",
  cooldownSeconds,
  maxChargesDetected: 1,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  availableWindows: [],
  neverUsed: casts.length === 0,
});
const failed = (
  tSeconds: number,
  spellId: number,
  reason = "Not yet recovered",
  unitGuid = "o",
) => ({ tSeconds, unitGuid, spellId, spellName: String(spellId), reason });
const streams = (castFailed: ReturnType<typeof failed>[]) => ({
  available: true,
  manaSamples: [],
  castFailed,
});

const ICE_BLOCK = cd("45438", "Ice Block");
// pressed at 40 s, 25 s cooldown here: on cooldown at the 63 s crisis
const iceBarrier = (casts = [40]) => cd("11426", "Ice Barrier", casts, 25);
const run = (
  cds: ReturnType<typeof cd>[],
  castFailed: ReturnType<typeof failed>[],
  src = { crisisUnit: OWNER, own: true, points: [point(63)] },
) =>
  cdHoardedEvents([src], cds as never, OWNER, undefined, streams(castFailed));

describe("cd-hoarded otherAttempts (B1)", () => {
  it("a not-ready defensive pressed twice in the window, on its own cooldown: named with the count; the event stays", () => {
    const evts = run(
      [ICE_BLOCK, iceBarrier()],
      [failed(62.9, 11426), failed(63.1, 11426)],
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Ice Block");
    expect(evts[0]!.facts["otherAttempts"]).toBe("Ice Barrier ×2");
    // not an attempt at a READY cooldown: that fact is a different one
    expect(evts[0]!.facts["attempted"]).toBeUndefined();
  });

  it("outside the window [t − 1.5, t + 5], another unit's reject, or another reason: nothing", () => {
    const evts = run(
      [ICE_BLOCK, iceBarrier()],
      [
        failed(61.4, 11426),
        failed(68.1, 11426),
        failed(63, 11426, "Not yet recovered", "someone-else"),
        failed(63, 11426, "Out of range"),
      ],
    );
    expect(evts[0]!.facts["otherAttempts"]).toBeUndefined();
  });

  it("key repeats within 1.5 s after that spell's own cast are not another attempt; a later press is", () => {
    // cast at 61.4 — just before the response window (61.5–68), so the
    // crisis is still unanswered
    const repeats = run(
      [ICE_BLOCK, iceBarrier([61.4])],
      [failed(61.6, 11426), failed(62.8, 11426)],
    );
    expect(repeats).toHaveLength(1);
    expect(repeats[0]!.facts["otherAttempts"]).toBeUndefined();
    const later = run(
      [ICE_BLOCK, iceBarrier([61.4])],
      [failed(61.6, 11426), failed(63.0, 11426)],
    );
    expect(later[0]!.facts["otherAttempts"]).toBe("Ice Barrier");
  });

  it("the ledger must say it was on cooldown AT THE PRESS: a press after the cooldown came back is another cast's global cooldown, one just before it is still an attempt", () => {
    // Ice Barrier pressed at 39 s, 25 s cooldown → back at 64.0: not ready at
    // the 63 s crisis reading (so it is not among readyCds)
    const cds = [ICE_BLOCK, iceBarrier([39])];
    // 64.3: it had been back for 0.3 s — the reject is the GCD's, not this
    // cooldown's
    const after = run(cds, [failed(64.3, 11426)]);
    expect(after[0]!.facts["readyCds"]).toBe("Ice Block");
    expect(after[0]!.facts["otherAttempts"]).toBeUndefined();
    // 63.7: 0.3 s before it came back — a press into its own cooldown (the
    // availability probe's 0.5 s rendering slack must not hide it)
    const before = run(cds, [failed(63.7, 11426)]);
    expect(before[0]!.facts["otherAttempts"]).toBe("Ice Barrier");
  });

  it("a teammate's crisis: only a defensive that could have gone to them counts", () => {
    const mate = { crisisUnit: MATE, own: false, points: [point(63)] };
    const sac = cd("6940", "Blessing of Sacrifice", [], 120);
    const bop = cd("1022", "Blessing of Protection", [50], 300);
    const divineShield = cd("642", "Divine Shield", [50], 300);
    const evts = run(
      [sac, bop, divineShield],
      [failed(63.2, 1022), failed(63.3, 642)],
      mate,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["otherAttempts"]).toBe("Blessing of Protection");
  });

  it("without the raw stream the fact is absent", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: OWNER, own: true, points: [point(63)] }],
      [ICE_BLOCK, iceBarrier()] as never,
      OWNER,
    );
    expect(evts[0]!.facts["otherAttempts"]).toBeUndefined();
  });
});
