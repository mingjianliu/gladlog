# 战报明细 breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** meters 行点击展开该玩家当前模式的按技能/来源分解表(总量/占比/次数/暴击%/最大一击,治疗含过量%)。

**Architecture:** parser 导出单源尾参解码 `decodeHpTail`(parseLine 三处切片改用同一函数);renderer 纯派生 `deriveDetailBreakdown` 直接聚合 native 事件数组并与 summary 口径对账;`Meters` 加 expandedUnitId 局部 state 内嵌 `BreakdownTable`。

**Tech Stack:** TS + React,vitest;无新依赖。

## Global Constraints

- 分解合计必须 === `meterValue` 同模式口径(damage=damageDone,healing=healingDone+absorbsDone,taken=damageTaken),单测断言。
- 暴击解码只在 parser 单源(`decodeHpTail`),renderer 不抄偏移逻辑;params 缺席 → critPct null → `critAvailable=false` → 列隐藏。
- parseLine 重构为等价改写:parser 既有测试与输出不得变化。
- push 前门禁(repo 根):`npm test --workspace=packages/desktop && npm test --workspace=packages/parser && npm run typecheck && npx eslint packages/desktop/src --quiet`。

---

### Task 1: parser `decodeHpTail`(单源尾参解码 + parseLine 改造)

**Files:**

- Modify: `packages/parser/src/l1/decoders.ts`(尾部新增)
- Modify: `packages/parser/src/l1/parseLine.ts:73-95`(三处切片改调 helper)
- Modify: `packages/parser/src/index.ts`(导出)
- Test: `packages/parser/test/decodeHpTail.test.ts`(新)

**Interfaces:**

- Consumes: 既有 `decodeDamage(tailParams)` / `decodeHeal(tailParams)`(同文件)。
- Produces(Task 2 依赖,逐字):

```ts
export function decodeHpTail(
  eventName: string,
  params: string[],
): { critical: boolean; amount: number; effectiveAmount: number } | null;
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/parser/test/decodeHpTail.test.ts
import { describe, expect, it } from "vitest";
import { decodeHpTail } from "../src/l1/decoders";

// 非 advanced SPELL_DAMAGE 尾参 10 个:amount,base,overkill,school,resisted,
// blocked,absorbed,critical,glancing,crushing(parseLine slice(-10) 分支)
const base8 = ["g1", "A", "0x511", "0x0", "g2", "B", "0x10548", "0x0"];
const spell3 = ["116", "Frostbolt", "0x10"];

describe("decodeHpTail", () => {
  it("SPELL_DAMAGE(非 advanced):amount/critical 解出", () => {
    const params = [
      ...base8,
      ...spell3,
      "38000",
      "36000",
      "0",
      "16",
      "0",
      "0",
      "0",
      "1",
      "nil",
      "nil",
    ];
    const r = decodeHpTail("SPELL_DAMAGE", params);
    expect(r).toEqual({
      critical: true,
      amount: 38000,
      effectiveAmount: 38000,
    });
  });

  it("SPELL_PERIODIC_DAMAGE 非暴击 + overkill 扣减", () => {
    const params = [
      ...base8,
      ...spell3,
      "9000",
      "9000",
      "2000",
      "16",
      "0",
      "0",
      "0",
      "nil",
      "nil",
      "nil",
    ];
    const r = decodeHpTail("SPELL_PERIODIC_DAMAGE", params);
    expect(r).toEqual({ critical: false, amount: 9000, effectiveAmount: 7000 });
  });

  it("SPELL_HEAL:尾 5 参,overheal 扣减", () => {
    const params = [...base8, ...spell3, "20000", "20000", "5000", "0", "1"];
    const r = decodeHpTail("SPELL_HEAL", params);
    expect(r).toEqual({
      critical: true,
      amount: 20000,
      effectiveAmount: 15000,
    });
  });

  it("非 hp 事件与参数不足 → null", () => {
    expect(
      decodeHpTail("SPELL_CAST_SUCCESS", [...base8, ...spell3]),
    ).toBeNull();
    expect(decodeHpTail("SPELL_DAMAGE", ["1", "2"])).toBeNull();
    expect(decodeHpTail("SPELL_HEAL", [])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/parser -- decodeHpTail`
