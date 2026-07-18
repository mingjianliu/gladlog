# AI 分析页「关键时刻轴」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 分析页改为「纵向关键时刻轴」单列叙事布局:系统关键事件与 AI finding 卡按时间交错挂在中央脊柱上,cohort 对比下沉全宽。

**Architecture:** 新纯函数 `derive/keyMoments.ts`(toLegacySafe → analysis 谓词,五类事件,单类失败不拖垮)+ 新组件 `KeyMomentAxis.tsx`(归并/交错/省略标/点跳);`StructuredAnalysisPanel` 以轴替换横向 TimelineStrip,`MatchReport` 取消右栏。

**Tech Stack:** React + TS(Electron renderer),vitest + @testing-library/react,谓词全部来自 `@gladlog/analysis` 既有导出。

## Global Constraints

- 谓词单源:不新写任何分析逻辑,只组合 `@gladlog/analysis` 导出(spec 表格口径)。
- renderer 从 `src/main/*` 只能 type-only import(v0.0.4 构建事故铁律)。
- 每类事件来源独立 try/catch(candidateFindings 先例);裁剪 fixture 缺事件数组不得抛(必须走 `toLegacySafe`)。
- 时间单位:derive 输出 = 相对秒;`onSeekEvent(tSeconds, unitNames)` 契约不变。
- push 前门禁:`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`(在 repo 根目录跑)。

---

### Task 1: `derive/keyMoments.ts`(五类关键事件派生)

**Files:**

- Create: `packages/desktop/src/renderer/src/report/derive/keyMoments.ts`
- Test: `packages/desktop/test/report.keymoments.test.ts`

**Interfaces:**

- Consumes: `toLegacySafe`(`./legacySource`);`@gladlog/analysis` 的 `analyzeBurstLedger, isBurstConverted, reconstructEnemyCDTimeline, extractMajorCooldowns, analyzePlayerCCAndTrinket, reconstructDispelSummary, isHealerSpec, trinketSpellIds`;`@gladlog/parser-compat` 的 `CombatUnitReaction`。
- Produces(Task 2/3 依赖,签名逐字):

```ts
export type KeyMomentKind =
  "death" | "burst-band" | "defensive" | "dispel" | "cc";
export interface KeyMoment {
  t: number; // 相对秒
  toT?: number; // burst-band 专用
  kind: KeyMomentKind;
  side: "friendly" | "enemy";
  title: string;
  detail?: string;
  unitNames: string[];
  jumpT: number;
}
export function deriveKeyMoments(
  source: ReportSource,
  ownerId?: string,
): KeyMoment[];
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/desktop/test/report.keymoments.test.ts
import { describe, expect, it } from "vitest";
import realMatch from "./fixtures/real-match-sample.json";
import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import type { ReportSource } from "../src/renderer/src/report/derive/types";

const src = realMatch as unknown as ReportSource;

describe("deriveKeyMoments", () => {
  it("裁剪 fixture 不抛,输出按 t 升序", () => {
    const ms = deriveKeyMoments(src);
    expect(Array.isArray(ms)).toBe(true);
    for (let i = 1; i < ms.length; i++)
      expect(ms[i].t).toBeGreaterThanOrEqual(ms[i - 1].t);
  });

  it("注入死亡 → 产出 death 节点(side=friendly)", () => {
    const clone = structuredClone(src) as any;
    const friendly = Object.values(clone.units).find(
      (u: any) => u.info && u.reaction === 1,
    ) as any;
    friendly.deathRecords = [
      {
        timestamp: clone.startTime + 42_000,
        logLine: {
          event: "UNIT_DIED",
          timestamp: clone.startTime + 42_000,
          parameters: [],
        },
      },
    ];
    const ms = deriveKeyMoments(clone as ReportSource);
    const death = ms.find((m) => m.kind === "death" && m.side === "friendly");
    expect(death).toBeTruthy();
    expect(Math.round(death!.t)).toBe(42);
    expect(death!.unitNames[0]).toBe(friendly.name);
  });

  it("注入饰品施法 → 产出 defensive 节点", () => {
    const clone = structuredClone(src) as any;
    const friendly = Object.values(clone.units).find(
      (u: any) => u.info && u.reaction === 1,
    ) as any;
    friendly.spellCastEvents = [
      ...(friendly.spellCastEvents ?? []),
      {
        spellId: "336126",
        spellName: "Gladiator's Medallion",
        timestamp: clone.startTime + 30_000,
        srcUnitId: friendly.id,
        destUnitId: friendly.id,
        destUnitName: friendly.name,
        logLine: {
          event: "SPELL_CAST_SUCCESS",
          timestamp: clone.startTime + 30_000,
          parameters: [],
        },
      },
    ];
    const ms = deriveKeyMoments(clone as ReportSource);
    expect(
      ms.some((m) => m.kind === "defensive" && m.title.includes("饰品")),
    ).toBe(true);
  });
});
```

