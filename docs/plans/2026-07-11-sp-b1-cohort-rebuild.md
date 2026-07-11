# SP-B1 群体语料重建管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个离线维护者工具,用 gladlog 自己的 parser + 移植的 healerMetrics 从 wowarenalogs.com 的 2300+ 公共 feed 重算全部群体基线,产出版本戳、去-embedding 的静态 `reference_vectors.json`,供 SP-B2 消费。

**Architecture:** metric 计算(healerMetrics + crisisEvents)移植进 `@gladlog/analysis`,与产线共用;采集/聚合逻辑放**新建离线包 `packages/corpus-tools`**(不进桌面 App 发布包)。cell = `spec × bracket × archetype`(复用 gladlog 现成 archetype 分类器)+ 层级回退 + N_floor=30。核心聚合器与验证器是纯函数,单测充分;feed 采集是集成层。

**Tech Stack:** TypeScript(ESM),Node,vitest,`@gladlog/parser` + `@gladlog/parser-compat` + `@gladlog/analysis`,`node-fetch`(GraphQL)。

## Global Constraints

- **合规提取**:旧 fork 源文件只能由控制器对照子项目 0 审计 CLEAN 提取;agy/子代理不得读 `/Users/mingjianliu/code/wowarenalogs`。本计划每个"移植"步骤的旧代码已由控制器贴在步骤内——实现者照抄+改 import,不去读旧仓。
- **发布层零外部依赖**:`packages/corpus-tools` 绝不被桌面 App(`packages/desktop`)import;产物是静态 JSON。
- **去 embedding**:语料不含 embedding 列(新管线不用)。
- **N_floor = 30**:cell 样本 < 30 标 `insufficient: true`;archetype-cell 不足回退 `spec × bracket` 父 cell,父 cell 仍不足才 insufficient。
- **诚实数值**:所有指标由代码算,不含任何模型生成数字(SP-B2 的 claimChecker 前提)。
- **ESM + vitest**:与现有 packages 一致(`"type": "module"`,`.ts` 直接 tsx 跑;测试 `*.test.ts`,`describe/it`)。
- **提交前先跑测试拿 exit code**,绿了再 commit。

### 相对 spec 的偏离(须用户确认)

spec §数据源 列了 Python 天赋聚类桥(`get_spec_clusters.py` → `pythonClusterRank`)。**本计划按 YAGNI 砍掉它**:聚合器只用 `metrics + crisisEvents`(exemplar 的 load-bearing 输入),`pythonClusterRank` 仅在 SP-B2 若需 exemplar 多样化时才用——届时再加,不阻塞 B1,也免去构建期对独立 Python 仓的依赖。若用户要求 B1 就带 cluster,追加一个 enrichment task(下载→gladlog parse 后调 Python 桥写 clusterRank 进 PerMatchRecord)。

---

### Task 1: 移植 healerMetrics 进 @gladlog/analysis

**Files:**

- Create: `packages/analysis/src/utils/healerMetrics.ts`
- Modify: `packages/analysis/src/index.ts`(加导出)
- Test: `packages/analysis/src/utils/healerMetrics.test.ts`

**Interfaces:**

- Consumes(均已在 @gladlog/analysis 内部):`reconstructEnemyCDTimeline`、`extractMajorCooldowns`、`annotateDefensiveTimings`、`detectOverlappedDefensives`、`IMajorCooldownInfo`、`MAJOR_DEFENSIVE_IDS`(from `./cooldowns`);`analyzePlayerCCAndTrinket`(from `./ccTrinketAnalysis`);`ccSpellIds`(from `../data/spellTags`);`CombatUnitType`、`LogEvent`、`IArenaMatch`、`IShuffleRound`(from `@gladlog/parser-compat`)。
- Produces:`computeHealerMetrics(combat: IArenaMatch | IShuffleRound, playerName: string): IHealerMetrics`;`IHealerMetrics`(见下);`computeCDResponseLatency(...)`。

- [ ] **Step 1: 写失败测试**

