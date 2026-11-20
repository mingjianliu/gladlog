/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pipeline T217 (round-14 D32, 7cadec17 r0 2:18): two casters' applications
 * of one buff on one enemy in one rendered second are two [ENEMY BUFF]
 * intervals; the missed-purge window (`unpurged for Ns`) goes to the one
 * that started at the window's own instant.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import type { IEnemyBuffInterval } from "../src/context/timelineHelpers";
import { foldMissedPurges } from "../src/context/timelineSections/purgeFolding";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  canOffensivePurge,
  type IMissedPurgeWindow,
} from "../src/utils/dispelAnalysis";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PI = "10060";
const interval = (startSeconds: number, endSeconds: number) =>
  ({
    spellId: PI,
    spellName: "Power Infusion",
    startSeconds,
    endSeconds,
    purgeable: true,
  }) as IEnemyBuffInterval;
const miss = (timeSeconds: number, durationSeconds: number) =>
  ({
    timeSeconds,
    durationSeconds,
    enemyName: "Lock",
    enemySpec: "Destruction Warlock",
    spellName: "Power Infusion",
    spellId: PI,
    priority: "High",
    purgeWasOnCD: false,
    teamUnderPressure: false,
    purgersLockedOut: false,
    losReachable: true,
  }) as IMissedPurgeWindow;

function fold(intervals: IEnemyBuffInterval[], windows: IMissedPurgeWindow[]) {
  const owner = makeUnit("owner", {
    name: "Owner",
    spec: CombatUnitSpec.Priest_Discipline,
  });
  expect(canOffensivePurge(owner, [owner])).toBe(true);
  return foldMissedPurges({
    enemyPid: (n: string) => `5(${n})`,
    owner,
    dispelSummary: {
      missedPurgeWindows: windows,
      scopedMissedPurgeWindows: [],
    },
    enemyBuffIntervals: new Map([["Lock", intervals]]),
    allUnits: [owner],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
  } as any);
}

describe("T217 — 同一秒两次施加的同一增益,未驱散窗口挂在自己那一次上", () => {
  it("7cadec17 r0: 138.379–138.847 的那次只写 (purgeable),15 秒窗口挂在 138.848 起的那次", () => {
    const short = interval(138.379, 138.847);
    const long = interval(138.848, 153.849);
    const out = fold([short, long], [miss(138.848, 15.001)]);
    expect(out.buffPurgeAnnotations.get(short)).toBe(" (purgeable)");
    expect(out.buffPurgeAnnotations.get(long)).toMatch(
      /^ \(purgeable; unpurged for 15s/,
    );
    expect(out.consumedMissedPurges.size).toBe(1);
  });

  it("两次各有自己的窗口:各拿各的,列表顺序不决定归属", () => {
    const a = interval(20.1, 26.1);
    const b = interval(20.6, 35.6);
    const out = fold([a, b], [miss(20.6, 15), miss(20.1, 6)]);
    expect(out.buffPurgeAnnotations.get(a)).toMatch(/unpurged for 6s/);
    expect(out.buffPurgeAnnotations.get(b)).toMatch(/unpurged for 15s/);
  });

  it("同一秒只有一次施加:照旧(起点差几百毫秒也匹配)", () => {
    const only = interval(40.2, 55.2);
    const out = fold([only], [miss(40.6, 15)]);
    expect(out.buffPurgeAnnotations.get(only)).toMatch(/unpurged for 15s/);
  });
});