注:`reaction === 1` 若与 fixture 实际枚举值不符,以 `CombatUnitReaction.Friendly` 导入比较(实现文件同款);deathRecords 注入参照 `report.deathrecap.test` 既有先例的字段形状,以现有测试为准微调。

- [ ] **Step 2: 跑测试确认失败**

Run(repo 根): `npx vitest run test/report.keymoments.test.ts --root packages/desktop`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 deriveKeyMoments**

```ts
// packages/desktop/src/renderer/src/report/derive/keyMoments.ts
import {
  analyzeBurstLedger,
  analyzePlayerCCAndTrinket,
  extractMajorCooldowns,
  isBurstConverted,
  isHealerSpec,
  reconstructDispelSummary,
  reconstructEnemyCDTimeline,
  trinketSpellIds,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

export type KeyMomentKind =
  "death" | "burst-band" | "defensive" | "dispel" | "cc";

export interface KeyMoment {
  t: number;
  toT?: number;
  kind: KeyMomentKind;
  side: "friendly" | "enemy";
  title: string;
  detail?: string;
  unitNames: string[];
  jumpT: number;
}

const TRINKETS = new Set<string>(trinketSpellIds);
const CC_MIN_S = 3;

/**
 * 关键时刻轴数据(spec: 2026-07-18-ai-analysis-key-moment-axis-design)。
 * 五类事件,谓词全部复用 analysis;每类独立 try/catch,单类失败不拖垮。
 */
export function deriveKeyMoments(
  source: ReportSource,
  ownerId?: string,
): KeyMoment[] {
  const out: KeyMoment[] = [];
  let legacy: ReturnType<typeof toLegacySafe>;
  try {
    legacy = toLegacySafe(source);
  } catch {
    return out;
  }
  const start = legacy.startTime;
  const rel = (ms: number) => (ms - start) / 1000;
  const units = Object.values(legacy.units);
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  const petsOf = (side: typeof friends) => {
    const ids = new Set(side.map((u) => u.id));
    return units.filter((u) => u.ownerId && ids.has(u.ownerId));
  };
  const friendlyPets = petsOf(friends);
  const enemyPets = petsOf(enemies);
  const owner =
    (ownerId && players.find((u) => u.id === ownerId)) ||
    players.find((u) => u.id === legacy.playerId) ||
    friends[0];

  // death
  try {
    for (const u of players) {
      for (const d of u.deathRecords ?? []) {
        const side =
          u.reaction === CombatUnitReaction.Friendly ? "friendly" : "enemy";
        out.push({
          t: rel(d.timestamp),
          kind: "death",
          side,
          title: side === "friendly" ? "阵亡" : "击杀",
          unitNames: [u.name],
          jumpT: rel(d.timestamp),
        });
      }
    }
  } catch {
    /* 单类失败不拖垮 */
  }

  // burst-band:我方 = owner 爆发账本;敌方 = aligned burst windows
  try {
    if (owner && !isHealerSpec(owner.spec)) {
      const allies = friends.filter((u) => u.id !== owner.id);
      for (const b of analyzeBurstLedger(owner, allies, enemies, legacy)) {
        const t = b.dominantTarget;
        const converted = t !== null && isBurstConverted(t);
        out.push({
          t: b.fromSeconds,
          toT: b.toSeconds,
          kind: "burst-band",
          side: "friendly",
          title: converted ? "爆发(已转化)" : "爆发(未转化)",
          detail: t
            ? `${(t.damage / 1_000_000).toFixed(2)}M on ${t.unitName.split("-")[0]}`
            : undefined,
          unitNames: [owner.name, ...(t ? [t.unitName] : [])],
          jumpT: b.fromSeconds,
        });
      }
    }
  } catch {
    /* 同上 */
  }
  try {
    const tl = reconstructEnemyCDTimeline(enemies, legacy, owner, friends);
    for (const w of tl.alignedBurstWindows) {
      out.push({
        t: w.fromSeconds,
        toT: w.toSeconds,
        kind: "burst-band",
        side: "enemy",
        title: "敌方爆发",
        detail: w.activeCDs.map((c) => c.spellName).join(" + "),
        unitNames: [...new Set(w.activeCDs.map((c) => c.playerName))],
        jumpT: w.fromSeconds,
      });
    }
  } catch {
    /* 同上 */
  }

  // defensive:我方大防御 CD 施放(非 throughput)+ 饰品
  try {
    for (const u of friends) {
      for (const cd of extractMajorCooldowns(u, legacy)) {
        if (cd.isThroughput) continue;
        for (const cast of cd.casts) {
          out.push({
            t: cast.timeSeconds,
            kind: "defensive",
            side: "friendly",
            title: cd.spellName,
            detail: cast.timingLabel,
            unitNames: [u.name],
            jumpT: cast.timeSeconds,
          });
        }
      }
      for (const c of u.spellCastEvents ?? []) {
        if (!c.spellId || !TRINKETS.has(c.spellId)) continue;
        out.push({
          t: rel(c.timestamp),
          kind: "defensive",
          side: "friendly",
          title: "交饰品",
          unitNames: [u.name],
          jumpT: rel(c.timestamp),
        });
      }
    }
  } catch {
    /* 同上 */
  }

  // dispel:Critical/High(F163 同源)
  try {
    const ds = reconstructDispelSummary(
      friends,
      enemies,
      legacy,
      friendlyPets,
      enemyPets,
    );
    for (const e of [...ds.allyCleanse, ...ds.ourPurges]) {
      if (e.priority !== "Critical" && e.priority !== "High") continue;
      out.push({
        t: e.timeSeconds,
        kind: "dispel",
        side: "friendly",
        title: `${e.dispelSpellName}(${e.priority})`,
        detail: `解掉 ${e.removedSpellName}`,
        unitNames: [e.sourceName, e.targetName],
        jumpT: e.timeSeconds,
      });
    }
  } catch {
    /* 同上 */
  }

  // cc:我方被控(≥3s 或触发饰品);控制成功(≥3s 或目标为治疗)
  try {
    for (const u of friends) {
      const s = analyzePlayerCCAndTrinket(u, enemies, legacy, enemyPets);
      for (const cc of s.ccInstances) {
        if (cc.durationSeconds < CC_MIN_S && cc.trinketState !== "used")
          continue;
        out.push({
          t: cc.atSeconds,
          kind: "cc",
          side: "enemy",
          title: `被控:${cc.spellName}`,
          detail: `${cc.durationSeconds.toFixed(0)}s${cc.trinketState === "used" ? " · 交饰品解" : ""}`,
          unitNames: [u.name],
          jumpT: cc.atSeconds,
        });
      }
    }
    for (const e of enemies) {
      const s = analyzePlayerCCAndTrinket(e, friends, legacy, friendlyPets);
      for (const cc of s.ccInstances) {
        if (cc.durationSeconds < CC_MIN_S && !isHealerSpec(e.spec)) continue;
        out.push({
          t: cc.atSeconds,
          kind: "cc",
          side: "friendly",
          title: `控制成功:${cc.spellName}`,
          detail: `${cc.durationSeconds.toFixed(0)}s → ${e.name.split("-")[0]}`,
          unitNames: [cc.sourceName, e.name],
          jumpT: cc.atSeconds,
        });
      }
    }
  } catch {
    /* 同上 */
  }

  return out.sort((a, b) => a.t - b.t);
}
```