`packages/analysis/src/utils/healerMetrics.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeHealerMetrics } from "./healerMetrics";

// 最小合成 combat:一个治疗单位,无伤害无治疗 → offensiveIndex=0,其余为定义域内。
function stubCombat(): any {
  const healer = {
    name: "H-Realm-US",
    type: 1,
    reaction: 2,
    spec: "264", // Resto Shaman
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    spellCastEvents: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    info: { teamId: "0" },
  };
  return {
    units: { "H-Realm-US": healer },
    startTime: 0,
    endTime: 60000,
    playerId: "H-Realm-US",
  };
}

describe("computeHealerMetrics", () => {
  it("returns all six metrics in-domain for a no-op healer", () => {
    const m = computeHealerMetrics(stubCombat(), "H-Realm-US");
    expect(m.offensiveIndex).toBe(0);
    expect(m.ccDensity).toBe(0);
    expect(m.reactionLatency).toBeNull();
    expect(m.effectiveCastRatio).toBeGreaterThanOrEqual(0);
    expect(m.ccAvoidanceRate).toBeGreaterThanOrEqual(0);
    expect(m.defensiveOverlapRatio).toBeGreaterThanOrEqual(0);
    expect(m.burstResponseCoverage).toEqual({ answered: 0, windows: 0 });
  });
  it("throws when the named healer is absent", () => {
    expect(() => computeHealerMetrics(stubCombat(), "Nobody")).toThrow(
      /not found/,
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/analysis && npx vitest run src/utils/healerMetrics.test.ts`
Expected: FAIL(`Cannot find module './healerMetrics'`）。

- [ ] **Step 3: 创建 healerMetrics.ts(控制器已贴旧仓 CLEAN 源,改 import)**

把下列旧 fork `shared/utils/healerMetrics.ts` 的 CLEAN 内容原样落到 `packages/analysis/src/utils/healerMetrics.ts`,**仅改顶部 import**:`@wowarenalogs/parser` → `@gladlog/parser-compat`;`../data/spellTags`、`./ccTrinketAnalysis`、`./cooldowns`、`./enemyCDs` 保持相对路径(同在 analysis/src/utils 与 data 下)。函数体一字不改:

```typescript
import {
  CombatUnitType,
  IArenaMatch,
  IShuffleRound,
  LogEvent,
} from "@gladlog/parser-compat";
import { ccSpellIds } from "../data/spellTags";
import { analyzePlayerCCAndTrinket } from "./ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  detectOverlappedDefensives,
  extractMajorCooldowns,
  IMajorCooldownInfo,
  MAJOR_DEFENSIVE_IDS,
} from "./cooldowns";
import { reconstructEnemyCDTimeline } from "./enemyCDs";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[half];
  return (sorted[half - 1] + sorted[half]) / 2.0;
}

export function computeCDResponseLatency(
  annotatedCooldowns: IMajorCooldownInfo[],
  burstWindows: Array<{ fromSeconds: number; toSeconds: number }>,
  matchStartMs: number,
): { latencyMsMedian: number | null; answered: number; windows: number } {
  const answeredLatencies: Array<number | null> = burstWindows.map((w) => {
    const windowStartMs = w.fromSeconds * 1000 + matchStartMs;
    const windowEndMs = w.toSeconds * 1000 + matchStartMs;
    let best: number | null = null;
    for (const cd of annotatedCooldowns) {
      for (const cast of cd.casts) {
        if (cast.timingLabel !== "Optimal" && cast.timingLabel !== "Reactive")
          continue;
        const castMs = cast.timeSeconds * 1000 + matchStartMs;
        if (castMs >= windowStartMs && castMs <= windowEndMs + 8000) {
          const latency = castMs - windowStartMs;
          if (latency >= 0 && (best === null || latency < best)) best = latency;
        }
      }
    }
    return best;
  });
  const hit = answeredLatencies.filter((x): x is number => x !== null);
  return {
    latencyMsMedian: hit.length ? median(hit) : null,
    answered: hit.length,
    windows: burstWindows.length,
  };
}

export interface IHealerMetrics {
  offensiveIndex: number;
  ccDensity: number;
  reactionLatency: number | null;
  burstResponseCoverage: { answered: number; windows: number };
  defensiveOverlapRatio: number;
  effectiveCastRatio: number;
  ccAvoidanceRate: number;
  ccAvoidedCount: number;
  ccLandedCount: number;
}

export function computeHealerMetrics(
  combat: IArenaMatch | IShuffleRound,
  playerName: string,
): IHealerMetrics {
  const allUnits = Object.values(combat.units) as any[];
  const healerUnit = allUnits.find(
    (u) => u.name === playerName && u.type === CombatUnitType.Player,
  );
  if (!healerUnit)
    throw new Error(`Healer unit ${playerName} not found in combat.`);

  const totalDamageOut = healerUnit.damageOut.reduce(
    (sum: number, a: any) => sum + Math.abs(a.effectiveAmount),
    0,
  );
  const totalHealOut =
    healerUnit.healOut.reduce((sum: number, a: any) => {
      if (
        (a.logLine.event === "SPELL_PERIODIC_HEAL" ||
          a.logLine.event === "SPELL_HEAL") &&
        typeof a.logLine.parameters[30] === "number" &&
        typeof a.logLine.parameters[32] === "number" &&
        !isNaN(a.logLine.parameters[30]) &&
        !isNaN(a.logLine.parameters[32])
      ) {
        return sum + (a.logLine.parameters[30] - a.logLine.parameters[32]);
      }
      return sum + Math.abs(a.effectiveAmount);
    }, 0) +
    healerUnit.absorbsOut.reduce(
      (sum: number, a: any) => sum + Math.abs(a.effectiveAmount),
      0,
    );
  const offensiveIndex = totalHealOut > 0 ? totalDamageOut / totalHealOut : 0;

  const ccCasts = healerUnit.spellCastEvents.filter(
    (e: any) =>
      e.logLine.event === "SPELL_CAST_SUCCESS" &&
      ccSpellIds.has(String(e.spellId)),
  );
  const durationSeconds = (combat.endTime - combat.startTime) / 1000;
  const ccDensity =
    durationSeconds > 0 ? (ccCasts.length / durationSeconds) * 60 : 0;

  const friends = allUnits.filter(
    (u) =>
      u.type === CombatUnitType.Player && u.reaction === healerUnit.reaction,
  );
  const enemies = allUnits.filter(
    (u) =>
      u.type === CombatUnitType.Player && u.reaction !== healerUnit.reaction,
  );
  const enemyCDTimeline = reconstructEnemyCDTimeline(
    enemies,
    combat as any,
    healerUnit,
    friends,
  );
  const cooldowns = extractMajorCooldowns(healerUnit, combat as any);
  const annotated = annotateDefensiveTimings(
    cooldowns,
    healerUnit,
    combat as any,
    enemyCDTimeline as any,
  );
  const lat = computeCDResponseLatency(
    annotated,
    (enemyCDTimeline as any).alignedBurstWindows,
    combat.startTime,
  );
  const reactionLatency =
    lat.latencyMsMedian !== null ? lat.latencyMsMedian / 1000 : null;
  const burstResponseCoverage = {
    answered: lat.answered,
    windows: lat.windows,
  };

  const overlaps = detectOverlappedDefensives(friends, combat as any);
  const myOverlapCount = overlaps.filter(
    (o: any) =>
      o.firstCasterName === playerName || o.secondCasterName === playerName,
  ).length;
  const myTotalDefensives = healerUnit.spellCastEvents.filter(
    (e: any) =>
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      MAJOR_DEFENSIVE_IDS.has(String(e.spellId)),
  ).length;
  const defensiveOverlapRatio = myOverlapCount / (myTotalDefensives + 1);

  const ccTrinketSummary = analyzePlayerCCAndTrinket(
    healerUnit,
    enemies,
    combat as any,
  );
  const successCasts = healerUnit.spellCastEvents.filter(
    (e: any) => e.logLine.event === "SPELL_CAST_SUCCESS",
  ).length;
  const interuptsOnMe = ccTrinketSummary.interruptInstances.length;
  const effectiveCastRatio = successCasts / (successCasts + interuptsOnMe + 1);

  const avoidedCount = ccTrinketSummary.ccAvoidedInstances.length;
  const successfulCCCount = ccTrinketSummary.ccInstances.length;
  const ccAvoidanceRate = avoidedCount / (avoidedCount + successfulCCCount + 1);

  return {
    offensiveIndex,
    ccDensity,
    reactionLatency,
    burstResponseCoverage,
    defensiveOverlapRatio,
    effectiveCastRatio,
    ccAvoidanceRate,
    ccAvoidedCount: avoidedCount,
    ccLandedCount: successfulCCCount,
  };
}
```

若某个依赖(如 `MAJOR_DEFENSIVE_IDS`)未从 `./cooldowns` 导出,加 `export`。

- [ ] **Step 4: 从 index 导出**

`packages/analysis/src/index.ts` 末尾加:

```typescript
export {
  computeHealerMetrics,
  computeCDResponseLatency,
} from "./utils/healerMetrics";
export type { IHealerMetrics } from "./utils/healerMetrics";
```

- [ ] **Step 5: 跑测试 + 全量测试 + tc**

Run: `cd packages/analysis && npx vitest run src/utils/healerMetrics.test.ts && npx vitest run && npx tsc --noEmit`
Expected: 新测试 PASS;既有 491 测试仍 PASS;tc=0。

- [ ] **Step 6: Commit**

```bash
git add packages/analysis/src/utils/healerMetrics.ts packages/analysis/src/utils/healerMetrics.test.ts packages/analysis/src/index.ts
git commit -m "feat(analysis): port computeHealerMetrics from old fork (SP-B1 T1)"
```

---

### Task 2: 移植 crisisEvents / extractRotations 进 @gladlog/analysis

**Files:**

- Create: `packages/analysis/src/utils/crisisEvents.ts`
- Modify: `packages/analysis/src/index.ts`
- Test: `packages/analysis/src/utils/crisisEvents.test.ts`

**Interfaces:**

- Consumes:`ICombatUnit`、`AtomicArenaCombat`(from `@gladlog/parser-compat`)。
- Produces:`extractRotations(player: ICombatUnit, match: AtomicArenaCombat): IExtractedRotations`;`IExtractedRotations { opener: string[]; coreSequences: string[]; crisisEvents: string[] }`。

- [ ] **Step 1: 写失败测试**

`packages/analysis/src/utils/crisisEvents.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractRotations } from "./crisisEvents";

function stubUnit(): any {
  return {
    name: "H-Realm-US",
    spellCastEvents: [],
    deathRecords: [],
    damageIn: [],
  };
}
function stubMatch(): any {
  return { units: {}, startTime: 0, endTime: 60000 };
}

describe("extractRotations", () => {
  it("returns empty rotation arrays for a unit with no casts", () => {
    const r = extractRotations(stubUnit(), stubMatch());
    expect(r.opener).toEqual([]);
    expect(r.coreSequences).toEqual([]);
    expect(r.crisisEvents).toEqual([]);
  });
  it("crisisEvents entries are ASCII (English spell names)", () => {
    const r = extractRotations(stubUnit(), stubMatch());
    for (const c of r.crisisEvents) expect(c).toMatch(/^[\x00-\x7F]*$/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/analysis && npx vitest run src/utils/crisisEvents.test.ts`
Expected: FAIL(`Cannot find module './crisisEvents'`)。

- [ ] **Step 3: 创建 crisisEvents.ts**

从旧 fork `shared/utils/matchEmbeddingRecord.ts` 提取 **仅 `extractRotations` + `IExtractedRotations`**(不带 embedding builder / RawMatchRecord;extractRotations 本身不用它们)。改 import:旧 `englishSpellName`→gladlog 的 `getEnglishSpellName`;`PASSIVE_SPELL_BLOCKLIST` 从 `./cooldowns`(gladlog 已有);类型从 `@gladlog/parser-compat`。函数体一字不改(已核对 gladlog 侧 `PASSIVE_SPELL_BLOCKLIST`、`advancedActorId`、`advancedActorCurrentHp/MaxHp` 均在):

```typescript
import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { PASSIVE_SPELL_BLOCKLIST } from "./cooldowns";
import { getEnglishSpellName } from "../data/spellEffectData";

export interface IExtractedRotations {
  opener: string[];
  coreSequences: string[];
  crisisEvents: string[];
}

export function extractRotations(
  player: ICombatUnit,
  match: AtomicArenaCombat,
): IExtractedRotations {
  const casts = player.spellCastEvents
    .filter(
      (e) =>
        e.spellName &&
        e.logLine?.event === "SPELL_CAST_SUCCESS" &&
        !PASSIVE_SPELL_BLOCKLIST.has(e.spellName),
    )
    .map((e) => ({
      spellId: e.spellId,
      name: e.spellName as string,
      time: (e.logLine.timestamp - match.startTime) / 1000,
    }))
    .sort((a, b) => a.time - b.time);

  const opener = casts.filter((c) => c.time <= 30).map((c) => c.name);

  const seqCounts: Record<string, number> = {};
  for (let i = 0; i < casts.length - 2; i++) {
    const chain = `${getEnglishSpellName(casts[i].spellId ?? "", casts[i].name)} -> ${getEnglishSpellName(casts[i + 1].spellId ?? "", casts[i + 1].name)} -> ${getEnglishSpellName(casts[i + 2].spellId ?? "", casts[i + 2].name)}`;
    seqCounts[chain] = (seqCounts[chain] || 0) + 1;
  }
  const coreSequences = Object.entries(seqCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([seq, count]) => `${seq} (used ${count}x)`);

  const teamUnits = (Object.values(match.units) as ICombatUnit[]).filter(
    (u) => u.type === CombatUnitType.Player && u.reaction === player.reaction,
  );
  const allTeamHpRecords = teamUnits
    .flatMap((u) =>
      (u.advancedActions || [])
        .filter(
          (a: any) =>
            a.advanced &&
            a.advancedActorId === u.id &&
            a.advancedActorMaxHp > 0,
        )
        .map((a: any) => ({
          targetName: u.name,
          time: (a.logLine.timestamp - match.startTime) / 1000,
          pct: (a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100,
        })),
    )
    .sort((a, b) => a.time - b.time);

  const crisisEvents: string[] = [];
  let lastCrisisTime = -999;
  for (const record of allTeamHpRecords) {
    if (record.pct < 40 && record.time - lastCrisisTime > 15) {
      lastCrisisTime = record.time;
      const responseCasts = casts
        .filter((c) => c.time >= record.time && c.time <= record.time + 6)
        .map((c) => getEnglishSpellName(c.spellId ?? "", c.name));
      if (responseCasts.length > 0) {
        crisisEvents.push(
          `At ${record.time.toFixed(1)}s (Teammate ${record.targetName} HP: ${Math.floor(record.pct)}%): ${responseCasts.join(" -> ")}`,
        );
      }
    }
  }
  return { opener, coreSequences, crisisEvents };
}
```

> 注:crisis 串形如 `"At 14.0s (Teammate H-Realm-US HP: 32%): Nature's Swiftness -> Healing Wave"`,全英文(`getEnglishSpellName` 保证)——满足验证器 ASCII 门。`getEnglishSpellName` 的正确来源模块以 gladlog analysis 现有导出为准(`../data/spellEffectData` 已导出)。

- [ ] **Step 4: 从 index 导出**

```typescript
export { extractRotations } from "./utils/crisisEvents";
export type { IExtractedRotations } from "./utils/crisisEvents";
```

- [ ] **Step 5: 跑测试 + tc**

Run: `cd packages/analysis && npx vitest run src/utils/crisisEvents.test.ts && npx tsc --noEmit`
Expected: PASS;tc=0。

- [ ] **Step 6: Commit**

```bash
git add packages/analysis/src/utils/crisisEvents.ts packages/analysis/src/utils/crisisEvents.test.ts packages/analysis/src/index.ts
git commit -m "feat(analysis): port extractRotations/crisisEvents from old fork (SP-B1 T2)"
```

---

### Task 3: enemy-comp archetype 分类器(cohort celling 轴)

> **计划修正(执行期,控制器)**:原计划复用 gladlog 的 `computeMatchArchetype`([MATCH TYPE] 标签)。核对真实 API 后发现它是**赛况动态**(爆发节奏)分类,签名 6 参(含 ccTrinketSummaries / alignedBurstWindows / healerExposures 重依赖)、返回 measurements、标签需再经 15 字段 dynamics 组装 + classifyMatchArchetype,且对短局/噪声簇返回空串。而 Gemini debate 指出的聚合陷阱本质是**敌方阵容**依赖,非爆发动态。故改用**自建 enemy-comp 分类器**:自足(只需 `isMeleeSpec`/`isHealerSpec` + 敌方 specs)、更贴合 comp-context 意图、对 cohort 与用户对局用同一函数分类(SP-B2 查 cell 用同款),且天然非空(总落到确定桶)。

**Files:**

- Create: `packages/analysis/src/utils/enemyCompArchetype.ts`
- Modify: `packages/analysis/src/index.ts`
- Test: `packages/analysis/src/utils/enemyCompArchetype.test.ts`

**Interfaces:**

- Consumes:`isMeleeSpec`、`isHealerSpec`(from `./cooldowns`);`ICombatUnit`(from `@gladlog/parser-compat`)。
- Produces:`enemyCompArchetype(enemies: ICombatUnit[]): string` — 返回 4 桶之一:`"melee_cleave"` / `"caster_cleave"` / `"hybrid"` / `"other"`。

- [ ] **Step 1: 写失败测试(真实行为断言)**

`packages/analysis/src/utils/enemyCompArchetype.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { enemyCompArchetype } from "./enemyCompArchetype";

// 用 spec id 构造敌方单位;isMeleeSpec/isHealerSpec 按 gladlog 的 CombatUnitSpec 判定。
// spec 常量取自 @gladlog/parser-compat 的 CombatUnitSpec(实现者 import 真值):
//   melee dps 例:Warrior_Arms;ranged dps 例:Mage_Frost;healer 例:Paladin_Holy。
function u(spec: string): any {
  return { spec, type: 1 };
}

describe("enemyCompArchetype", () => {
  it("two melee dps -> melee_cleave", () => {
    // 两个近战 dps + 一个治疗
    expect(enemyCompArchetype([u(MELEE), u(MELEE), u(HEALER)])).toBe(
      "melee_cleave",
    );
  });
  it("two ranged dps -> caster_cleave", () => {
    expect(enemyCompArchetype([u(RANGED), u(RANGED), u(HEALER)])).toBe(
      "caster_cleave",
    );
  });
  it("one melee + one ranged dps -> hybrid", () => {
    expect(enemyCompArchetype([u(MELEE), u(RANGED), u(HEALER)])).toBe("hybrid");
  });
  it("no dps (edge) -> other", () => {
    expect(enemyCompArchetype([u(HEALER)])).toBe("other");
  });
});
```

> 实现者:把 `MELEE`/`RANGED`/`HEALER` 换成 `@gladlog/parser-compat` 的 `CombatUnitSpec` 里真实值——用 `isMeleeSpec` 判为 true 的一个近战 spec(如 Arms Warrior)、`isMeleeSpec` false 且非治疗的 ranged spec(如 Frost Mage)、`isHealerSpec` true 的治疗 spec(如 Holy Paladin)。可先在实现文件里 `console.log` 或查 `cooldowns.ts` 的 spec 集合确认。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/analysis && npx vitest run src/utils/enemyCompArchetype.test.ts`
Expected: FAIL(module 不存在)。

- [ ] **Step 3: 实现 enemyCompArchetype.ts**

```typescript
import type { ICombatUnit } from "@gladlog/parser-compat";
import { isHealerSpec, isMeleeSpec } from "./cooldowns";

/**
 * cohort-celling 的敌方阵容轴。粗 4 桶,兼顾战术上下文(治疗指标画像随敌方 comp 变)
 * 与样本量(桶少)。cohort 与用户对局用同一函数分类,保证 SP-B2 查 cell 一致。
 */
export function enemyCompArchetype(enemies: ICombatUnit[]): string {
  const dps = enemies.filter((e) => !isHealerSpec(e.spec));
  const melee = dps.filter((e) => isMeleeSpec(e.spec)).length;
  const ranged = dps.length - melee;
  if (melee >= 2) return "melee_cleave";
  if (ranged >= 2) return "caster_cleave";
  if (melee >= 1 && ranged >= 1) return "hybrid";
  return "other";
}
```

若 `isMeleeSpec`/`isHealerSpec` 未从 `./cooldowns` 导出,加 `export`。

- [ ] **Step 4: 从 index 导出**

```typescript
export { enemyCompArchetype } from "./utils/enemyCompArchetype";
```

- [ ] **Step 5: 跑测试 + tc**

Run: `cd packages/analysis && npx vitest run src/utils/enemyCompArchetype.test.ts && npx tsc --noEmit`
Expected: 4 测试 PASS;tc=0。

- [ ] **Step 6: Commit**

```bash
git add packages/analysis/src/utils/enemyCompArchetype.ts packages/analysis/src/utils/enemyCompArchetype.test.ts packages/analysis/src/index.ts
git commit -m "feat(analysis): enemy-comp archetype classifier for cohort celling (SP-B1 T3)"
```

---

### Task 4: 语料 cell 聚合器(纯函数)

**Files:**

- Create: `packages/corpus-tools/package.json`、`packages/corpus-tools/tsconfig.json`
- Create: `packages/corpus-tools/src/cellAggregator.ts`
- Test: `packages/corpus-tools/src/cellAggregator.test.ts`

**Interfaces:**

- Consumes:`IHealerMetrics`(from `@gladlog/analysis`)。
- Produces:`aggregateCells(records: PerMatchRecord[], nFloor: number): Corpus`;类型:

  ```typescript
  interface PerMatchRecord {
    spec: string;
    bracket: string;
    archetype: string;
    metrics: IHealerMetrics;
    crisisEvents: string[];
  }
  interface MetricDist {
    p10: number;
    p50: number;
    p90: number;
    n: number;
  }
  interface Cell {
    spec: string;
    bracket: string;
    archetype: string; // "*" = bracket-wide 父 cell
    sampleN: number;
    insufficient: boolean;
    metrics: Record<string, MetricDist>;
    exemplarCrises: string[][];
  }
  interface Corpus {
    wowPatchVersion: string;
    builtAt: string;
    sourceFloor: number;
    cells: Cell[];
  }
  ```

- [ ] **Step 1: scaffold 包**

`packages/corpus-tools/package.json`:

```json
{
  "name": "@gladlog/corpus-tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@gladlog/parser": "workspace:*",
    "@gladlog/parser-compat": "workspace:*",
    "@gladlog/analysis": "workspace:*",
    "fs-extra": "^11.2.0",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "tsx": "^4.7.0"
  }
}
```

`packages/corpus-tools/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

