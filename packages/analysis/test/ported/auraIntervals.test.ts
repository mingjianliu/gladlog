import { describe, expect, it } from "vitest";

import { buildAuraIntervals } from "../../src/utils/auraIntervals";
import type { ICombatUnit } from "@gladlog/parser-compat";

const T0 = 1_000_000;
const combat = { startTime: T0, endTime: T0 + 90_000 };

function unit(auraEvents: unknown[]): ICombatUnit {
  return { id: "u1", auraEvents } as unknown as ICombatUnit;
}
function ev(
  event: string,
  offsetMs: number,
  spellId: string,
  over: Record<string, unknown> = {},
) {
  return {
    spellId,
    spellName: `S${spellId}`,
    timestamp: T0 + offsetMs,
    srcUnitId: "src",
    srcUnitName: "Src",
    destUnitId: "u1",
    destUnitName: "U1",
    logLine: { event, timestamp: T0 + offsetMs, parameters: [] },
    ...over,
  };
}

describe("buildAuraIntervals(第四阶段④)", () => {
  it("APPLIED→REMOVED 配对成区间;多段互不串", () => {
    const iv = buildAuraIntervals(
      unit([
        ev("SPELL_AURA_APPLIED", 5_000, "100"),
        ev("SPELL_AURA_REMOVED", 15_000, "100"),
        ev("SPELL_AURA_APPLIED", 30_000, "100"),
        ev("SPELL_AURA_REMOVED", 42_000, "100"),
      ]),
      combat,
    );
    expect(iv.map((i) => [i.fromS, i.toS])).toEqual([
      [5, 15],
      [30, 42],
    ]);
    expect(iv.every((i) => !i.inferredStart && !i.inferredEnd)).toBe(true);
  });

  it("只见 REMOVED → 开局前已挂:from 0 且 inferredStart", () => {
    const iv = buildAuraIntervals(
      unit([ev("SPELL_AURA_REMOVED", 20_000, "200")]),
      combat,
    );
    expect(iv).toHaveLength(1);
    expect(iv[0]).toMatchObject({ fromS: 0, toS: 20, inferredStart: true });
  });

  it("REFRESH 无开段 → 开局前已挂并延续;后续 REMOVED 收段", () => {
    const iv = buildAuraIntervals(
      unit([
        ev("SPELL_AURA_REFRESH", 10_000, "300"),
        ev("SPELL_AURA_REMOVED", 50_000, "300"),
      ]),
      combat,
    );
    expect(iv).toHaveLength(1);
    expect(iv[0]).toMatchObject({ fromS: 0, toS: 50, inferredStart: true });
  });

  it("到场终未 REMOVED → 收在时长处且 inferredEnd", () => {
    const iv = buildAuraIntervals(
      unit([ev("SPELL_AURA_APPLIED", 60_000, "400")]),
      combat,
    );
    expect(iv[0]).toMatchObject({ fromS: 60, toS: 90, inferredEnd: true });
  });

  it("BROKEN/BROKEN_SPELL 也收段;dest 非本单位的事件被过滤", () => {
    const iv = buildAuraIntervals(
      unit([
        ev("SPELL_AURA_APPLIED", 5_000, "500"),
        ev("SPELL_AURA_BROKEN_SPELL", 9_000, "500"),
        ev("SPELL_AURA_APPLIED", 20_000, "600", { destUnitId: "other" }),
      ]),
      combat,
    );
    expect(iv).toHaveLength(1);
    expect(iv[0]).toMatchObject({ spellId: "500", fromS: 5, toS: 9 });
  });

  it("重复 APPLIED = 上段无声掉落:关旧(inferredEnd)开新,覆盖并集不变", () => {
    // 2026-08-21 语义变更(防伪规则自 utils.buildFilteredAuraIntervals 上移,
    // GH #17):旧行为把 5s/8s 两次 APPLIED 融成一段 [5,12] —— 正是 REMOVED
    // 缺失 + 重新施放的 5s 斗篷被拼成 130s 区间的伪影来源。新行为在第二次
    // APPLIED 处关旧开新(无官方时长则关在当下;有则封顶 lastSeen+D),
    // 时间覆盖并集不变,但跨段拼接不再可能。
    const iv = buildAuraIntervals(
      unit([
        ev("SPELL_AURA_APPLIED", 5_000, "700"),
        ev("SPELL_AURA_APPLIED", 8_000, "700"),
        ev("SPELL_AURA_REMOVED", 12_000, "700"),
      ]),
      combat,
    );
    expect(iv).toHaveLength(2);
    expect(iv[0]).toMatchObject({ fromS: 5, toS: 8, inferredEnd: true });
    expect(iv[1]).toMatchObject({ fromS: 8, toS: 12, inferredEnd: false });
  });
});

