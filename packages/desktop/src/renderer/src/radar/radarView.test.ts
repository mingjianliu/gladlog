import { spec } from "./radarFixtures";
import {
  classEntries,
  EMPTY_RADAR_FILTER,
  filterSpecs,
  loadRoster,
  matchesSearch,
  radarSpecIcon,
  roleCounts,
  sortSpecs,
  specDisplayName,
  tierClass,
  toggleAll,
  topPick,
  windowActivity,
} from "./radarView";

const DISC = spec("Discipline Priest", "Priest", "healer", {
  timing_score: 81,
  strength_score: 32,
});
const SHADOW = spec("Shadow Priest", "Priest", "dps", {
  timing_score: 40,
  strength_score: 70,
});
const ARMS = spec("Arms Warrior", "Warrior", "dps", {
  timing_score: 60,
  strength_score: 55,
  window_matches: 99,
});
const BLOOD = spec("Blood Death Knight", "Death Knight", "tank", {
  no_data: true,
  timing_score: 50,
  strength_score: 50,
  timing_tier_key: "none",
  strength_tier_key: "none",
});
const PROT = spec("Protection Warrior", "Warrior", "tank", { no_data: true });
const ALL = [DISC, SHADOW, ARMS, BLOOD, PROT];

describe("radarView 筛选", () => {
  it("默认隐藏无样本专精,并报告隐藏数", () => {
    const r = filterSpecs(ALL, EMPTY_RADAR_FILTER);
    expect(r.visible.map((s) => s.spec_name)).toEqual([
      "Discipline Priest",
      "Shadow Priest",
      "Arms Warrior",
    ]);
    expect(r.hiddenEmptyCount).toBe(2);
  });

  it("匹配的全是无样本专精(如 2600+ 坦克)时回退为全部显示", () => {
    const r = filterSpecs(ALL, { ...EMPTY_RADAR_FILTER, role: "tank" });
    expect(r.visible).toHaveLength(2);
    expect(r.hiddenEmptyCount).toBe(0);
  });

  it("显式勾选的无样本专精不被隐藏", () => {
    const r = filterSpecs(ALL, {
      ...EMPTY_RADAR_FILTER,
      specs: ["Blood Death Knight", "Arms Warrior"],
    });
    expect(r.visible.map((s) => s.spec_name).sort()).toEqual([
      "Arms Warrior",
      "Blood Death Knight",
    ]);
  });

  it("职责 / 职业 / 关键词叠加过滤,且不改动任何分数", () => {
    const before = JSON.stringify(ALL);
    const r = filterSpecs(ALL, {
      ...EMPTY_RADAR_FILTER,
      role: "dps",
      classes: ["Priest"],
    });
    expect(r.visible.map((s) => s.spec_name)).toEqual(["Shadow Priest"]);
    expect(JSON.stringify(ALL)).toBe(before);
  });

  it("关键词中英文都能命中,包括职责词", () => {
    expect(matchesSearch(DISC, "戒律")).toBe(true);
    expect(matchesSearch(DISC, "牧师")).toBe(true);
    expect(matchesSearch(DISC, "disc")).toBe(true);
    expect(matchesSearch(DISC, "治疗")).toBe(true);
    expect(matchesSearch(DISC, "warrior")).toBe(false);
    expect(matchesSearch(DISC, "  ")).toBe(true);
  });
});

describe("radarView 排序与第 1 名", () => {
  it("无样本专精永远排在有样本之后(哪怕有样本的低于 50)", () => {
    const low = spec("Fire Mage", "Mage", "dps", { timing_score: 12 });
    const order = sortSpecs([BLOOD, low], "timing").map((s) => s.spec_name);
    expect(order).toEqual(["Fire Mage", "Blood Death Knight"]);
  });

  it("三种排序键", () => {
    const xs = [DISC, SHADOW, ARMS];
    expect(sortSpecs(xs, "timing")[0]!.spec_name).toBe("Discipline Priest");
    expect(sortSpecs(xs, "strength")[0]!.spec_name).toBe("Shadow Priest");
    expect(sortSpecs(xs, "matches")[0]!.spec_name).toBe("Arms Warrior");
  });

  it("第 1 名:按强度排序时取强度第一,否则取时段指数第一;全无样本时为空", () => {
    expect(topPick(sortSpecs(ALL, "matches"), "matches")!.spec_name).toBe(
      "Discipline Priest",
    );
    expect(topPick(sortSpecs(ALL, "strength"), "strength")!.spec_name).toBe(
      "Shadow Priest",
    );
    expect(topPick([BLOOD, PROT], "timing")).toBeNull();
  });
});

describe("radarView 汇总", () => {
  it("窗口活跃度按可见子集逐小时求和", () => {
    const a = spec("Fire Mage", "Mage", "dps", {}, (h) => (h === 5 ? 48 : 0));
    const b = spec("Frost Mage", "Mage", "dps", {}, (h) => (h === 5 ? 24 : 0));
    const w = windowActivity([a, b], 5);
    expect(w.current).toBe(72);
    expect(w.mean).toBe(3);
    expect(w.ratio).toBe(24);
    expect(windowActivity([], 5)).toEqual({ current: 0, mean: 0, ratio: 0 });
  });

  it("职责计数与职业分组", () => {
    expect(roleCounts(ALL)).toEqual({ all: 5, healer: 1, dps: 2, tank: 2 });
    const zh = classEntries(ALL, "en").map((c) => c.className);
    expect(zh).toEqual(["Death Knight", "Priest", "Warrior"]);
    expect(classEntries(ALL, "en")[1]!.specs).toHaveLength(2);
  });

  it("toggleAll:全选 ↔ 全取消", () => {
    expect(toggleAll(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(toggleAll(["a", "b", "c"], ["a", "b"])).toEqual(["c"]);
  });
});

describe("radarView 显示", () => {
  it("40 个专精都有中文名和专精图标", () => {
    const names = [
      "Devourer Demon Hunter",
      "Preservation Evoker",
      "Discipline Priest",
    ];
    for (const n of names) {
      expect(specDisplayName(n, "zh")).not.toBe(n);
      expect(radarSpecIcon(n)).toBeTruthy();
    }
    expect(specDisplayName("Discipline Priest", "en")).toBe(
      "Discipline Priest",
    );
    expect(radarSpecIcon("Not A Spec")).toBeUndefined();
  });

  it("未知档位读作中性档", () => {
    expect(tierClass("t0")).toBe("radar-tier-t0");
    expect(tierClass("weird")).toBe("radar-tier-t2");
    expect(tierClass(undefined)).toBe("radar-tier-t2");
  });

  it("常玩池读取容错:坏 JSON / 非数组 / 非字符串项", () => {
    const st = (v: string | null) => ({ getItem: () => v });
    expect(loadRoster(st('["Arms Warrior", 3]'))).toEqual(["Arms Warrior"]);
    expect(loadRoster(st("{bad"))).toEqual([]);
    expect(loadRoster(st('{"a":1}'))).toEqual([]);
    expect(loadRoster(st(null))).toEqual([]);
    expect(loadRoster(undefined)).toEqual([]);
  });
});