(版本号对齐 monorepo 现有 packages 的 vitest/tsx/typescript 实际版本——实现者以 `packages/analysis/package.json` 为准。)

- [ ] **Step 2: 写失败测试**

`packages/corpus-tools/src/cellAggregator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { aggregateCells, PerMatchRecord } from "./cellAggregator";

function rec(archetype: string, offensiveIndex: number): PerMatchRecord {
  return {
    spec: "RestorationShaman",
    bracket: "3v3",
    archetype,
    metrics: {
      offensiveIndex,
      ccDensity: 1,
      reactionLatency: 2,
      burstResponseCoverage: { answered: 1, windows: 2 },
      defensiveOverlapRatio: 0.1,
      effectiveCastRatio: 0.9,
      ccAvoidanceRate: 0.5,
      ccAvoidedCount: 1,
      ccLandedCount: 1,
    },
    crisisEvents: [`[0:10] crisis ${offensiveIndex}`],
  };
}

describe("aggregateCells", () => {
  it("builds an archetype cell and a bracket-wide parent cell", () => {
    const recs = Array.from({ length: 40 }, (_, i) => rec("cc_swap_burst", i));
    const corpus = aggregateCells(recs, 30);
    const arche = corpus.cells.find((c) => c.archetype === "cc_swap_burst")!;
    const parent = corpus.cells.find((c) => c.archetype === "*")!;
    expect(arche.sampleN).toBe(40);
    expect(arche.insufficient).toBe(false);
    expect(arche.metrics.offensiveIndex.p50).toBeCloseTo(19.5, 0); // median of 0..39 ≈ 19.5
    expect(parent.sampleN).toBe(40);
  });
  it("marks an under-floor archetype cell insufficient", () => {
    const recs = Array.from({ length: 5 }, (_, i) => rec("rare_arch", i));
    const corpus = aggregateCells(recs, 30);
    const cell = corpus.cells.find((c) => c.archetype === "rare_arch")!;
    expect(cell.insufficient).toBe(true);
  });
  it("per-metric n excludes null reactionLatency", () => {
    const recs = Array.from({ length: 30 }, () => {
      const r = rec("cc_swap_burst", 5);
      (r.metrics as any).reactionLatency = null;
      return r;
    });
    const corpus = aggregateCells(recs, 30);
    const cell = corpus.cells.find((c) => c.archetype === "cc_swap_burst")!;
    expect(cell.metrics.reactionLatency.n).toBe(0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/corpus-tools && npx vitest run src/cellAggregator.test.ts`