实现时以 tsc 报错为准修字段名(如 `ICooldownCast.timeSeconds`、`ccInstances` 字段);**不许**因类型不合就绕开 analysis 谓词自写逻辑。

- [ ] **Step 4: 跑测试通过**

Run: `npx vitest run test/report.keymoments.test.ts --root packages/desktop`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/src/report/derive/keyMoments.ts packages/desktop/test/report.keymoments.test.ts
git commit -m "feat(desktop): deriveKeyMoments —— 关键时刻轴五类事件派生(谓词全复用 analysis)"
```

---

### Task 2: `KeyMomentAxis.tsx`(脊柱组件)+ CSS

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/KeyMomentAxis.tsx`
- Modify: `packages/desktop/src/renderer/src/styles.css`(文件尾部追加)
- Test: `packages/desktop/test/report.keymomentaxis.test.tsx`

**Interfaces:**

- Consumes: Task 1 的 `KeyMoment`;`Finding`/`CandidateEvent`(`@gladlog/analysis`);FindingsList 的现有卡片 className(`rpt-finding rpt-finding-{severity}`)。
- Produces:

```tsx
export function KeyMomentAxis(props: {
  moments: KeyMoment[];
  findings: Finding[];
  candidates: CandidateEvent[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** finding 卡的证据/跟进操作透传(与 FindingsList 同款) */
  onSelectEvidence: (eventIds: string[]) => void;
  flags?: Record<string, string>;
  onFlag?: (key: string, flag: "done" | "recurring" | null) => void;
}): JSX.Element;
```

