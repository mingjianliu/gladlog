import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  CAST_QUEUE_TOLERANCE_MS,
  castBarOutcomesOf,
  JUKE_LOOKBACK_MS,
} from "../src/utils/castBarOutcomes";
import { CANCEL_CC_NEAR_S } from "../src/utils/castStopEvidence";
import type { CastFailedEvent } from "../src/utils/rawStreams";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// Direct tests of the ONE cast-bar reading (`castBarOutcomesOf`) behind
// kick-eaten's cancel ledger, the `[CAST STOPPED]` lines and the kick audit's
// JUKED / silenced-bar readings. Until now it was exercised only through
// those readers (castCancels.test.ts, ported/kickAudit.test.ts); the six-step
// order its doc comment states had no test of its own.

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const FLASH_HEAL = "2061";
const start = (spellId: string, s: number) => ({
  ...makeSpellCastEvent(spellId, at(s), "e1", "Enemy", "p1", "Me"),
  logLine: {
    event: LogEvent.SPELL_CAST_START,
    timestamp: at(s),
    parameters: [],
  },
});
const success = (spellId: string, s: number) =>
  makeSpellCastEvent(spellId, at(s), "e1", "Enemy", "p1", "Me");
const fail = (spellId: string, s: number, reason: string): CastFailedEvent => ({
  tSeconds: s,
  unitGuid: "p1",
  spellId: Number(spellId),
  spellName: spellId,
  reason,
});