Expected: FAIL(module 不存在)。

- [ ] **Step 4: 实现 cellAggregator.ts**

```typescript
import type { IHealerMetrics } from "@gladlog/analysis";

export interface PerMatchRecord {
  spec: string;
  bracket: string;
  archetype: string;
  metrics: IHealerMetrics;
  crisisEvents: string[];
}
export interface MetricDist {
  p10: number;
  p50: number;
  p90: number;
  n: number;
}
export interface Cell {
  spec: string;
  bracket: string;
  archetype: string;
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  exemplarCrises: string[][];
}
export interface Corpus {
  wowPatchVersion: string;
  builtAt: string;
  sourceFloor: number;
  cells: Cell[];
}

// 逐维取值:6 个标量维;reactionLatency 可为 null(不计入该维分布)。
const SCALAR_METRICS: Array<keyof IHealerMetrics> = [
  "offensiveIndex",
  "ccDensity",
  "reactionLatency",
  "defensiveOverlapRatio",
  "effectiveCastRatio",
  "ccAvoidanceRate",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function distFor(
  records: PerMatchRecord[],
  metric: keyof IHealerMetrics,
): MetricDist {
  const vals = records
    .map((r) => r.metrics[metric])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  return {
    p10: percentile(vals, 0.1),
    p50: percentile(vals, 0.5),
    p90: percentile(vals, 0.9),
    n: vals.length,
  };
}

function buildCell(
  spec: string,
  bracket: string,
  archetype: string,
  records: PerMatchRecord[],
  nFloor: number,
): Cell {
  const metrics: Record<string, MetricDist> = {};
  for (const m of SCALAR_METRICS) metrics[m as string] = distFor(records, m);
  // exemplar:取每条的 crisisEvents(SP-B2 再做多样化选择),上限 50 条防膨胀
  const exemplarCrises = records.slice(0, 50).map((r) => r.crisisEvents);
  return {
    spec,
    bracket,
    archetype,
    sampleN: records.length,
    insufficient: records.length < nFloor,
    metrics,
    exemplarCrises,
  };
}

export function aggregateCells(
  records: PerMatchRecord[],
  nFloor: number,
  meta?: { wowPatchVersion?: string; sourceFloor?: number },
): Corpus {
  const byArche = new Map<string, PerMatchRecord[]>();
  const byParent = new Map<string, PerMatchRecord[]>();
  for (const r of records) {
    const pk = `${r.spec}|${r.bracket}|*`;
    (byParent.get(pk) ?? byParent.set(pk, []).get(pk)!).push(r);
    // "*" 是父 cell 保留键;archetype 恰为 "*" 的记录只进父 cell(防与父 cell 撞键重复)
    if (r.archetype !== "*") {
      const ak = `${r.spec}|${r.bracket}|${r.archetype}`;
      (byArche.get(ak) ?? byArche.set(ak, []).get(ak)!).push(r);
    }
  }
  const cells: Cell[] = [];
  for (const [k, recs] of byArche) {
    const [spec, bracket, archetype] = k.split("|");
    cells.push(buildCell(spec, bracket, archetype, recs, nFloor));
  }
  for (const [k, recs] of byParent) {
    const [spec, bracket] = k.split("|");
    cells.push(buildCell(spec, bracket, "*", recs, nFloor));
  }
  return {
    wowPatchVersion: meta?.wowPatchVersion ?? "unknown",
    builtAt: new Date().toISOString(),
    sourceFloor: meta?.sourceFloor ?? 2300,
    cells,
  };
}
```

