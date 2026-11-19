/**
 * Pipeline T162 (GH #218 item 7.3): an own absorb shield pressed before the
 * log's first row and listed again by a re-stating batch has no press to
 * pair with; `ownPressedShieldSpansMs` read it as a shield nobody pressed.
 * It stands for the unlogged press when the batch re-stated it, nothing that
 * puts it up was pressed before, and the holder presses the shield's own id
 * later in the round.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  OWN_SHIELD_PRESS_LOOKBACK_MS,
  ownPressedShieldSpansMs,
} from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const ICE_BARRIER = "11426";
const absorb = (ms: number) => ({
  spellId: ICE_BARRIER,
  srcUnitId: "u",
  absorbedAmount: 10_000,
  timestamp: ms,
  logLine: { timestamp: ms },
});
const cast = (spellId: string, ms: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
});
const applied = (spellId: string, ms: number) => ({
  spellId,
  srcUnitId: "u",
  destUnitId: "u",
  timestamp: ms,
  logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: ms },
});
/** a re-stating batch at `ms`: the shield and six other auras in one ms */
const batch = (ms: number) => [
  applied(ICE_BARRIER, ms),
  ...["1", "2", "3", "4", "5", "6"].map((id) => applied(id, ms)),
];
const unit = (casts: unknown[], auraEvents: unknown[]) =>
  ({
    id: "u",
    absorbsIn: [absorb(T + 500)],
    spellCastEvents: casts,
    auraEvents,
  }) as never;

describe("开场前按下的盾被重新列出", () => {
  it("重同步批次里的冰障、之前没有按键、之后按过:算按过的盾", () => {
    const u = unit([cast(ICE_BARRIER, T + 40_000)], batch(T));
    expect(ownPressedShieldSpansMs(u, ICE_BARRIER, T, T + 30_000)).toEqual([
      { fromMs: T, toMs: T + 30_000 },
    ]);
    // capped a minute after the run's start
    // capped a minute after the run's start; the later press inside the
    // run keeps its own span
    expect(
      ownPressedShieldSpansMs(u, ICE_BARRIER, T, T + 90_000),
    ).toContainEqual({ fromMs: T, toMs: T + OWN_SHIELD_PRESS_LOOKBACK_MS });
  });

  it("整回合没按过这个盾:不算(日志没说它是这个单位的按键)", () => {
    expect(
      ownPressedShieldSpansMs(unit([], batch(T)), ICE_BARRIER, T, T + 30_000),
    ).toEqual([]);
  });

  it("不在重同步批次里的孤立 APPLIED:不算", () => {
    const u = unit(
      [cast(ICE_BARRIER, T + 40_000)],
      [applied(ICE_BARRIER, T)],
    );
    expect(ownPressedShieldSpansMs(u, ICE_BARRIER, T, T + 30_000)).toEqual([]);
  });

  it("之前有过按键(超过一分钟):仍按原规则,不算", () => {
    const u = unit(
      [cast(ICE_BARRIER, T - 70_000), cast(ICE_BARRIER, T + 40_000)],
      batch(T),
    );
    expect(ownPressedShieldSpansMs(u, ICE_BARRIER, T, T + 30_000)).toEqual([]);
  });

  it("起点被前移时按日志里的 APPLIED 判批次", () => {
    const u = unit([cast(ICE_BARRIER, T + 40_000)], batch(T + 800));
    expect(
      ownPressedShieldSpansMs(u, ICE_BARRIER, T, T + 30_000, u, T + 800),
    ).toEqual([{ fromMs: T, toMs: T + 30_000 }]);
  });
});