Expected: FAIL — decodeHpTail 未导出。

- [ ] **Step 3: 实现 decodeHpTail 并改造 parseLine**

`decoders.ts` 尾部追加(切片规则从 parseLine 原样搬入,此后单源):

```ts
/** damage/heal 事件的尾参切片规则(单源:parseLine 与消费方共用)。 */
export function hpTailSlice(
  eventName: string,
  params: string[],
): { kind: "damage" | "heal"; tail: string[] } | null {
  if (eventName.endsWith("_HEAL")) {
    if (params.length < 5) return null;
    return { kind: "heal", tail: params.slice(-5) };
  }
  const isSwing =
    eventName === "SWING_DAMAGE" || eventName === "SWING_DAMAGE_LANDED";
  if (!isSwing && !eventName.endsWith("_DAMAGE")) return null;
  if (params.length < 10) return null;
  const at = isSwing ? 8 : 11;
  const xIdx = findXIdx(params, at);
  const tail =
    params.length - (xIdx + 5) >= 11 ? params.slice(-11) : params.slice(-10);
  return { kind: "damage", tail };
}

/**
 * 从完整 params 解码 damage/heal 尾参(明细 breakdown 的暴击/量值单源入口)。
 * 非 hp 事件或参数不足 → null(裁剪 doc 无 params 时消费方自行传 [] 得 null)。
 */
export function decodeHpTail(
  eventName: string,
  params: string[],
): { critical: boolean; amount: number; effectiveAmount: number } | null {
  const sliced = hpTailSlice(eventName, params);
  if (!sliced) return null;
  const d =
    sliced.kind === "heal"
      ? decodeHeal(sliced.tail)
      : decodeDamage(sliced.tail);
  return {
    critical: d.critical,
    amount: d.amount,
    effectiveAmount: d.effectiveAmount,
  };
}
```

注:`findXIdx` 目前在 parseLine.ts —— 把它**移动**到 decoders.ts(export),parseLine `import { findXIdx }`;或反向让 hpTailSlice 留在 parseLine 导出。二选一,以循环依赖为准(decoders 不 import parseLine → 移 findXIdx 到 decoders)。

parseLine.ts 三处改造(等价改写):

```ts
// SWING_DAMAGE / SWING_DAMAGE_LANDED 分支:
result.advanced = decodeAdvanced(params, 8);
const swingTail = hpTailSlice(eventName, params);
if (swingTail) result.damage = decodeDamage(swingTail.tail);

// endsWith("_DAMAGE") 分支:
result.advanced = decodeAdvanced(params, 11);
const dmgTail = hpTailSlice(eventName, params);
if (dmgTail) result.damage = decodeDamage(dmgTail.tail);

// endsWith("_HEAL") 分支:
result.advanced = decodeAdvanced(params, 11);
const healTail = hpTailSlice(eventName, params);
if (healTail) result.heal = decodeHeal(healTail.tail);
```

`packages/parser/src/index.ts` 的 decoders 导出块追加 `decodeHpTail, hpTailSlice`。

- [ ] **Step 4: 跑 parser 全测试(等价性)**

Run: `npm test --workspace=packages/parser`
Expected: 新测试 4 过 + 既有全绿(切片行为未变)。

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src packages/parser/test/decodeHpTail.test.ts
git commit -m "feat(parser): decodeHpTail/hpTailSlice 导出 —— hp 尾参解码单源,parseLine 改用同一切片"
```

---

### Task 2: `derive/detailBreakdown.ts`(聚合 + 对账)

**Files:**

- Create: `packages/desktop/src/renderer/src/report/derive/detailBreakdown.ts`
- Test: `packages/desktop/test/report.detailbreakdown.test.ts`(新)

**Interfaces:**

- Consumes: Task 1 `decodeHpTail(eventName, params)`(`@gladlog/parser`);`deriveSummary`/`meterValue`(对账测试用);`ReportSource`(`./types`)。
- Produces(Task 3 依赖,逐字):

```ts
export interface BreakdownRow {
  key: string;
  label: string;
  spellId: string;
  total: number;
  sharePct: number;
  hits: number;
  maxHit: number;
  critPct: number | null;
  overhealPct?: number;
  isAbsorb?: boolean;
}
export function deriveDetailBreakdown(
  source: ReportSource,
  unitId: string,
  mode: "damage" | "healing" | "taken",
): { rows: BreakdownRow[]; critAvailable: boolean };
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/desktop/test/report.detailbreakdown.test.ts
import { describe, expect, it } from "vitest";