- [ ] **Step 5: 跑测试 + tc**

Run: `cd packages/corpus-tools && npx vitest run src/cellAggregator.test.ts && npx tsc --noEmit`
Expected: PASS;tc=0。

- [ ] **Step 6: Commit**

```bash
git add packages/corpus-tools/
git commit -m "feat(corpus-tools): scaffold package + cell aggregator with archetype celling + N_floor (SP-B1 T4)"
```

---

### Task 5: 语料验证器(硬门,纯函数)

**Files:**

- Create: `packages/corpus-tools/src/validateCorpus.ts`
- Test: `packages/corpus-tools/src/validateCorpus.test.ts`

**Interfaces:**

- Consumes:`Corpus`、`Cell`(from `./cellAggregator`)。
- Produces:`validateCorpus(corpus: Corpus, nFloor: number): string[]`(返回违规列表;空=通过)。

- [ ] **Step 1: 写失败测试**

`packages/corpus-tools/src/validateCorpus.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateCorpus } from "./validateCorpus";
import type { Corpus } from "./cellAggregator";

function corpusWith(cell: any): Corpus {
  return {
    wowPatchVersion: "11.0.7",
    builtAt: "now",
    sourceFloor: 2300,
    cells: [cell],
  };
}
const goodCell = {
  spec: "RestorationShaman",
  bracket: "3v3",
  archetype: "cc_swap_burst",
  sampleN: 40,
  insufficient: false,
  metrics: { reactionLatency: { p10: 1, p50: 2, p90: 3, n: 40 } },
  exemplarCrises: [["[0:10] taken Chaos Bolt"]],
};

describe("validateCorpus", () => {
  it("passes a clean corpus", () => {
    expect(validateCorpus(corpusWith(goodCell), 30)).toEqual([]);
  });
  it("flags the 1.5 latency sentinel (0-record cell carrying 1.5)", () => {
    const bad = {
      ...goodCell,
      metrics: { reactionLatency: { p10: 1.5, p50: 1.5, p90: 1.5, n: 0 } },
    };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /1\.5 sentinel/.test(v)),
    ).toBe(true);
  });
  it("flags non-ASCII crisis spell names", () => {
    const bad = { ...goodCell, exemplarCrises: [["[0:10] 承受 混乱之箭"]] };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /non-ASCII/.test(v)),
    ).toBe(true);
  });
  it("flags a cell below floor not marked insufficient", () => {
    const bad = { ...goodCell, sampleN: 5, insufficient: false };
    expect(
      validateCorpus(corpusWith(bad), 30).some((v) => /insufficient/.test(v)),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/corpus-tools && npx vitest run src/validateCorpus.test.ts`
