import {
  deriveEventRows,
  type DisplayRow,
  EMPTY_EVENTS_FILTER,
  eventNameOptions,
  type EventSortKey,
  filterDisplayRows,
  formatRangeInput,
  groupEventRows,
  isGroupRow,
  parseRangeInput,
  sortDisplayRows,
} from "../src/renderer/src/report/derive/eventsView";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();
const allRows = deriveEventRows(m);
const display = groupEventRows(allRows);

const amountOf = (d: DisplayRow): number =>
  isGroupRow(d) ? (d.kind === "tick-group" ? d.amount : -1) : (d.amount ?? -1);

describe("事件表排序", () => {
  it("默认按时间升序;翻向后严格反向(同秒不乱跳)", () => {
    const asc = sortDisplayRows(display, { key: "time", dir: "asc" });
    const desc = sortDisplayRows(display, { key: "time", dir: "desc" });
    expect(asc.map((d) => d.tS)).toEqual(
      [...asc.map((d) => d.tS)].sort((a, b) => a - b),
    );
    expect(desc.map((d) => d.tS)).toEqual(
      [...desc.map((d) => d.tS)].sort((a, b) => b - a),
    );
    // Not destructive: the caller's array is untouched
    expect(display.length).toBe(asc.length);
  });

  it("按数值排序:降序单调不增,升序单调不减", () => {
    const desc = sortDisplayRows(display, { key: "amount", dir: "desc" }).map(
      amountOf,
    );
    for (let i = 1; i < desc.length; i++)
      expect(desc[i]!).toBeLessThanOrEqual(desc[i - 1]!);
    const asc = sortDisplayRows(display, { key: "amount", dir: "asc" }).map(
      amountOf,
    );
    for (let i = 1; i < asc.length; i++)
      expect(asc[i]!).toBeGreaterThanOrEqual(asc[i - 1]!);
    // HAS TEETH: the fixture must actually contain a spread of amounts,
    // otherwise "monotonic" is vacuously true
    expect(new Set(desc).size).toBeGreaterThan(5);
    expect(desc[0]).toBeGreaterThan(0);
  });

  it("分组行按聚合值参与排序(用户拍板:保留分组)", () => {
    const groups = display.filter(
      (d): d is Extract<DisplayRow, { kind: "tick-group" }> =>
        isGroupRow(d) && d.kind === "tick-group",
    );
    expect(groups.length, "fixture 应含至少一个 tick-group").toBeGreaterThan(0);
    const g = [...groups].sort((a, b) => b.amount - a.amount)[0]!;
    // A group's rank comes from its SUM, so it must sit above every single row
    // whose amount is below that sum.
    const sorted = sortDisplayRows(display, { key: "amount", dir: "desc" });
    const gi = sorted.indexOf(g);
    expect(gi).toBeGreaterThanOrEqual(0);
    for (let i = gi + 1; i < sorted.length; i++)
      expect(amountOf(sorted[i]!)).toBeLessThanOrEqual(g.amount);
    // …and the sum really is bigger than any one of its children (that is the
    // caveat the user accepted: a ×N total competes with single hits)
    expect(g.amount).toBeGreaterThan(
      Math.max(...g.children.map((c) => c.amount ?? 0)),
    );
  });

  it("同键并列时按时间升序打破,且不随排序方向翻转(渲染稳定)", () => {
    for (const dir of ["asc", "desc"] as const) {
      const rows = sortDisplayRows(display, { key: "kind", dir });
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]!;
        const b = rows[i]!;
        const sameKind =
          (isGroupRow(a)
            ? a.kind === "tick-group"
              ? a.rowKind
              : "aura"
            : a.kind) ===
          (isGroupRow(b)
            ? b.kind === "tick-group"
              ? b.rowKind
              : "aura"
            : b.kind);
        if (sameKind) expect(b.tS).toBeGreaterThanOrEqual(a.tS);
      }
    }
  });

  it("每个排序键都返回同样多的行(排序绝不吃行)", () => {
    const keys: EventSortKey[] = [
      "time",
      "kind",
      "src",
      "dest",
      "spell",
      "amount",
    ];
    for (const key of keys)
      for (const dir of ["asc", "desc"] as const)
        expect(
          sortDisplayRows(display, { key, dir }),
          `${key}/${dir}`,
        ).toHaveLength(display.length);
  });
});