归并规则(测试锚定):finding 取其 eventIds 在 candidates 中最早的有限 t;无可解析 t 的 finding **不渲染**(父组件负责「整场观察」);节点+卡合并按 t 升序;交错 = 排序后按序号偶左奇右(burst-band 除外,渲染在脊柱本体);相邻条目 t 差 > 30s 时插入 `⏱ {Math.round(dt)}s` 省略标(`data-testid="axis-gap"`)。

- [ ] **Step 1: 写失败测试**

```tsx
// packages/desktop/test/report.keymomentaxis.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyMomentAxis } from "../src/renderer/src/report/components/KeyMomentAxis";
import type { KeyMoment } from "../src/renderer/src/report/derive/keyMoments";

const moments: KeyMoment[] = [
  {
    t: 10,
    kind: "defensive",
    side: "friendly",
    title: "交饰品",
    unitNames: ["A"],
    jumpT: 10,
  },
  {
    t: 90,
    kind: "death",
    side: "friendly",
    title: "阵亡",
    unitNames: ["B"],
    jumpT: 90,
  },
];
const candidates = [
  { id: "e1", type: "death", t: 41, unitNames: ["B"], facts: {} },
] as never[];
const findings = [
  {
    eventIds: ["e1"],
    severity: "high",
    category: "survival",
    title: "被秒",
    explanation: "x",
  },
  {
    eventIds: ["nope"],
    severity: "low",
    category: "cooldowns",
    title: "整场未用",
    explanation: "y",
  },
] as never[];

describe("KeyMomentAxis", () => {
  it("按 t 归并排序,finding 挂在解析出的时刻;无 t finding 不渲染", () => {
    render(
      <KeyMomentAxis
        moments={moments}
        findings={findings}
        candidates={candidates}
        onSelectEvidence={() => {}}
      />,
    );
    const nodes = screen.getAllByTestId("axis-node");
    // 10s 饰品 → 41s finding → 90s 死亡
    expect(nodes.length).toBe(3);
    expect(nodes[1].textContent).toContain("被秒");
    expect(screen.queryByText("整场未用")).toBeNull();
  });

  it("相邻 >30s 插省略标;点击节点回调 onSeek", () => {
    const onSeek = vi.fn();
    render(
      <KeyMomentAxis
        moments={moments}
        findings={[]}
        candidates={[]}
        onSeek={onSeek}
        onSelectEvidence={() => {}}
      />,
    );
    expect(screen.getAllByTestId("axis-gap").length).toBe(1); // 10→90 = 80s
    fireEvent.click(screen.getAllByTestId("axis-node")[0]);
    expect(onSeek).toHaveBeenCalledWith(10, ["A"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/report.keymomentaxis.test.tsx --root packages/desktop`
Expected: FAIL — 组件不存在。

- [ ] **Step 3: 实现组件**