Expected: FAIL(module 不存在)。

- [ ] **Step 3: 实现 validateCorpus.ts**

```typescript
import type { Corpus } from "./cellAggregator";

const ASCII = /^[\x00-\x7F]*$/;

export function validateCorpus(corpus: Corpus, nFloor: number): string[] {
  const v: string[] = [];
  if (!corpus.wowPatchVersion || corpus.wowPatchVersion === "unknown")
    v.push("corpus.wowPatchVersion missing/unknown");
  for (const c of corpus.cells) {
    const tag = `${c.spec}|${c.bracket}|${c.archetype}`;
    // N_floor 一致性
    if (c.sampleN < nFloor && !c.insufficient)
      v.push(`${tag}: below floor (${c.sampleN}) but not insufficient`);
    if (c.sampleN >= nFloor && c.insufficient)
      v.push(`${tag}: at/above floor (${c.sampleN}) but marked insufficient`);
    // 1.5 延迟哨兵:n===0 却带非空 reactionLatency 分布(尤其 1.5)
    const rl = c.metrics.reactionLatency;
    if (
      rl &&
      rl.n === 0 &&
      (rl.p50 === 1.5 || rl.p10 === 1.5 || rl.p90 === 1.5)
    )
      v.push(`${tag}: reactionLatency 1.5 sentinel with 0 records`);
    // crisis 英文/ASCII
    for (const crises of c.exemplarCrises)
      for (const line of crises)
        if (!ASCII.test(line))
          v.push(`${tag}: non-ASCII crisis line: ${line.slice(0, 40)}`);
  }
  return v;
}
```

- [ ] **Step 4: 跑测试 + tc**

Run: `cd packages/corpus-tools && npx vitest run src/validateCorpus.test.ts && npx tsc --noEmit`
Expected: PASS;tc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/corpus-tools/src/validateCorpus.ts packages/corpus-tools/src/validateCorpus.test.ts
git commit -m "feat(corpus-tools): corpus validator hard gate (1.5 sentinel/ASCII/N_floor) (SP-B1 T5)"
```

---

### Task 6: feed 客户端 + go/no-go 冒烟

**Files:**

- Create: `packages/corpus-tools/src/feedClient.ts`
- Create: `packages/corpus-tools/scripts/smokeFeed.ts`
- Test: `packages/corpus-tools/src/feedClient.test.ts`

**Interfaces:**

- Produces:`fetchMatchStubs(opts: { bracket: string; minRating: number; specId?: number; limit: number }): Promise<MatchStub[]>`;`downloadLogText(stub: MatchStub): Promise<string>`;`MatchStub { id: string; bracket: string; rating: number; logObjectUrl: string; }`。
- feed endpoint / query 形状由控制器从旧 fork `printMatchPrompts.ts`(`fetchStubs`)提供(CLEAN);实现者不读旧仓。

- [ ] **Step 1: 写失败测试(用可注入的 fetch,不打真网络)**

`packages/corpus-tools/src/feedClient.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchMatchStubs } from "./feedClient";

describe("fetchMatchStubs", () => {
  it("POSTs minRating as a server-side variable and maps combats to MatchStub[]", async () => {
    // 服务端已按 minRating 过滤,fake 只返回 >= 门槛的 combats;客户端只做映射,不再二次过滤。
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          latestMatches: {
            combats: [
              { id: "a", logObjectUrl: "u1", startTime: 1, endTime: 2 },
              { id: "b", logObjectUrl: "u2", startTime: 3, endTime: 4 },
            ],
          },
        },
      }),
    });
    const stubs = await fetchMatchStubs(
      { bracket: "3v3", minRating: 2300, limit: 10 },
      fakeFetch as any,
    );
    expect(stubs.map((s) => s.id)).toEqual(["a", "b"]);
    expect(stubs[0].logObjectUrl).toBe("u1");
    // 断言 minRating 确实作为 GraphQL 变量下发(服务端过滤)
    const body = JSON.parse((fakeFetch.mock.calls[0][1] as any).body);
    expect(body.variables.minRating).toBe(2300);
    expect(body.variables.bracket).toBe("3v3");
  });
  it("stops paging when the feed returns an empty page", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { latestMatches: { combats: [] } } }),
    });
    const stubs = await fetchMatchStubs(
      { bracket: "2v2", minRating: 2300, limit: 10 },
      fakeFetch as any,
    );
    expect(stubs).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/corpus-tools && npx vitest run src/feedClient.test.ts`
Expected: FAIL(module 不存在)。

- [ ] **Step 3: 实现 feedClient.ts(fetch 可注入)**

```typescript
export interface MatchStub {
  id: string;
  bracket: string;
  rating: number;
  logObjectUrl: string;
}

