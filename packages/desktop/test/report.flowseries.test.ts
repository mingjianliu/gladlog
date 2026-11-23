import {
  deriveFlowSeries,
  type FlowMetric,
  forEachContribution,
  petsOf,
  smoothRate,
} from "../src/renderer/src/report/derive/flowSeries";

describe("smoothRate(流量曲线的居中滑动平均)", () => {
  it("居中窗口:单次尖峰摊到前后各 2 秒,内部积分守恒", () => {
    const out = smoothRate([0, 0, 0, 0, 10, 0, 0, 0, 0], 5);
    expect(out).toEqual([0, 0, 2, 2, 2, 2, 2, 0, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10);
  });
  it("边缘按实际存在的桶数取平均,不当成补零(首尾不出现假下凹)", () => {
    expect(smoothRate([6, 6, 6, 6], 5)).toEqual([6, 6, 6, 6]);
    // 第 0 秒窗口只有 3 个桶 → 9/3;第 1 秒 4 个 → 9/4;第 2 秒满窗 → 9/5
    expect(smoothRate([9, 0, 0, 0, 0, 0], 5)).toEqual([
      3,
      9 / 4,
      9 / 5,
      0,
      0,
      0,
    ]);
  });
  it("窗口 ≤1 或空序列原样返回(拷贝,不共享引用)", () => {
    const b = [1, 2, 3];
    const out = smoothRate(b, 1);
    expect(out).toEqual(b);
    expect(out).not.toBe(b);
    expect(smoothRate([], 5)).toEqual([]);
  });
});
import {
  type MeterMode,
  meterValue,
} from "../src/renderer/src/report/derive/meterRows";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadMatchFixture, loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();

/** The three flow metrics that are also leaderboard modes. 血量 has no total,
 * 被治疗 has no leaderboard mode. */
const SHARED: Array<[FlowMetric, MeterMode]> = [
  ["damage", "damage"],
  ["healing", "healing"],
  ["taken", "taken"],
];

describe("deriveFlowSeries", () => {
  it("每秒桶:数量覆盖全场,求和 = 该单位全场合计", () => {
    const f = deriveFlowSeries(m, "damage");
    expect(f.bucketMs).toBe(1000);
    expect(f.bucketCount).toBe(Math.ceil((m.endTime - m.startTime) / 1000));
    expect(f.units.length).toBeGreaterThan(0);
    for (const u of f.units) {
      expect(u.buckets).toHaveLength(f.bucketCount);
      expect(u.buckets.reduce((a, b) => a + b, 0)).toBe(u.total);
    }
  });

  it("单位按 teamId → name 排序(图例里同队连续)", () => {
    const f = deriveFlowSeries(m, "damage");
    const keys = f.units.map((u) => [u.teamId, u.name] as const);
    const sorted = [...keys].sort(
      (a, b) => a[0] - b[0] || a[1].localeCompare(b[1]),
    );
    expect(keys).toEqual(sorted);
  });

  // 谓词单源(CLAUDE.md):每秒桶的积分必须等于同一页面上榜单条的数字。
  // forEachContribution 是两边共享的事件选择器,这里钉住的是 METRIC_BASES 的
  // 组合口径(尤其是「治疗含吸收」)不会单边漂移。
  it.each(SHARED)("每秒桶求和 == 榜单 %s 条(同源断言)", (metric, mode) => {
    const f = deriveFlowSeries(m, metric);
    const rows = deriveSummary(m);
    for (const u of f.units) {
      const row = rows.find((r) => r.unitId === u.unitId);
      expect(row, u.name).toBeTruthy();
      expect(u.total, `${u.name} / ${metric}`).toBe(meterValue(row!, mode));
    }
  });

  it("HAS TEETH:上面的相等不是 0==0,且治疗口径真的含吸收", () => {
    const rows = deriveSummary(m);
    // 若这些前提没了(换 fixture),同源断言会退化成空转,必须当场打红
    expect(rows.some((r) => r.damageDone > 0)).toBe(true);
    expect(rows.some((r) => r.healingDone > 0)).toBe(true);
    expect(rows.some((r) => r.damageTaken > 0)).toBe(true);
    expect(rows.some((r) => r.absorbsDone > 0)).toBe(true);
    // 有吸收 → 「治疗」若漏掉 absorbsOut,总额会与榜单差出这一块
    const heal = deriveFlowSeries(m, "healing");
    const healOnly = rows.reduce((a, r) => a + r.healingDone, 0);
    expect(heal.units.reduce((a, u) => a + u.total, 0)).toBeGreaterThan(
      healOnly,
    );
  });

  it("被治疗:fixture 有 healIn → 有数据,且 = healIn + absorbsIn", () => {
    const f = deriveFlowSeries(m, "healed");
    expect(f.units.some((u) => u.total > 0)).toBe(true);
    const all = Object.values(m.units);
    for (const u of f.units) {
      const unit = all.find((x) => x.id === u.unitId)!;
      const expected =
        unit.healIn.reduce((a, e) => a + e.effectiveAmount, 0) +
        unit.absorbsIn.reduce((a, e) => a + e.absorbedAmount, 0);
      expect(u.total, u.name).toBe(expected);
    }
  });

  // fixture 里的宠物本身没有伤害事件,按 desktop-dev 的做法克隆后注入合成事件
  it("宠物计入主人的输出,落在事件所在的秒;承伤不计宠物(与榜单同一条不对称)", () => {
    const clone = JSON.parse(JSON.stringify(m)) as ReportSource;
    const all = Object.values(clone.units);
    const owner = all.find(
      (u) =>
        u.kind === "Player" && u.info && all.some((p) => p.ownerId === u.id),
    );
    expect(owner, "fixture 应含至少一个带宠物的玩家").toBeTruthy();
    const pet = all.find((p) => p.ownerId === owner!.id)!;
    const AT_S = 7;
    const before = deriveFlowSeries(clone, "damage").units.find(
      (u) => u.unitId === owner!.id,
    )!;
    pet.damageOut.push({
      ...Object.values(clone.units)
        .flatMap((u) => u.damageOut)
        .find((e) => e !== undefined)!,
      timestamp: clone.startTime + AT_S * 1000 + 400,
      amount: 5000,
      effectiveAmount: 5000,
    });
    const after = deriveFlowSeries(clone, "damage").units.find(
      (u) => u.unitId === owner!.id,
    )!;
    expect(after.total).toBe(before.total + 5000);
    expect(after.buckets[AT_S]).toBe((before.buckets[AT_S] ?? 0) + 5000);
    // …而承伤只看自己:同样一条打在宠物身上的伤害不进主人的承伤
    const petsOfOwner = petsOf(all, owner!.id);
    pet.damageIn.push({ ...pet.damageOut[pet.damageOut.length - 1]! });
    let taken = 0;
    forEachContribution(owner!, petsOfOwner, "damageTaken", (_e, amt) => {
      taken += amt;
    });
    expect(taken).toBe(
      owner!.damageIn.reduce((a, e) => a + e.effectiveAmount, 0),
    );
  });

  it("裁剪过的 doc(healIn/absorbsIn 整个字段缺失)不抛,该指标为空", () => {
    const trimmed = loadRealMatchFixture();
    const u0 = Object.values(trimmed.units)[0]!;
    expect("healIn" in u0, "该 fixture 前提是这些字段被剥掉了").toBe(false);
    const f = deriveFlowSeries(trimmed, "healed");
    expect(f.units.length).toBeGreaterThan(0);
    expect(f.units.every((u) => u.total === 0)).toBe(true);
    // 同一份裁剪 doc 上,其它指标照常有数
    expect(
      deriveFlowSeries(trimmed, "damage").units.some((u) => u.total > 0),
    ).toBe(true);
  });

  it("时间戳越界的事件落进边缘桶,不丢(总额仍等于榜单)", () => {
    const clone = JSON.parse(JSON.stringify(m)) as ReportSource;
    const victim = Object.values(clone.units).find(
      (u) => u.kind === "Player" && u.info && u.damageIn.length > 0,
    )!;
    victim.damageIn.push({
      ...victim.damageIn[0]!,
      timestamp: clone.endTime + 60_000,
      amount: 777,
      effectiveAmount: 777,
    });
    const f = deriveFlowSeries(clone, "taken");
    const row = f.units.find((u) => u.unitId === victim.id)!;
    expect(row.total).toBe(
      meterValue(
        deriveSummary(clone).find((r) => r.unitId === victim.id)!,
        "taken",
      ),
    );
    expect(row.buckets[f.bucketCount - 1]).toBeGreaterThanOrEqual(777);
  });

  it("没有 advanced logging 也能出流量数据(血量曲线不行)", () => {
    const noAdv = { ...m, hasAdvancedLogging: false };
    expect(
      deriveFlowSeries(noAdv, "damage").units.some((u) => u.total > 0),
    ).toBe(true);
  });
});