describe("事件表按列过滤", () => {
  const f = (over: Partial<typeof EMPTY_EVENTS_FILTER>) =>
    filterDisplayRows(display, { ...EMPTY_EVENTS_FILTER, ...over });

  it("来源与目标是两个独立条件,同时给出即为「只看 A 打 B」", () => {
    const opts = eventNameOptions(allRows);
    expect(opts.src.length).toBeGreaterThan(1);
    const src = opts.src.find((n) =>
      allRows.some((r) => r.srcName === n && r.destName && r.destName !== n),
    )!;
    const dest = allRows.find(
      (r) => r.srcName === src && r.destName !== src,
    )!.destName;
    const onlySrc = f({ srcName: src });
    const onlyDest = f({ destName: dest });
    const both = f({ srcName: src, destName: dest });
    expect(onlySrc.matched).toBeGreaterThan(0);
    expect(onlyDest.matched).toBeGreaterThan(0);
    // AND, not OR — the pair is strictly narrower than either side alone
    expect(both.matched).toBeLessThanOrEqual(onlySrc.matched);
    expect(both.matched).toBeLessThanOrEqual(onlyDest.matched);
    expect(both.matched).toBeGreaterThan(0);
    // …and strictly narrower than at least one of them, or the test proves
    // nothing about AND vs OR
    expect(both.matched).toBeLessThan(onlySrc.matched + onlyDest.matched);
  });

  it("选项表来自实际行,含非玩家单位(宠物/图腾),不是只列玩家", () => {
    const opts = eventNameOptions(allRows);
    const playerNames = new Set(
      Object.values(m.units)
        .filter((u) => u.kind === "Player" && u.info)
        .map((u) => u.name.split("-")[0]!),
    );
    const nonPlayers = [...opts.src, ...opts.dest].filter(
      (n) => !playerNames.has(n),
    );
    expect(nonPlayers.length, "fixture 里应有非玩家来源/目标").toBeGreaterThan(
      0,
    );
    expect([...opts.src]).toEqual(
      [...opts.src].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("数值下限:只留有数值且 ≥ 下限的行;施放/光环/死亡被排除", () => {
    const amounts = allRows
      .map((r) => r.amount)
      .filter((a): a is number => a != null && a > 0)
      .sort((a, b) => a - b);
    const mid = amounts[Math.floor(amounts.length / 2)]!;
    const res = f({ minAmount: mid });
    expect(res.matched).toBeGreaterThan(0);
    expect(res.matched).toBeLessThan(allRows.length);
    for (const d of res.rows) {
      const kids = isGroupRow(d) ? d.children : [d];
      // A group survives if ANY child matches, so assert on the children
      expect(kids.some((c) => (c.amount ?? -1) >= mid)).toBe(true);
    }
    // No amount-free kind survives a numeric floor
    const kindsLeft = new Set(
      res.rows
        .flatMap((d) => (isGroupRow(d) ? d.children : [d]))
        .map((r) => r.kind),
    );
    expect(kindsLeft.has("cast")).toBe(false);
    expect(kindsLeft.has("death")).toBe(false);
  });
});

// agy review finding 2: a tick group renders, and sorts, as its SUM. If the
// amount filter only looked at the children, a row that visibly says 6.0k would
// disappear under "≥ 5000".
describe("分组行的数值过滤看聚合值(与它的排序口径一致)", () => {
  const groupOf = (children: number[]): DisplayRow[] => {
    const base = allRows.find((r) => r.kind === "damage" && r.amount)!;
    const kids = children.map((amount, i) => ({
      ...base,
      tS: 10 + i * 0.5,
      amount,
      detail: String(amount),
    }));
    return groupEventRows(kids);
  };

  it("每跳都低于门槛、但合计过门槛 → 整组仍然显示,计数按行数", () => {
    const display = groupOf([2000, 2000, 2000]);
    expect(display).toHaveLength(1);
    expect(isGroupRow(display[0]!)).toBe(true);
    const res = filterDisplayRows(display, {
      ...EMPTY_EVENTS_FILTER,
      minAmount: 5000,
    });
    // Displayed amount is 6000 ≥ 5000, so the row the user sees must survive
    expect(res.rows).toHaveLength(1);
    expect(res.matched).toBe(3);
  });

  it("合计也不过门槛 → 整组消失", () => {
    const res = filterDisplayRows(groupOf([1000, 1000, 1000]), {
      ...EMPTY_EVENTS_FILTER,
      minAmount: 5000,
    });
    expect(res.rows).toHaveLength(0);
    expect(res.matched).toBe(0);
  });

  it("聚合通道不会绕过其它条件(来源不符仍然滤掉)", () => {
    const res = filterDisplayRows(groupOf([2000, 2000, 2000]), {
      ...EMPTY_EVENTS_FILTER,
      minAmount: 5000,
      srcName: "不存在的名字",
    });
    expect(res.rows).toHaveLength(0);
  });

  it("显示出来的每个分组行,它显示的那个数都过门槛(排序/过滤同一口径)", () => {
    const res = filterDisplayRows(display, {
      ...EMPTY_EVENTS_FILTER,
      minAmount: 5000,
    });
    for (const d of res.rows)
      if (isGroupRow(d) && d.kind === "tick-group")
        expect(d.amount).toBeGreaterThanOrEqual(5000);
  });
});

describe("时间窗输入框", () => {
  it("接受 M:SS 与裸秒,两种写法等价", () => {
    expect(parseRangeInput("0:30-1:10")).toEqual({
      ok: true,
      range: { fromS: 30, toS: 70 },
    });
    expect(parseRangeInput("30-70")).toEqual({
      ok: true,
      range: { fromS: 30, toS: 70 },
    });
    expect(parseRangeInput(" 0:30 - 1:10 ")).toEqual({
      ok: true,
      range: { fromS: 30, toS: 70 },
    });
  });

  it("端点写反了就对调,不报错", () => {
    expect(parseRangeInput("1:10-0:30")).toEqual({
      ok: true,
      range: { fromS: 30, toS: 70 },
    });
  });

  it("空 = 清除窗口;半截输入 = 不合法(而不是清空)", () => {
    expect(parseRangeInput("")).toEqual({ ok: true, range: null });
    expect(parseRangeInput("   ")).toEqual({ ok: true, range: null });
    // These two must be distinguishable, or typing blanks the table mid-keystroke
    expect(parseRangeInput("0:3")).toEqual({ ok: false });
    expect(parseRangeInput("0:30-")).toEqual({ ok: false });
    expect(parseRangeInput("abc")).toEqual({ ok: false });
  });

  it("格式化 ⇄ 解析往返一致", () => {
    for (const r of [
      { fromS: 0, toS: 5 },
      { fromS: 30, toS: 70 },
      { fromS: 125, toS: 610 },
    ]) {
      const round = parseRangeInput(formatRangeInput(r));
      expect(round).toEqual({ ok: true, range: r });
    }
    expect(formatRangeInput(null)).toBe("");
  });
});