```tsx
// packages/desktop/src/renderer/src/report/components/KeyMomentAxis.tsx
import type { CandidateEvent, Finding } from "@gladlog/analysis";

import { findingKey } from "../../../../shared/findingKey";
import type { KeyMoment } from "../derive/keyMoments";

const GAP_S = 30;
const mmss = (sec: number): string =>
  `${Math.floor(sec / 60)}:${Math.floor(sec % 60)
    .toString()
    .padStart(2, "0")}`;

const KIND_ICON: Record<KeyMoment["kind"], string> = {
  death: "✕",
  "burst-band": "▮",
  defensive: "🛡",
  dispel: "♱",
  cc: "◎",
};

type Entry =
  | { at: number; kind: "moment"; m: KeyMoment }
  | { at: number; kind: "finding"; f: Finding };

/** 关键时刻轴:静态叙事脊柱,系统事件与 finding 卡按时间交错,可点跳回放。 */
export function KeyMomentAxis({
  moments,
  findings,
  candidates,
  onSeek,
  onSelectEvidence,
  flags,
  onFlag,
}: {
  moments: KeyMoment[];
  findings: Finding[];
  candidates: CandidateEvent[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  onSelectEvidence: (eventIds: string[]) => void;
  flags?: Record<string, string>;
  onFlag?: (key: string, flag: "done" | "recurring" | null) => void;
}) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const entries: Entry[] = [
    ...moments.map((m): Entry => ({ at: m.t, kind: "moment", m })),
    ...findings.flatMap((f): Entry[] => {
      const ts = (f.eventIds ?? [])
        .map((id) => byId.get(id)?.t)
        .filter((t): t is number => Number.isFinite(t));
      return ts.length ? [{ at: Math.min(...ts), kind: "finding", f }] : [];
    }),
  ].sort((a, b) => a.at - b.at);

  let flip = 0;
  let prevAt: number | null = null;
  return (
    <div className="rpt-axis" data-testid="key-moment-axis">
      {entries.map((e, i) => {
        const gap =
          prevAt !== null && e.at - prevAt > GAP_S ? e.at - prevAt : null;
        prevAt = e.at;
        // burst-band 画在脊柱本体,不参与左右交错
        const band = e.kind === "moment" && e.m.kind === "burst-band";
        const side = band ? "band" : flip++ % 2 === 0 ? "left" : "right";
        return (
          <div key={i} className={`rpt-axis-row ${side}`}>
            {gap !== null && (
              <div className="rpt-axis-gap" data-testid="axis-gap">
                ⏱ {Math.round(gap)}s 无关键事件
              </div>
            )}
            {e.kind === "moment" ? (
              <button
                className={`rpt-axis-node k-${e.m.kind} s-${e.m.side}`}
                data-testid="axis-node"
                onClick={
                  onSeek ? () => onSeek(e.m.jumpT, e.m.unitNames) : undefined
                }
              >
                <span className="rpt-axis-time">{mmss(e.at)}</span>
                <span className="rpt-axis-icon">{KIND_ICON[e.m.kind]}</span>
                <span className="rpt-axis-title">{e.m.title}</span>
                {e.m.detail && (
                  <span className="rpt-axis-detail">{e.m.detail}</span>
                )}
                {band && e.m.toT != null && (
                  <span className="rpt-axis-detail">
                    {mmss(e.at)}–{mmss(e.m.toT)}
                  </span>
                )}
              </button>
            ) : (
              <div
                className={`rpt-finding rpt-finding-${e.f.severity} rpt-axis-finding`}
                data-testid="axis-node"
              >
                <span className="rpt-axis-time">{mmss(e.at)}</span>
                <div className="rpt-finding-head">
                  <span className="rpt-finding-sev">
                    {e.f.severity} · {e.f.category}
                  </span>
                  <span className="rpt-finding-title">{e.f.title}</span>
                </div>
                <p className="rpt-finding-body">{e.f.explanation}</p>
                <div className="rpt-finding-ev">
                  <button onClick={() => onSelectEvidence(e.f.eventIds)}>
                    Evidence
                  </button>
                  {onSeek && (
                    <button
                      className="rpt-finding-jump"
                      onClick={() => {
                        const ev = byId.get(e.f.eventIds[0]);
                        onSeek(e.at, ev?.unitNames ?? []);
                      }}
                    >
                      ▶ 回放此刻
                    </button>
                  )}
                  {onFlag &&
                    (() => {
                      const key = findingKey(e.f);
                      const cur = flags?.[key];
                      return (
                        <span className="rpt-finding-flags">
                          <button
                            className={cur === "done" ? "active" : ""}
                            onClick={() =>
                              onFlag(key, cur === "done" ? null : "done")
                            }
                          >
                            ✓ 已跟进
                          </button>
                          <button
                            className={cur === "recurring" ? "active rec" : ""}
                            onClick={() =>
                              onFlag(
                                key,
                                cur === "recurring" ? null : "recurring",
                              )
                            }
                          >
                            ↻ 还在犯
                          </button>
                        </span>
                      );
                    })()}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: CSS(styles.css 尾部追加)**

```css
/* ── 关键时刻轴(AI 分析页脊柱) ── */
.rpt-axis {
  position: relative;
  margin: 14px 0;
  padding: 4px 0;
}
.rpt-axis::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--hairline);
}
.rpt-axis-row {
  position: relative;
  display: flex;
  margin: 6px 0;
}
.rpt-axis-row.left {
  justify-content: flex-start;
  padding-right: calc(50% + 14px);
}
.rpt-axis-row.right {
  justify-content: flex-end;
  padding-left: calc(50% + 14px);
}
.rpt-axis-row.band {
  justify-content: center;
}
.rpt-axis-row.left > * {
  margin-left: auto;
}
.rpt-axis-row.right > * {
  margin-right: auto;
}
.rpt-axis-gap {
  position: absolute;
  left: 50%;
  top: -4px;
  transform: translateX(-50%);
  font-size: 10px;
  color: var(--mute);
  background: var(--bg);
  padding: 0 6px;
  white-space: nowrap;
}
.rpt-axis-node {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--surface);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--ink);
  text-align: left;
}
.rpt-axis-node:hover {
  border-color: var(--gold-dim);
}
.rpt-axis-time {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  color: var(--mute);
  font-size: 11px;
}
.rpt-axis-node.k-death.s-friendly {
  border-left: 3px solid var(--loss);
}
.rpt-axis-node.k-death.s-enemy {
  border-left: 3px solid var(--win);
}
.rpt-axis-node.k-cc.s-enemy {
  border-left: 3px solid var(--loss);
}
.rpt-axis-node.k-cc.s-friendly {
  border-left: 3px solid var(--win);
}
.rpt-axis-node.k-burst-band.s-friendly {
  background: color-mix(in srgb, var(--win) 10%, var(--surface));
}
.rpt-axis-node.k-burst-band.s-enemy {
  background: color-mix(in srgb, var(--loss) 10%, var(--surface));
}
.rpt-axis-detail {
  color: var(--ink-2);
  font-size: 11px;
}
.rpt-axis-finding {
  max-width: 46%;
}
.rpt-axis-finding .rpt-axis-time {
  display: block;
  margin-bottom: 2px;
}
```

- [ ] **Step 5: 跑测试通过**

Run: `npx vitest run test/report.keymomentaxis.test.tsx --root packages/desktop`
Expected: PASS(2 tests)。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/src/report/components/KeyMomentAxis.tsx packages/desktop/src/renderer/src/styles.css packages/desktop/test/report.keymomentaxis.test.tsx
git commit -m "feat(desktop): KeyMomentAxis 组件 —— 交错脊柱/省略标/点跳"
```

