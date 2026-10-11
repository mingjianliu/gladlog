/**
 * F06a — one formatter for a control's length. A missed-sync-window row's
 * `durationS` goes through the control lines' formatter
 * (`renderedCcDuration`), and the row's numbers stop at the round's end, as
 * the `[CC ON ENEMY]` line of that lock does.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  missedSyncWindowEvents,
  SYNC_LOCK_ENDED_BY_ROUND_END,
  syncLockLengthFacts,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  renderedCcDuration,
  renderedCcSpan,
} from "../src/utils/ccTrinketAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

const REF = {
  cellKey: "Rated Solo Shuffle",
  nEntered: 174,
  killEnteredPct: 18,
  nUnentered: 174,
  killUnenteredPct: 8,
};
const hpSpans: Array<[number, number]> = [];
const probes = (over: Record<string, unknown> = {}) =>
  ({
    enemyMinHpPctAt: (from: number, to: number) => {
      hpSpans.push([from, to]);
      return 50;
    },
    enemyDeathS: [],
    ref: REF,
    ...over,
  }) as any;
const lock = (from: number, to: number, spell: string, endedBy?: any) => ({
  fromSeconds: from,
  toSeconds: to,
  spellName: spell,
  spellId: spell,
  healerName: "H1",
  ...(endedBy ? { endedBy } : {}),
});
const ready = [
  {
    spellId: "Zenith",
    spellName: "Zenith",
    casts: [],
    cooldownSeconds: 60,
    neverUsed: true,
  },
];

describe("syncLockLengthFacts", () => {
  it("durationS is the control line's number, not the floored endpoints' difference", () => {
    // s0/135-5-802: Hammer of Justice 94.9 → 99.3 read durationS=5 beside
    // `1:34 [CC ON ENEMY] … (4s)`
    const w = { fromSeconds: 94.9, toSeconds: 99.3 };
    expect(syncLockLengthFacts(w, undefined)).toEqual({
      endSeconds: 99.3,
      cutByRoundEnd: false,
      windowEndT: "99",
      durationS: "4",
    });
    expect(`${syncLockLengthFacts(w, undefined).durationS}s`).toBe(
      renderedCcDuration({ durationSeconds: 99.3 - 94.9 }),
    );
    // … and the other way: 120.1 → 124.9 read 4 beside `(5s)`
    expect(
      syncLockLengthFacts({ fromSeconds: 120.1, toSeconds: 124.9 }, 200)
        .durationS,
    ).toBe("5");
  });

  it("a lock the round ended on stops there — the length its line prints behind the round-end label", () => {
    // s1/132-5-722: Kidney Shot 183.9 → 188.6, the round ended at 185.1
    const cut = syncLockLengthFacts(
      { fromSeconds: 183.9, toSeconds: 188.6 },
      185.1,
    );
    expect(cut).toMatchObject({
      cutByRoundEnd: true,
      windowEndT: "185",
      durationS: "1",
    });
    expect(
      renderedCcSpan({
        durationSeconds: cut.endSeconds - 183.9,
        stillOnAtRoundEnd: true,
      }),
    ).toBe(`still on them when the round ended, ${cut.durationS}s in`);
    // under half a second: `<1`, the control lines' own text
    expect(
      syncLockLengthFacts({ fromSeconds: 144.8, toSeconds: 149.9 }, 145.1)
        .durationS,
    ).toBe("<1");
    // ended in the round-ending ms itself: it ended, the round did not cut it
    expect(
      syncLockLengthFacts({ fromSeconds: 100, toSeconds: 104 }, 104)
        .cutByRoundEnd,
    ).toBe(false);
  });
});

describe("missed-sync-window row (F06a)", () => {
  it("prints the formatter's durationS and the grid's endpoints", () => {
    const [e] = missedSyncWindowEvents(
      [lock(94.9, 99.3, "Hammer of Justice")],
      ready,
      probes(),
    );
    expect(e!.facts).toMatchObject({
      t: "94",
      windowEndT: "99",
      durationS: "4",
    });
    expect(e!.facts["endedBy"]).toBeUndefined();
  });

  it("with the round's end inside the lock: windowEndT, durationS and the HP reading stop there, endedBy says so — and the row is still the same row", () => {
    hpSpans.length = 0;
    const broke = { kind: "trinket", spellName: "Gladiator's Medallion" };
    const uncut = missedSyncWindowEvents(
      [lock(94.9, 99.3, "Hammer of Justice", broke)],
      ready,
      probes(),
    );
    const cut = missedSyncWindowEvents(
      [lock(94.9, 99.3, "Hammer of Justice", broke)],
      ready,
      probes({ roundEndS: 96.2 }),
    );
    expect(cut.map((e) => e.id)).toEqual(uncut.map((e) => e.id));
    expect(uncut[0]!.facts["endedBy"]).toBe("trinket (Gladiator's Medallion)");
    expect(cut[0]!.facts).toMatchObject({
      t: "94",
      windowEndT: "96",
      durationS: "1",
      endedBy: SYNC_LOCK_ENDED_BY_ROUND_END,
    });
    // the accelerator HP is read over the lock up to the round's end
    expect(hpSpans).toEqual([
      [94.9, 99.3],
      [94.9, 96.2],
    ]);
  });
});