describe("2026-07-25 生产修正:双来源分键 / DOSE 开段 / 官方时长封顶", () => {
  const combat = { startTime: 0, endTime: 300_000 }; // 5 minutes
  const aura = (ev: string, t: number, spellId: string, srcUnitId: string) => ({
    logLine: { event: ev },
    timestamp: t,
    spellId,
    spellName: `S${spellId}`,
    srcUnitId,
    srcUnitName: srcUnitId,
    destUnitId: "me",
  });
  const unit = (evs: unknown[]) => ({ id: "me", auraEvents: evs }) as never;

  it("双来源同法术:第二来源的 REMOVED 不再产生 0 秒起幻影虚线", () => {
    const ivs = buildAuraIntervals(
      unit([
        aura("SPELL_AURA_APPLIED", 10_000, "17", "priestA"),
        aura("SPELL_AURA_APPLIED", 12_000, "17", "priestB"),
        aura("SPELL_AURA_REMOVED", 16_000, "17", "priestA"),
        aura("SPELL_AURA_REMOVED", 18_000, "17", "priestB"),
      ]),
      combat,
    );
    expect(ivs).toHaveLength(2);
    expect(ivs.every((iv) => !iv.inferredStart && !iv.inferredEnd)).toBe(true);
    expect(ivs.map((iv) => [iv.fromS, iv.toS])).toEqual([
      [10, 16],
      [12, 18],
    ]);
  });

  it("APPLIED_DOSE 开段(叠层光环首事件)", () => {
    const ivs = buildAuraIntervals(
      unit([
        aura("SPELL_AURA_APPLIED_DOSE", 20_000, "17", "a"),
        aura("SPELL_AURA_REMOVED", 30_000, "17", "a"),
      ]),
      combat,
    );
    expect(ivs).toEqual([
      expect.objectContaining({ fromS: 20, toS: 30, inferredStart: false }),
    ]);
  });

  it("无 APPLIED 的 REMOVED:回推至多官方时长(122 冰霜新星 6s),非 0 起", () => {
    // 116 Frostbolt has a short duration in spellEffectGenerated; assert the
    // interval does not start at 0
    const ivs = buildAuraIntervals(
      unit([aura("SPELL_AURA_REMOVED", 200_000, "122", "mage")]),
      combat,
    );
    expect(ivs).toHaveLength(1);
    expect(ivs[0]!.inferredStart).toBe(true);
    expect(ivs[0]!.fromS).toBe(194); // 200s − the official 6s
  });

  it("无官方时长的 REMOVED 维持旧行为(0 起,真·开局前已挂语义)", () => {
    const ivs = buildAuraIntervals(
      unit([aura("SPELL_AURA_REMOVED", 200_000, "999999", "x")]),
      combat,
    );
    expect(ivs[0]!.fromS).toBe(0);
    expect(ivs[0]!.inferredStart).toBe(true);
  });

  it("未见 REMOVED:延至多官方时长,短光环不再虚到比赛结束", () => {
    const ivs = buildAuraIntervals(
      unit([aura("SPELL_AURA_APPLIED", 10_000, "122", "mage")]),
      combat,
    );
    expect(ivs[0]!.inferredEnd).toBe(true);
    expect(ivs[0]!.toS).toBe(16); // 10s + the official 6s, not 300s
  });

  describe("BACKLOG #28:同一控制被两个冗余关闭事件重复上报,不再倒推幻影区间", () => {
    it("match 76ea5f90 复现:APPLIED 后 BROKEN_SPELL + 1ms 后 REMOVED → 只出一段区间,结束在 REMOVED(FT-T08)", () => {
      // Mirrors the real repro: Freezing Trap (3355), applied once at
      // 168.075s, closed by BROKEN_SPELL at 173.421s, then a redundant
      // REMOVED for the same spellId (different, unrelated src — the log's
      // second close event) arrives 1ms later. Before the fix this second
      // close found no open interval and backdated a phantom
      // [167.421, 173.422] overlapping the real [168.075, 173.421].
      // FT-T08 (2026-10-09): the aura ends at its REMOVED — the BROKEN line
      // says what broke it — so the one interval now ends at 173.422.
      const ivs = buildAuraIntervals(
        unit([
          aura("SPELL_AURA_APPLIED", 168_075, "3355", "Boofers"),
          aura("SPELL_AURA_BROKEN_SPELL", 173_421, "3355", "Brucatodo"),
          aura("SPELL_AURA_REMOVED", 173_422, "3355", "Brucatodo"),
        ]),
        combat,
      );
      expect(ivs).toHaveLength(1);
      expect(ivs[0]).toMatchObject({
        fromS: 168.075,
        toS: 173.422,
        inferredStart: false,
        inferredEnd: false,
      });
    });

    it("三个冗余关闭事件挤在一起(BROKEN+BROKEN_SPELL+REMOVED)→ 仍只出一段", () => {
      const ivs = buildAuraIntervals(
        unit([
          aura("SPELL_AURA_APPLIED", 50_000, "800", "a"),
          aura("SPELL_AURA_BROKEN", 55_000, "800", "a"),
          aura("SPELL_AURA_BROKEN_SPELL", 55_010, "800", "b"),
          aura("SPELL_AURA_REMOVED", 55_030, "800", "c"),
        ]),
        combat,
      );
      expect(ivs).toHaveLength(1);
      // ends at the REMOVED, not at the first of the two BROKEN lines (FT-T08)
      expect(ivs[0]).toMatchObject({ fromS: 50, toS: 55.03 });
    });

    it("负控制:窗口开局前从未见过 APPLIED,只有孤立 REMOVED → 仍按旧行为回推(不是重复关闭)", () => {
      const ivs = buildAuraIntervals(
        unit([aura("SPELL_AURA_REMOVED", 100_000, "122", "mage")]),
        combat,
      );
      expect(ivs).toHaveLength(1);
      expect(ivs[0]!.inferredStart).toBe(true);
      expect(ivs[0]!.toS).toBe(100);
    });

    it("负控制:同一 spellId 两次相隔很远的独立掉落(第二次没见 APPLIED)→ 第二段仍照常回推,不被当成重复关闭吞掉", () => {
      // 122 (Frostbolt) carries an official 6s duration in spellEffectData
      // (used elsewhere in this file) so both intervals get non-zero,
      // order-stable fromS values regardless of the sort-by-fromS output
      // order.
      const ivs = buildAuraIntervals(
        unit([
          aura("SPELL_AURA_APPLIED", 10_000, "122", "mage"),
          aura("SPELL_AURA_REMOVED", 15_000, "122", "mage"),
          // A real second occurrence far later (60s gap) whose APPLIED this
          // match never saw (e.g. applied just before a UI-log gap) — must
          // still surface as its own inferred interval, not be discarded as
          // a duplicate of the first close.
          aura("SPELL_AURA_REMOVED", 75_000, "122", "mage"),
        ]),
        combat,
      );
      expect(ivs).toHaveLength(2);
      expect(ivs[0]).toMatchObject({
        fromS: 10,
        toS: 15,
        inferredStart: false,
      });
      expect(ivs[1]).toMatchObject({ fromS: 69, toS: 75, inferredStart: true });
    });
  });
});