---

### Task 3: 接线(StructuredAnalysisPanel 换轴、MatchReport 单列、整场观察)

**Files:**

- Modify: `packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/MatchReport.tsx`(AI 视图 `rpt-ai-full` 区域)
- Modify: `packages/desktop/src/renderer/src/styles.css`(`.rpt-ai-full` 改单列)
- Test: 更新受影响断言(`StructuredAnalysisPanel.test.tsx` 等,跑挂了哪个改哪个)

**Interfaces:**

- Consumes: Task 1 `deriveKeyMoments(source, ownerId?)`、Task 2 `KeyMomentAxis`。
- Produces: 无新导出;页面结构 = goals/MatchHero → KeyMomentAxis → 整场观察(无 t finding 用现有 FindingsList 渲染)→ cohort 全宽。

- [ ] **Step 1: StructuredAnalysisPanel 换轴**

在组件内(result 渲染分支):

```tsx
// import 区新增
import { KeyMomentAxis } from "./KeyMomentAxis";
import { deriveKeyMoments } from "../derive/keyMoments";
// TimelineStrip import 删除

// 组件体内(input useMemo 之后)
const keyMoments = useMemo(() => deriveKeyMoments(source), [source]);

// 渲染:删除 <TimelineStrip .../> 块,原位替换为:
const withT = new Set(
  (input?.candidates ?? [])
    .filter((c) => Number.isFinite(c.t) && c.t > 0)
    .map((c) => c.id),
);
const timedFindings = result.findings.filter((f) =>
  f.eventIds?.some((id) => withT.has(id)),
);
const wholeRound = result.findings.filter((f) => !timedFindings.includes(f));
// ...
<KeyMomentAxis
  moments={keyMoments}
  findings={timedFindings}
  candidates={input?.candidates ?? []}
  onSeek={onSeekEvent}
  onSelectEvidence={setActiveEventIds}
  flags={flags}
  onFlag={handleFlag}
/>;
{
  wholeRound.length > 0 && (
    <>
      <h4 className="rpt-card-label" style={{ marginTop: 12 }}>
        整场观察
      </h4>
      <FindingsList
        findings={wholeRound}
        onSelect={setActiveEventIds}
        candidates={input?.candidates ?? []}
        flags={flags}
        onFlag={handleFlag}
      />
    </>
  );
}
```