import { deriveDetailBreakdown } from "../src/renderer/src/report/derive/detailBreakdown";
import { meterValue } from "../src/renderer/src/report/derive/meterRows";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();
const src = base as unknown as ReportSource;

describe("deriveDetailBreakdown", () => {
  it("三模式合计对账 meterValue(全玩家)", () => {
    for (const t of deriveSummary(src)) {
      for (const mode of ["damage", "healing", "taken"] as const) {
        const { rows } = deriveDetailBreakdown(src, t.unitId, mode);
        const sum = rows.reduce((a, r) => a + r.total, 0);
        expect(Math.round(sum)).toBe(Math.round(meterValue(t, mode)));
      }
    }
  });

  it("damage:按 total 降序,share 合计≈100,hits/maxHit 有值", () => {
    const t = deriveSummary(src)[0]!; // 输出最高者
    const { rows } = deriveDetailBreakdown(src, t.unitId, "damage");
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i]!.total).toBeLessThanOrEqual(rows[i - 1]!.total);
    const share = rows.reduce((a, r) => a + r.sharePct, 0);
    expect(share).toBeGreaterThan(99);
    expect(share).toBeLessThan(101);
    expect(rows[0]!.hits).toBeGreaterThan(0);
    expect(rows[0]!.maxHit).toBeGreaterThan(0);
  });

  it("裁剪 fixture 无 params → critAvailable=false", () => {
    const t = deriveSummary(src)[0]!;
    const { critAvailable, rows } = deriveDetailBreakdown(
      src,
      t.unitId,
      "damage",
    );
    expect(critAvailable).toBe(false);
    expect(rows.every((r) => r.critPct === null)).toBe(true);
  });

  it("注入带 params 的合成伤害 → critPct 正确(2 暴击/4 次=50%)", () => {
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    const u = Object.values(clone.units).find(
      (x) => (x as { kind?: string }).kind === "Player",
    ) as unknown as {
      id: string;
      damageOut: Array<Record<string, unknown>>;
    };
    const base8 = ["g1", "A", "0x511", "0x0", "g2", "B", "0x10548", "0x0"];
    const spell3 = ["999001", "TestBolt", "0x10"];
    const mk = (crit: boolean) => ({
      timestamp: clone.startTime + 1000,
      eventName: "SPELL_DAMAGE",
      spellId: 999001,
      spellName: "TestBolt",
      srcId: u.id,
      srcName: "A",
      destId: "g2",
      destName: "B",
      amount: 1000,
      effectiveAmount: 1000,
      params: [
        ...base8,
        ...spell3,
        "1000",
        "1000",
        "0",
        "16",
        "0",
        "0",
        "0",
        crit ? "1" : "nil",
        "nil",
        "nil",
      ],
    });
    u.damageOut.push(mk(true), mk(true), mk(false), mk(false));
    const { rows, critAvailable } = deriveDetailBreakdown(
      clone as unknown as ReportSource,
      u.id,
      "damage",
    );
    const row = rows.find((r) => r.spellId === "999001");
    expect(critAvailable).toBe(true);
    expect(row!.critPct).toBe(50);
    expect(row!.hits).toBe(4);
    expect(row!.maxHit).toBe(1000);
  });

  it("healing:absorbsOut 出 isAbsorb 行,过量% 界内", () => {
    const healer = deriveSummary(src)
      .slice()
      .sort(
        (a, b) =>
          b.healingDone + b.absorbsDone - (a.healingDone + a.absorbsDone),
      )[0]!;
    const { rows } = deriveDetailBreakdown(src, healer.unitId, "healing");
    for (const r of rows) {
      if (r.overhealPct !== undefined) {
        expect(r.overhealPct).toBeGreaterThanOrEqual(0);
        expect(r.overhealPct).toBeLessThanOrEqual(100);
      }
      if (r.isAbsorb) expect(r.overhealPct).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/report.detailbreakdown.test.ts --root packages/desktop`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```ts
// packages/desktop/src/renderer/src/report/derive/detailBreakdown.ts
import { decodeHpTail } from "@gladlog/parser";

import type { ReportSource } from "./types";

export interface BreakdownRow {
  key: string;
  label: string;
  spellId: string;
  total: number;
  sharePct: number;
  hits: number;
  maxHit: number;
  critPct: number | null;
  overhealPct?: number;
  isAbsorb?: boolean;
}

interface HpEventLike {
  eventName?: string;
  spellId?: number | string;
  spellName?: string;
  srcName?: string;
  amount?: number;
  effectiveAmount?: number;
  params?: string[];
}
interface AbsorbEventLike {
  spellId?: number | string;
  spellName?: string;
  absorbedAmount?: number;
}
interface UnitLike {
  id: string;
  name: string;
  ownerId?: string;
  damageOut?: HpEventLike[];
  damageIn?: HpEventLike[];
  healOut?: HpEventLike[];
  absorbsOut?: AbsorbEventLike[];
}

interface Acc {
  label: string;
  spellId: string;
  total: number;
  totalRaw: number; // amount 合计(healing 过量%用)
  hits: number;
  maxHit: number;
  crits: number;
  critKnown: number; // params 可解码的事件数
  isAbsorb?: boolean;
}

const acc = (
  map: Map<string, Acc>,
  key: string,
  seed: Pick<Acc, "label" | "spellId"> & Partial<Pick<Acc, "isAbsorb">>,
): Acc => {
  let a = map.get(key);
  if (!a) {
    a = {
      ...seed,
      total: 0,
      totalRaw: 0,
      hits: 0,
      maxHit: 0,
      crits: 0,
      critKnown: 0,
    };
    map.set(key, a);
  }
  return a;
};

function addHp(a: Acc, e: HpEventLike): void {
  const eff = e.effectiveAmount ?? 0;
  a.total += eff;
  a.totalRaw += e.amount ?? eff;
  a.hits += 1;
  a.maxHit = Math.max(a.maxHit, eff);
  // 暴击单源:parser decodeHpTail;params 缺席(旧/裁剪 doc)→ 不计入 critKnown
  const tail = decodeHpTail(e.eventName ?? "", e.params ?? []);
  if (tail) {
    a.critKnown += 1;
    if (tail.critical) a.crits += 1;
  }
}

/**
 * 战报明细 breakdown(backlog #11 / spec 2026-07-18-report-detail-breakdown):
 * 与 derive/summary 同事件源同求和口径 —— 分解合计恒等于 meterValue。
 */
export function deriveDetailBreakdown(
  source: ReportSource,
  unitId: string,
  mode: "damage" | "healing" | "taken",
): { rows: BreakdownRow[]; critAvailable: boolean } {
  const units = Object.values(source.units) as unknown as UnitLike[];
  const self = units.find((u) => u.id === unitId);
  if (!self) return { rows: [], critAvailable: false };
  const pets = units.filter((u) => u.ownerId === unitId);
  const map = new Map<string, Acc>();

  if (mode === "taken") {
    for (const e of self.damageIn ?? []) {
      const src = (e.srcName ?? "?").split("-")[0];
      const key = `${e.srcName}:${e.spellId}`;
      addHp(
        acc(map, key, {
          label: `${src}:${e.spellName || "近战"}`,
          spellId: String(e.spellId ?? 0),
        }),
        e,
      );
    }
  } else {
    const own = [{ unit: self, prefix: "" }].concat(
      pets.map((p) => ({ unit: p, prefix: `${p.name.split("-")[0]}:` })),
    );
    for (const { unit, prefix } of own) {
      const events =
        mode === "damage" ? (unit.damageOut ?? []) : (unit.healOut ?? []);
      for (const e of events) {
        const key = `${prefix}${e.spellId}`;
        addHp(
          acc(map, key, {
            label: `${prefix}${e.spellName || "近战"}`,
            spellId: String(e.spellId ?? 0),
          }),
          e,
        );
      }
      if (mode === "healing") {
        for (const e of unit.absorbsOut ?? []) {
          const key = `ab:${prefix}${e.spellId}`;
          const a = acc(map, key, {
            label: `${prefix}${e.spellName || "吸收"}`,
            spellId: String(e.spellId ?? 0),
            isAbsorb: true,
          });
          const amt = e.absorbedAmount ?? 0;
          a.total += amt;
          a.totalRaw += amt;
          a.hits += 1;
          a.maxHit = Math.max(a.maxHit, amt);
        }
      }
    }
  }

  const grand = [...map.values()].reduce((s, a) => s + a.total, 0) || 1;
  const rows: BreakdownRow[] = [...map.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      spellId: a.spellId,
      total: a.total,
      sharePct: (a.total / grand) * 100,
      hits: a.hits,
      maxHit: a.maxHit,
      critPct:
        a.critKnown > 0 ? Math.round((a.crits / a.critKnown) * 100) : null,
      ...(mode === "healing" && !a.isAbsorb
        ? {
            overhealPct:
              a.totalRaw > 0
                ? Math.round(((a.totalRaw - a.total) / a.totalRaw) * 100)
                : 0,
          }
        : {}),
      ...(a.isAbsorb ? { isAbsorb: true as const } : {}),
    }))
    .sort((a, b) => b.total - a.total);
  return { rows, critAvailable: rows.some((r) => r.critPct !== null) };
}
```

- [ ] **Step 4: 跑测试通过**

Run: `npx vitest run test/report.detailbreakdown.test.ts --root packages/desktop`
Expected: PASS(5 tests)。对账测试挂 → 找聚合口径遗漏(如 healing 漏 absorbs 或宠物),**不许改对账断言**。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/src/report/derive/detailBreakdown.ts packages/desktop/test/report.detailbreakdown.test.ts
git commit -m "feat(desktop): deriveDetailBreakdown —— 按技能/来源聚合,合计与 meterValue 对账"
```

---

### Task 3: `BreakdownTable` + Meters 行内展开

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/BreakdownTable.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/Meters.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/MatchReport.tsx:99-109`(Meters 传 source)
- Modify: `packages/desktop/src/renderer/src/styles.css`(尾部追加)
- Test: `packages/desktop/test/report.breakdowntable.test.tsx`(新)

**Interfaces:**

- Consumes: Task 2 `deriveDetailBreakdown(source, unitId, mode)` / `BreakdownRow`;`SPELL_ICONS_GENERATED`(`@gladlog/analysis`);`SpellIcon({icon, label, size})`。
- Produces: `BreakdownTable({ rows, critAvailable, mode })`;`Meters` 新可选 props `source?: ReportSource`(未传 → 无展开能力,旧调用不破)。

- [ ] **Step 1: 写失败测试**

```tsx
// packages/desktop/test/report.breakdowntable.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Meters } from "../src/renderer/src/report/components/Meters";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const src = loadRealMatchFixture() as unknown as ReportSource;
const rows = deriveSummary(src);

describe("Meters 行内明细展开(backlog #11)", () => {
  it("点行主体展开分解表,再点收起;同时只展开一人", () => {
    const { container } = render(
      <Meters rows={rows} mode="damage" source={src} />,
    );
    const bars = container.querySelectorAll(".rpt-meter-clickable");
    expect(bars.length).toBeGreaterThan(1);
    fireEvent.click(bars[0]!);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(1);
    // 展开表有技能行
    expect(
      container.querySelectorAll(".rpt-breakdown tbody tr").length,
    ).toBeGreaterThan(0);
    fireEvent.click(bars[1]!);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(1);
    fireEvent.click(bars[1]!);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(0);
  });

  it("裁剪 fixture 无 params → 无暴击列;>8 行折叠为「其余 N 个」", () => {
    const { container } = render(
      <Meters rows={rows} mode="damage" source={src} />,
    );
    fireEvent.click(container.querySelectorAll(".rpt-meter-clickable")[0]!);
    expect(screen.queryByText("暴击")).toBeNull();
    const trs = container.querySelectorAll(".rpt-breakdown tbody tr");
    expect(trs.length).toBeLessThanOrEqual(9); // 8 + 可能的折叠行
  });

  it("名字按钮仍是隐藏切换,不触发展开", () => {
    const toggled: string[] = [];
    const { container } = render(
      <Meters
        rows={rows}
        mode="damage"
        source={src}
        onToggleUnit={(id) => toggled.push(id)}
      />,
    );
    fireEvent.click(container.querySelector(".rpt-meter-name")!);
    expect(toggled).toHaveLength(1);
    expect(container.querySelectorAll(".rpt-breakdown")).toHaveLength(0);
  });

  it("未传 source(旧调用形态)→ 行不可展开不报错", () => {
    const { container } = render(<Meters rows={rows} mode="damage" />);
    expect(container.querySelectorAll(".rpt-meter-clickable")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/report.breakdowntable.test.tsx --root packages/desktop`
Expected: FAIL — rpt-meter-clickable 不存在 / source prop 未知。

- [ ] **Step 3: 实现 BreakdownTable**

```tsx
// packages/desktop/src/renderer/src/report/components/BreakdownTable.tsx
import { SPELL_ICONS_GENERATED } from "@gladlog/analysis";

import type { BreakdownRow } from "../derive/detailBreakdown";
import { SpellIcon } from "./SpellIcon";

const TOP_N = 8;
const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** meters 行内的按技能/来源分解表(spec 2026-07-18-report-detail-breakdown)。 */
export function BreakdownTable({
  rows,
  critAvailable,
  mode,
}: {
  rows: BreakdownRow[];
  critAvailable: boolean;
  mode: "damage" | "healing" | "taken";
}) {
  if (rows.length === 0)
    return <div className="rpt-breakdown rpt-breakdown-empty">无数据</div>;
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const restTotal = rest.reduce((a, r) => a + r.total, 0);
  const restShare = rest.reduce((a, r) => a + r.sharePct, 0);
  const showOverheal = mode === "healing";
  return (
    <table className="rpt-breakdown">
      <thead>
        <tr>
          <th>技能</th>
          <th>总量</th>
          <th>占比</th>
          <th>次数</th>
          {critAvailable && <th>暴击</th>}
          {showOverheal && <th>过量</th>}
          <th>最大一击</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.key}>
            <td className="rpt-breakdown-spell">
              <SpellIcon
                icon={SPELL_ICONS_GENERATED[r.spellId]}
                label={r.label}
              />{" "}
              {r.label}
              {r.isAbsorb && <span className="rpt-breakdown-tag">吸收</span>}
            </td>
            <td>{fmt(r.total)}</td>
            <td>{r.sharePct.toFixed(0)}%</td>
            <td>{r.hits}</td>
            {critAvailable && (
              <td>{r.critPct !== null ? `${r.critPct}%` : "—"}</td>
            )}
            {showOverheal && (
              <td>{r.overhealPct !== undefined ? `${r.overhealPct}%` : "—"}</td>
            )}
            <td>{fmt(r.maxHit)}</td>
          </tr>
        ))}
        {rest.length > 0 && (
          <tr className="rpt-breakdown-rest">
            <td>其余 {rest.length} 个(合计)</td>
            <td>{fmt(restTotal)}</td>
            <td>{restShare.toFixed(0)}%</td>
            <td
              colSpan={2 + (critAvailable ? 1 : 0) + (showOverheal ? 1 : 0)}
            />
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Meters 展开接线**

Meters.tsx 改动(props 加 `source?: ReportSource`;行主体 clickable;单开 state):

```tsx
// import 区追加
import { useState } from "react";
import { deriveDetailBreakdown } from "../derive/detailBreakdown";
import type { ReportSource } from "../derive/types";
import { BreakdownTable } from "./BreakdownTable";

// props 追加(解构 + 类型):
//   /** 明细展开数据源(backlog #11);未传则行不可展开(旧调用形态)。 */
//   source?: ReportSource;

// 组件体内:
const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
const expandable = source != null && mode !== "stats";

// items.map 内,原 <div className="rpt-meter-row"> 的 bar+value 部分包一层:
// (name button 原样保留在外面;点击 bar/value 切换展开)
<span
  className={
    expandable ? "rpt-meter-body rpt-meter-clickable" : "rpt-meter-body"
  }
  onClick={
    expandable
      ? () => setExpandedUnitId((cur) => (cur === r.unitId ? null : r.unitId))
      : undefined
  }
>
  <span className="rpt-meter-bar-track">
    <span
      className="rpt-meter-bar"
      style={{ width: `${r.widthPct}%`, background: r.color }}
    />
  </span>
  <span className="rpt-meter-value">{r.label}</span>
</span>;
// 行后(仍在该 unit 的外层 fragment 内):
{
  expandable && expandedUnitId === r.unitId && (
    <BreakdownTable
      {...deriveDetailBreakdown(
        source,
        r.unitId,
        mode as "damage" | "healing" | "taken",
      )}
      mode={mode as "damage" | "healing" | "taken"}
    />
  );
}
```

外层 map 需把 `<div className="rpt-meter-row">…</div>` 与展开表包进 `<div key={r.unitId} className="rpt-meter-unit">`(key 从行移到包裹层)。模式切换时收起:`useEffect(() => setExpandedUnitId(null), [mode])`。

MatchReport.tsx 的 `<Meters … />` 调用追加 `source={source}`(ShuffleReport 若有独立调用同样追加;grep `<Meters` 确认全部调用点)。

- [ ] **Step 5: CSS(styles.css 尾部追加)**

```css
/* ── 战报明细 breakdown(meters 行内展开)── */
.rpt-meter-body {
  display: contents;
}
.rpt-meter-clickable {
  cursor: pointer;
}
.rpt-meter-unit .rpt-meter-clickable:hover .rpt-meter-value {
  color: var(--gold);
}
.rpt-breakdown {
  width: 100%;
  margin: 4px 0 10px;
  border-collapse: collapse;
  font-size: 12px;
}
.rpt-breakdown th {
  text-align: left;
  color: var(--mute);
  font-weight: 500;
  padding: 2px 8px;
  border-bottom: 1px solid var(--hairline);
}
.rpt-breakdown td {
  padding: 3px 8px;
  border-bottom: 1px solid var(--hairline-soft);
  font-variant-numeric: tabular-nums;
}
.rpt-breakdown-spell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rpt-breakdown-tag {
  font-size: 10px;
  color: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 3px;
  padding: 0 4px;
}
.rpt-breakdown-rest td {
  color: var(--mute);
}
.rpt-breakdown-empty {
  color: var(--mute);
  font-size: 12px;
  padding: 4px 8px;
}
```

注:`.rpt-meter-row` 目前是 flex 行 —— `rpt-meter-body { display: contents }` 让包裹 span 不破坏原布局;若实现时布局塌陷,改为把 body 设成 `display:flex; flex:1; align-items:center; gap:同原行` 并微调。

- [ ] **Step 6: 跑测试 + 全门禁**

Run(repo 根): `npx vitest run test/report.breakdowntable.test.tsx --root packages/desktop`,然后
`npm test --workspace=packages/desktop && npm test --workspace=packages/parser && npm run typecheck && npx eslint packages/desktop/src --quiet`
Expected: 新 4 测全过;既有 Meters/report 测试不回归(行结构变动若破坏既有断言,按新 DOM 更新断言,不许砍功能)。

- [ ] **Step 7: Commit + push + CI**

```bash
git add -A ':!package-lock.json'
git commit -m "feat(desktop): 战报明细 breakdown —— meters 行内展开按技能/来源分解(backlog #11)"
git push
RUN=$(gh run list --workflow test.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status $RUN
```

Expected: CI success。

---

## Self-Review 记录

- Spec 覆盖:decodeHpTail 单源(T1)、三模式聚合+对账+暴击/过量(T2)、行内展开/单开/名字按钮隔离/折叠行/列隐藏(T3)✓;「stats 模式不变」= expandable 排除 stats ✓;ShuffleReport 复用 = 调用点 grep ✓。
- 占位符扫描:无 TBD;CSS 塌陷备选方案是明确指令非留白 ✓。
- 类型一致:BreakdownRow/deriveDetailBreakdown/BreakdownTable/`source?: ReportSource` 三处一致 ✓。
