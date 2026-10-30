/**
 * 失误卡的收敛层:按归属拆 + 按时刻并(2026-08-17)。
 *
 * 起因:UI 每回合中位 28 条,其中近 30% 是 owner 视角根本不会出的 DPS 专属
 * 类型(来自对每个友方各跑一遍候选提取),而剩下的又有 44% 是同一波里的不同
 * 侧面。**先合并再截断** —— 反过来会把同一件事的碎片当成不同的事截掉一半。
 */
import {
  groupMistakesByMoment,
  type Mistake,
  MISTAKE_MOMENT_GAP_S,
  type MistakeSeverity,
  splitMistakesByOwner,
} from "../src/renderer/src/report/derive/mistakes";

function mk(tS: number, over: Partial<Mistake> = {}): Mistake {
  return {
    tS,
    unitName: "Me",
    type: "cc-locked",
    label: "被控",
    severity: "minor" as MistakeSeverity,
    detail: "",
    seekNames: ["Me"],
    isOwner: true,
    timed: true,
    ...over,
  };
}

describe("失误按归属拆分", () => {
  it("owner 的与队友的分开", () => {
    const { own, teammates } = splitMistakesByOwner([
      mk(10),
      mk(20, { isOwner: false, unitName: "Mate" }),
      mk(30),
    ]);
    expect(own).toHaveLength(2);
    expect(teammates).toHaveLength(1);
    expect(teammates[0]!.unitName).toBe("Mate");
  });

  it("空输入不炸", () => {
    expect(splitMistakesByOwner([])).toEqual({ own: [], teammates: [] });
  });
});

describe("失误按时刻分组", () => {
  it(`间隔 <= ${MISTAKE_MOMENT_GAP_S}s 的并成一组,超过的分开`, () => {
    const groups = groupMistakesByMoment([
      mk(10),
      mk(10 + MISTAKE_MOMENT_GAP_S), // 边界:恰好等于窗口,仍并入
      mk(10 + MISTAKE_MOMENT_GAP_S * 2 + 1), // 超过,另起一组
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.items).toHaveLength(1);
  });

  it("链式相接:每一步都在窗口内就一直并下去", () => {
    const groups = groupMistakesByMoment([mk(0), mk(8), mk(16), mk(24)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(4);
  });

  it("组的严重度取组内最高", () => {
    const groups = groupMistakesByMoment([
      mk(10, { severity: "minor" }),
      mk(12, { severity: "major" }),
      mk(14, { severity: "average" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.severity).toBe("major");
  });

  it("组的时刻取组内最早,便于跳转", () => {
    const groups = groupMistakesByMoment([mk(17), mk(11), mk(14)]);
    expect(groups[0]!.tS).toBe(11);
  });

  it("整场型观察各自独立成组并排在最后", () => {
    const groups = groupMistakesByMoment([
      mk(0, { timed: false, type: "cd-waste", label: "整场未用" }),
      mk(10),
      mk(12),
    ]);
    // 有时刻的先并成一组,整场型跟在后面
    expect(groups).toHaveLength(2);
    expect(groups[0]!.timed).toBe(true);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[groups.length - 1]!.timed).toBe(false);
  });

  it("真实形态:被控那一波的多个侧面并成一件事", () => {
    // 实测最高频的共现:cc-locked + unsynced-burst / missed-sync-window /
    // missed-purge —— 都是「你被控住的同一波」。
    const groups = groupMistakesByMoment([
      mk(60, { type: "cc-locked", label: "被控" }),
      mk(62, { type: "unsynced-burst", label: "起爆未同步" }),
      mk(64, { type: "missed-purge", label: "漏剥离" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.type)).toEqual([
      "cc-locked",
      "unsynced-burst",
      "missed-purge",
    ]);
  });

  it("空输入返回空", () => {
    expect(groupMistakesByMoment([])).toEqual([]);
  });
});

// ─── 排序(GH #19,2026-08-20) ────────────────────────────────────────────────
import {
  MISTAKE_DISCRIMINATION_PP,
  MISTAKE_RULES,
  type MistakeMoment,
  rankMistakeMoments,
} from "../src/renderer/src/report/derive/mistakes";

function moment(
  tS: number,
  severity: MistakeSeverity,
  types: string[],
): MistakeMoment {
  return {
    tS,
    severity,
    timed: true,
    items: types.map((type) => mk(tS, { type, severity })),
  };
}

describe("失误时刻排序 rankMistakeMoments(GH #19)", () => {
  it("严重度优先:major 在 average 前,与时间无关", () => {
    const out = rankMistakeMoments([
      moment(10, "average", ["cd-waste"]),
      moment(50, "major", ["external-unused"]),
    ]);
    expect(out.map((m) => m.tS)).toEqual([50, 10]);
  });

  it("同档内按实测判别力降序:cd-hoarded(+22.7)排在 cc-avoidable(+7.7)前,即使发生得晚", () => {
    const out = rankMistakeMoments([
      moment(10, "major", ["cc-avoidable"]),
      moment(50, "major", ["cd-hoarded"]),
    ]);
    expect(out.map((m) => m.tS)).toEqual([50, 10]);
  });

  it("一组取组内最高判别力;判别力相同(或都没量过)再按时间", () => {
    const out = rankMistakeMoments([
      moment(30, "minor", ["cc-held"]),
      moment(20, "minor", ["cc-held", "cc-avoidable"]),
      moment(10, "minor", ["cc-held"]),
    ]);
    expect(out.map((m) => m.tS)).toEqual([20, 10, 30]);
  });

  it("不改动入参(纯函数)", () => {
    const input = [
      moment(10, "minor", ["cc-held"]),
      moment(5, "major", ["cd-hoarded"]),
    ];
    const snapshot = input.map((m) => m.tS);
    rankMistakeMoments(input);
    expect(input.map((m) => m.tS)).toEqual(snapshot);
  });

  it("判别力表只登记规则表里存在的类型(防止改名后静默失效)", () => {
    const known = new Set(MISTAKE_RULES.map((r) => r.type));
    for (const type of Object.keys(MISTAKE_DISCRIMINATION_PP)) {
      expect(known.has(type), `${type} 不在 MISTAKE_RULES`).toBe(true);
    }
  });
});