注:`activeEventIds` 相关 TimelineStrip 点亮逻辑若仅服务于 strip,连同 strip 一起移除;`handleJump` 保留给「整场观察」与轴内 onSeek 复用。有 t 的 finding 不再走 FindingsList(避免重复渲染)。

- [ ] **Step 2: MatchReport 单列 + cohort 下沉**

`MatchReport.tsx` AI 视图区域:

```tsx
// 原:
// <div className="rpt-ai-full">
//   <div className="rpt-ai-main"><StructuredAnalysisPanel ... /></div>
//   <aside className="rpt-ai-side"><ProComparisonVerified ... /></aside>
// </div>
// 改为:
<div className="rpt-ai-full">
  <div className="rpt-ai-main">
    <StructuredAnalysisPanel ... /* 原 props 不动 */ />
    <ProComparisonVerified source={source} matchId={resolvedMatchId} />
  </div>
</div>
```

styles.css:

```css
.rpt-ai-full {
  margin-top: 14px;
  display: block;
}
/* .rpt-ai-side 相关规则删除或留空壳(grep 确认无其他引用后删) */
```

- [ ] **Step 3: 跑全门禁,修受影响测试**

Run(repo 根): `npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`
Expected: 挂掉的只应是断言旧布局/TimelineStrip 的测试——按新结构更新断言(axis 存在、cohort 在主栏内),不许为过测试回退布局。

- [ ] **Step 4: headless 冒烟 + 压测样本**

Run: `npx tsx packages/desktop/scripts/smokeStressFixtures.ts`
Expected: 4 个压测样本全 ok(deriveKeyMoments 不在冒烟内,但组件挂载路径经组件测试覆盖)。

- [ ] **Step 5: Commit + push + CI**

```bash
git add -A
git commit -m "feat(desktop): AI 分析页关键时刻轴布局 —— 轴替换横向 strip,cohort 全宽下沉"
git push
RUN=$(gh run list --workflow test.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status $RUN
```

Expected: CI success。

---

## Self-Review 记录

- Spec 覆盖:五类事件(T1)、脊柱/交错/省略标/点跳(T2)、布局与整场观察(T3)、测试清单逐条对应 ✓;「TimelineStrip 组件保留文件」= T3 只删 AI 页引用 ✓。
- 占位符扫描:所有代码块完整;字段名以 tsc 为准的说明是**校正指令**而非留白 ✓。
- 类型一致:KeyMoment/deriveKeyMoments/KeyMomentAxis 签名三处逐字一致 ✓。