function outcomesOf(
  overrides: Parameters<typeof makeUnit>[1],
  failed: CastFailedEvent[] = [],
) {
  const unit = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
    info: {},
    ...overrides,
  });
  return castBarOutcomesOf({ unit, startMs: T0, failed });
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("castBarOutcomesOf — 读条怎么结束,六步顺序", () => {
  it("没有任何行的单位:每条读条都是 none;读条按时间排序", () => {
    const r = outcomesOf({
      castStartEvents: [start(FLASH_HEAL, 10), start(FLASH_HEAL, 4)],
    });
    expect(r.map((o) => [o.t, o.end.kind, o.earlierFailure])).toEqual([
      [4, "none", false],
      [10, "none", false],
    ]);
  });

  it("① 窗口内的 SUCCESS = completed;窗口 = 下一条读条开始或 4 s 上限,先到为准", () => {
    const capS = JUKE_LOOKBACK_MS / 1000;
    const r = outcomesOf({
      castStartEvents: [start(FLASH_HEAL, 0), start(FLASH_HEAL, 10)],
      spellCastEvents: [
        success(FLASH_HEAL, 1.5),
        // 4.5 s after the 10 s start, no next start: past the cap
        success(FLASH_HEAL, 10 + capS + 0.5),
      ],
    });
    expect(r[0]!.end).toEqual({ kind: "completed", atS: 1.5 });
    expect(r[1]!.end).toEqual({ kind: "none" });
  });

  it("② SPELL_INTERRUPT 落在窗口内 = kicked(没有 SUCCESS 时)", () => {
    const r = outcomesOf({
      castStartEvents: [start(FLASH_HEAL, 0)],
      actionIn: [
        makeInterruptEvent("1766", "Kick", FLASH_HEAL, "Flash Heal", at(0.9)),
      ],
    });
    expect(r[0]!.end).toEqual({ kind: "kicked", atS: 0.9 });
    expect(r[0]!.earlierFailure).toBe(false);
  });

  it("③ 中断理由行 = stopped,near 按 0.3 s 内发生的事分类:cc / displaced / death / null", () => {
    const near = CANCEL_CC_NEAR_S;
    const r = outcomesOf(
      {
        castStartEvents: [
          start(FLASH_HEAL, 0),
          start(FLASH_HEAL, 10),
          start(FLASH_HEAL, 20),
          start(FLASH_HEAL, 30),
        ],
        // Hammer of Justice landed 0.2 s after the stop → cc
        auraEvents: [
          makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "853", at(0.8), "e1", "p1"),
        ],
        // Thunderstorm damage taken 0.1 s before the stop → displaced
        damageIn: [{ ...makeDamageEvent(at(10.5), 100, "p1"), spellId: "51490" }],
        // the unit died 0.02 s after the stop → death
        deathRecords: [{ timestamp: at(20.52) }],
      },
      [
        fail(FLASH_HEAL, 0.6, "Interrupted"),
        fail(FLASH_HEAL, 10.6, "被打断\r"),
        fail(FLASH_HEAL, 20.5, "Interrupted"),
        // nothing within 0.3 s → null: the log does not say why
        fail(FLASH_HEAL, 30.0 + near + 0.5, "Interrompu"),
      ],
    );
    expect(r.map((o) => o.end)).toEqual([
      { kind: "stopped", atS: 0.6, near: "cc" },
      { kind: "stopped", atS: 10.6, near: "displaced" },
      { kind: "stopped", atS: 20.5, near: "death" },
      { kind: "stopped", atS: 30.0 + near + 0.5, near: null },
    ]);
  });

  it("中断理由行在 SUCCESS 之前 → 是 stopped,不是 completed(SUCCESS 是下一次的)", () => {
    const r = outcomesOf(
      {
        castStartEvents: [start(FLASH_HEAL, 0)],
        spellCastEvents: [success(FLASH_HEAL, 2.5)],
      },
      [fail(FLASH_HEAL, 0.7, "Interrupted")],
    );
    expect(r[0]!.end).toEqual({ kind: "stopped", atS: 0.7, near: null });
  });

  it("④ 排队完成:SUCCESS 在下一条读条开始后、容差内 → completed + queued;超过容差 → none", () => {
    expect(CAST_QUEUE_TOLERANCE_MS).toBe(400);
    const r = outcomesOf({
      castStartEvents: [
        start(FLASH_HEAL, 0),
        start(FLASH_HEAL, 1.0), // closes bar 1's window at 1.0
        start(FLASH_HEAL, 10),
        start(FLASH_HEAL, 11.0),
      ],
      spellCastEvents: [
        success(FLASH_HEAL, 1.35), // bar 1: 0.35 s past the next start, queued
        success(FLASH_HEAL, 11.45), // bar 3: 0.45 s past, beyond the tolerance
      ],
    });
    expect(r[0]!.end).toEqual({
      kind: "completed",
      atS: 1.35,
      queued: true,
    });
    expect(r[2]!.end).toEqual({ kind: "none" });
  });

  it("⑤ 其他 SPELL_CAST_FAILED = refused(带原行);「尚未恢复」类不算结束 → none", () => {
    const r = outcomesOf(
      {
        castStartEvents: [start(FLASH_HEAL, 0), start(FLASH_HEAL, 10)],
      },
      [
        fail(FLASH_HEAL, 0.9, "Target not in line of sight"),
        fail(FLASH_HEAL, 10.2, "Not yet recovered"),
        fail(FLASH_HEAL, 10.4, "尚未恢复"),
      ],
    );
    expect(r[0]!.end).toMatchObject({ kind: "refused", atS: 0.9 });
    expect((r[0]!.end as { row: CastFailedEvent }).row.reason).toBe(
      "Target not in line of sight",
    );
    expect(r[1]!.end).toEqual({ kind: "none" });
    expect(r[1]!.earlierFailure).toBe(true);
  });

  it("「读条还在跑时按键」的理由从本日志学:SUCCESS 前出现过的理由,之后单独出现不算 refused", () => {
    // Bar 1: "Another action is in progress" 19 ms after the start, then the
    // SUCCESS — the row was a key pressed twice, not the bar's end. Bar 2 has
    // only that row: with the lesson of bar 1 it is `none`, not `refused`.
    const r = outcomesOf(
      {
        castStartEvents: [start(FLASH_HEAL, 0), start(FLASH_HEAL, 10)],
        spellCastEvents: [success(FLASH_HEAL, 1.5)],
      },
      [
        fail(FLASH_HEAL, 0.019, "Another action is in progress"),
        fail(FLASH_HEAL, 10.3, "Another action is in progress"),
      ],
    );
    expect(r[0]!.end).toEqual({ kind: "completed", atS: 1.5 });
    expect(r[0]!.earlierFailure).toBe(true);
    expect(r[1]!.end).toEqual({ kind: "none" });
    expect(r[1]!.earlierFailure).toBe(true);
    // Without that lesson (no SUCCESS to learn from) the same row is a refusal.
    const alone = outcomesOf({ castStartEvents: [start(FLASH_HEAL, 10)] }, [
      fail(FLASH_HEAL, 10.3, "Another action is in progress"),
    ]);
    expect(alone[0]!.end).toMatchObject({ kind: "refused", atS: 10.3 });
  });

  it("earlierFailure:结束行之前有同技能的 FAILED 行;结束行本身不算", () => {
    const r = outcomesOf(
      {
        castStartEvents: [start(FLASH_HEAL, 0), start(FLASH_HEAL, 10)],
      },
      [
        fail(FLASH_HEAL, 0.2, "Not yet recovered"),
        fail(FLASH_HEAL, 0.8, "Interrupted"),
        fail(FLASH_HEAL, 10.8, "Interrupted"),
      ],
    );
    expect(r[0]!.earlierFailure).toBe(true);
    expect(r[1]!.earlierFailure).toBe(false);
  });

  it("别的技能的行不影响这条读条;没记录日志的单位(failed 为空)只有 completed / kicked / none", () => {
    const r = outcomesOf(
      {
        castStartEvents: [start(FLASH_HEAL, 0)],
        spellCastEvents: [success("8092", 0.5)], // Mind Blast, not this bar
        actionIn: [
          makeInterruptEvent("1766", "Kick", "8092", "Mind Blast", at(0.6)),
        ],
      },
      [fail("8092", 0.4, "Interrupted")],
    );
    expect(r[0]!.end).toEqual({ kind: "none" });
    expect(r[0]!.earlierFailure).toBe(false);
  });
});