const FEED_ENDPOINT = "https://wowarenalogs.com/api/graphql";
// 真实 query(取自旧 fork CLEAN 的 fetchStubs):minRating 为**服务端**变量,返回的 combats
// 已按评分过滤,故客户端无需再按 rating 过滤。combats 选择集与 MatchStub 字段名以旧 STUBS_QUERY
// 为准(id / logObjectUrl / startTime / endTime 等);bracket 用查询变量回填。
const STUBS_QUERY = `query GetLatestMatches($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating) {
    combats { id wowVersion logObjectUrl startTime endTime }
  }
}`;

type FetchLike = (
  url: string,
  init?: any,
) => Promise<{ ok: boolean; json: () => Promise<any> }>;

export async function fetchMatchStubs(
  opts: { bracket: string; minRating: number; specId?: number; limit: number },
  fetchImpl?: FetchLike,
): Promise<MatchStub[]> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const out: MatchStub[] = [];
  let offset = 0;
  const page = 50;
  while (out.length < opts.limit) {
    const res = await f(FEED_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: STUBS_QUERY,
        variables: {
          wowVersion: "retail",
          bracket: opts.bracket,
          offset,
          count: page,
          minRating: opts.minRating, // 服务端过滤
        },
      }),
    });
    if (!res.ok) throw new Error(`feed HTTP ${(res as any).status ?? "?"}`);
    const combats = (await res.json())?.data?.latestMatches?.combats ?? [];
    if (combats.length === 0) break;
    for (const c of combats) {
      // 服务端已按 minRating 过滤;客户端只做映射。
      out.push({
        id: c.id,
        bracket: opts.bracket,
        rating: opts.minRating,
        logObjectUrl: c.logObjectUrl,
      });
      if (out.length >= opts.limit) break;
    }
    offset += page;
  }
  return out;
}

export async function downloadLogText(
  stub: MatchStub,
  fetchImpl?: FetchLike,
): Promise<string> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const res = await f(stub.logObjectUrl);
  if (!res.ok) throw new Error(`log download HTTP for ${stub.id}`);
  return await (res as any).text();
}
```

- [ ] **Step 4: go/no-go 冒烟脚本**

`packages/corpus-tools/scripts/smokeFeed.ts`:

```typescript
import { fetchMatchStubs } from "../src/feedClient";
async function main() {
  const stubs = await fetchMatchStubs({
    bracket: "Rated Solo Shuffle",
    minRating: 2300,
    limit: 20,
  });
  console.log(`feed returned ${stubs.length} stubs >= 2300 (Solo Shuffle)`);
  if (stubs.length === 0) {
    console.error("GO/NO-GO FAIL: feed returned 0 stubs");
    process.exit(1);
  }
  console.log("GO: feed alive.");
}
main().catch((e) => {
  console.error("GO/NO-GO FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 5: 跑单测 + 真冒烟(维护者手动,go/no-go 门)**

Run(单测):`cd packages/corpus-tools && npx vitest run src/feedClient.test.ts`
Expected: PASS。
Run(真网络,维护者):`npx tsx scripts/smokeFeed.ts`
Expected: 打印 `GO: feed alive.`;若 NO-GO,停工报告控制器切回退源。

- [ ] **Step 6: Commit**

```bash
git add packages/corpus-tools/src/feedClient.ts packages/corpus-tools/src/feedClient.test.ts packages/corpus-tools/scripts/smokeFeed.ts
git commit -m "feat(corpus-tools): feed client + go/no-go smoke (SP-B1 T6)"
```

---

### Task 7: collector 编排(端到端,fixture 集成)

**Files:**

- Create: `packages/corpus-tools/src/perMatchRecord.ts`(单场 → PerMatchRecord)
- Create: `packages/corpus-tools/scripts/buildCorpus.ts`(编排 CLI)
- Test: `packages/corpus-tools/src/perMatchRecord.test.ts`

**Interfaces:**

- Consumes:`GladLogParser`(@gladlog/parser)、`toLegacyMatch`/`toLegacyShuffle`(@gladlog/parser-compat)、`computeHealerMetrics`/`extractRotations`/`enemyCompArchetype`/`isHealerSpec`/`specToString`(@gladlog/analysis)、`fetchMatchStubs`/`downloadLogText`(./feedClient)、`aggregateCells`/`validateCorpus`。
- Produces:`buildPerMatchRecords(logText: string): PerMatchRecord[]`(单份日志 → 每个治疗-owner 视角一条记录);`buildCorpus` CLI 写 `packages/corpus-tools/data/reference_vectors.json`。

- [ ] **Step 1: 写失败测试(用一份自采 fixture 日志)**

`packages/corpus-tools/src/perMatchRecord.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import { buildPerMatchRecords } from "./perMatchRecord";

// fixture:一份小的自采 solo shuffle 日志(实现者从 gladlog-eval-private/corpus 拷一份最小的进 packages/corpus-tools/test/fixtures/)
const FIX = path.join(__dirname, "../test/fixtures/sample-ss.txt");

describe("buildPerMatchRecords", () => {
  it("produces one record per healer round with in-domain metrics + archetype", () => {
    const text = fs.readFileSync(FIX, "utf-8");
    const recs = buildPerMatchRecords(text);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.spec).toBeTruthy();
      expect(r.bracket).toBeTruthy();
      expect(r.archetype).toBeTruthy();
      expect(typeof r.metrics.offensiveIndex).toBe("number");
      for (const c of r.crisisEvents) expect(c).toMatch(/^[\x00-\x7F]*$/);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/corpus-tools && npx vitest run src/perMatchRecord.test.ts`
Expected: FAIL(module 不存在)。

- [ ] **Step 3: 实现 perMatchRecord.ts**

```typescript
import { GladLogParser } from "@gladlog/parser";
import {
  toLegacyMatch,
  toLegacyShuffle,
  CombatUnitReaction,
} from "@gladlog/parser-compat";
import {
  computeHealerMetrics,
  extractRotations,
  enemyCompArchetype,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import type { PerMatchRecord } from "./cellAggregator";

export function buildPerMatchRecords(logText: string): PerMatchRecord[] {
  const parser = new GladLogParser();
  const combats: any[] = [];
  parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
  parser.on("shuffle", (sh: any) => {
    const legacy = toLegacyShuffle(sh);
    (legacy.rounds ?? []).forEach((r: any) => combats.push(r));
  });
  for (const line of logText.split("\n")) parser.push(line);
  parser.end();

  const out: PerMatchRecord[] = [];
  for (const combat of combats) {
    const players = (Object.values(combat.units) as any[]).filter(
      (u) => u.info,
    );
    const healers = players.filter(
      (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
    );
    for (const healer of healers) {
      const friends = players.filter((u) => u.reaction === healer.reaction);
      const enemies = players.filter((u) => u.reaction !== healer.reaction);
      let metrics;
      try {
        metrics = computeHealerMetrics(combat, healer.name);
      } catch {
        continue;
      }
      const archetype = enemyCompArchetype(enemies);
      const rotations = extractRotations(healer, combat);
      out.push({
        spec: specToString(healer.spec),
        bracket: combat.startInfo?.bracket ?? "unknown",
        archetype,
        metrics,
        crisisEvents: rotations.crisisEvents,
      });
    }
  }
  return out;
}
```

(`enemyCompArchetype(enemies)` 直接返回 4 桶字符串之一,见 T3。)

- [ ] **Step 4: 实现 buildCorpus.ts 编排 CLI**

`packages/corpus-tools/scripts/buildCorpus.ts`:

```typescript
import fs from "fs-extra";
import path from "path";
import { fetchMatchStubs, downloadLogText } from "../src/feedClient";
import { buildPerMatchRecords } from "../src/perMatchRecord";
import { aggregateCells } from "../src/cellAggregator";
import { validateCorpus } from "../src/validateCorpus";

const BRACKETS = ["Rated Solo Shuffle", "2v2", "3v3"];
const MIN_RATING = Number(process.env.MIN_RATING ?? 2300);
const PER_BRACKET = Number(process.env.PER_BRACKET ?? 1200); // 足以让主流 archetype 清 N_floor
const N_FLOOR = 30;
const PATCH = process.env.WOW_PATCH ?? "unknown";
const OUT = path.join(__dirname, "../data/reference_vectors.json");

async function main() {
  const recs = [];
  for (const bracket of BRACKETS) {
    const stubs = await fetchMatchStubs({
      bracket,
      minRating: MIN_RATING,
      limit: PER_BRACKET,
    });
    console.log(`${bracket}: ${stubs.length} stubs`);
    for (const stub of stubs) {
      try {
        const text = await downloadLogText(stub);
        recs.push(...buildPerMatchRecords(text));
      } catch (e) {
        console.warn(`skip ${stub.id}: ${e}`);
      }
    }
  }
  const corpus = aggregateCells(recs, N_FLOOR, {
    wowPatchVersion: PATCH,
    sourceFloor: MIN_RATING,
  });
  const violations = validateCorpus(corpus, N_FLOOR);
  if (violations.length > 0) {
    console.error(`VALIDATION FAILED (${violations.length}):`);
    violations.slice(0, 40).forEach((v) => console.error("  " + v));
    process.exit(1);
  }
  await fs.ensureDir(path.dirname(OUT));
  await fs.writeJson(OUT, corpus, { spaces: 0 });
  const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(2);
  console.log(`wrote ${corpus.cells.length} cells (${sizeMB}MB) → ${OUT}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: 跑集成测试 + tc(fixture,不打网络)**

Run: `cd packages/corpus-tools && npx vitest run && npx tsc --noEmit`
Expected: perMatchRecord 测试 PASS(需实现者先放 `test/fixtures/sample-ss.txt` 最小自采日志);tc=0。

- [ ] **Step 6: Commit**

```bash
git add packages/corpus-tools/src/perMatchRecord.ts packages/corpus-tools/src/perMatchRecord.test.ts packages/corpus-tools/scripts/buildCorpus.ts packages/corpus-tools/test/fixtures/
git commit -m "feat(corpus-tools): per-match record + buildCorpus orchestration (SP-B1 T7)"
```

---

### Task 8: 产出并验证真语料(维护者运行 + 收官)

**Files:**

- Create: `packages/corpus-tools/data/reference_vectors.json`(构建产物,提交入仓)
- Create: `packages/corpus-tools/README.md`(runbook)

**Interfaces:** 无新代码接口;这是运行 T7 CLI 的操作步骤 + 收官审查。

- [ ] **Step 1: 确认 go/no-go 冒烟仍绿**

Run: `cd packages/corpus-tools && npx tsx scripts/smokeFeed.ts`
Expected: `GO: feed alive.`

- [ ] **Step 2: 跑真构建(维护者,分钟~小时级)**

Run: `cd packages/corpus-tools && WOW_PATCH=<当前版本> PER_BRACKET=1500 npx tsx scripts/buildCorpus.ts`
Expected: 打印各 bracket stub 数、cell 数、体积(< 3MB);validateCorpus 0 违规;写出 `data/reference_vectors.json`。若验证失败,按违规修(配额不足→提高 PER_BRACKET;非 ASCII→查 getEnglishSpellName 覆盖)。

- [ ] **Step 3: 独立复核语料(agy verify,跨家族)**

Run:

```bash
cd packages/corpus-tools && node ~/.claude/skills/agy/scripts/agy-run.mjs verify --files data/reference_vectors.json \
  "核查这份 reference_vectors.json:每 cell 是否 spec×bracket×archetype 结构;有无 reactionLatency=1.5 且 n=0 的哨兵残留;crisis 串是否全英文 ASCII;insufficient 标记与 sampleN<30 是否一致;整体体积是否合理(<3MB,已去 embedding)。"
```

Expected: agy 无 REFUTED;若有,回修。

- [ ] **Step 4: 写 runbook README**

`packages/corpus-tools/README.md`:说明这是**离线维护者工具、不进桌面 App 发布包**;构建命令(含 MIN_RATING/PER_BRACKET/WOW_PATCH 环境变量);go/no-go 冒烟;验证器硬门;语料 schema;赛季/热修后重跑刷新 wowPatchVersion(分发机制属 SP-B2)。

- [ ] **Step 5: Commit**

```bash
git add packages/corpus-tools/data/reference_vectors.json packages/corpus-tools/README.md
git commit -m "chore(corpus-tools): produce + validate gladlog-metric reference corpus (SP-B1 T8)"
```

---

## 收官(SDD 末尾)

- 全 monorepo tc + 测试:`for p in parser parser-compat analysis corpus-tools; do (cd packages/$p && npx tsc --noEmit && npx vitest run); done`
- 确认 `packages/desktop` 未 import `@gladlog/corpus-tools`(发布层零依赖):`grep -rn "corpus-tools" packages/desktop/src || echo "clean"`
- 派最终全面审查(最强模型)。
