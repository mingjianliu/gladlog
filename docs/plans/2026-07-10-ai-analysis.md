# 子项目 4a:app 内 AI 复盘 + 数据再对齐 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自有 AI 分析体系(24 文件闭包 + buildMatchContext)移植为 `@gladlog/analysis`,主进程 Anthropic 流式 + 战报 AI 面板打通,benchmark 本地语料分层重建 + 再对齐报告。

**Architecture:** 移植类任务采用**控制器提取 + 实现方机械改造**模式:Claude(控制器)从旧 fork 取 CLEAN 源文件放入最终路径(实现方永不接触旧 fork),agy 按改写规则调 import/改造数据接点,契约测试把关。新代码(主进程 ai / 面板 / benchmark 分层)按常规 TDD。Spec:`docs/specs/2026-07-10-ai-analysis-design.md`。

**Tech Stack:** TypeScript ESM、vitest、`@gladlog/parser-compat`(legacy 形状)、lodash、`@anthropic-ai/sdk`(仅 desktop main)、React(面板)。

## Global Constraints

- **合规(硬性)**:实现者(agy)不得访问 `/Users/mingjianliu/code/wowarenalogs`;所有旧 fork 源文件由控制器复制到 gladlog 后交付。被移植文件为审计 CLEAN(`discoveryRules.ts` L11、`ccCoverage.test.ts` L1 为 NEEDS_SCRUB,复制时由控制器按审计行号改写该行)。
- **移植零逻辑改动原则**:批量移植任务只允许 (a) import 说明符改写 `@wowarenalogs/parser` → `@gladlog/parser-compat`、`lodash` 保留;(b) 相对路径按新布局调整;(c) 计划点名的数据接点改造(spellEffectData)。其余任何行为改动 = 违约,报 BLOCKED。
- ESM、TS strict、vitest globals、测试在包内 `test/`;根 `npm test --workspaces --if-present` 全绿。
- `benchmark_data.json` 重拟合门槛:分层抽样 + 逐 spec n 披露 + 最小 n(默认 30)+ 新旧漂移方向一致才动阈值(spec 已定)。
- API key 仅主进程;model 默认 `claude-sonnet-5`。
- TDD、每任务一 commit。

## 提取清单(控制器专用;目标路径 = `packages/analysis/src/` 下)

```
旧 packages/shared/src/utils/{binarySearch,utils,dampening,talents,talentBehaviors,
  spellDanger,enemyInterrupts,losAnalysis,cooldowns,enemyCDs,offensiveWindows,
  drAnalysis,ccTrinketAnalysis,dispelAnalysis,dispelFeatureFlags,discoveryRules,
  talentModifiers,healingGaps,healerOffenseAnalysis,killWindowTargetSelection}.ts
    → src/utils/ 同名
旧 packages/shared/src/data/{spellTags,arenaGeometry,spellEffectData}.ts → src/data/
旧 packages/shared/src/data/{talentModifiers,trinketItemIds,spellNames}.json → src/data/(实际用到才带,T2 核对)
旧 packages/shared/src/components/CombatReport/CombatPlayers/talentStrings.ts → src/data/talentStrings.ts
旧 packages/shared/src/components/CombatReport/CombatAIAnalysis/buildMatchContext.ts → src/context/buildMatchContext.ts
旧 packages/shared/src/utils/__tests__/ 中仅依赖闭包内模块的自有测试 → test/ported/
参考(不复制进仓,控制器读取后转述给实现方):CombatAIAnalysis/index.tsx(面板逻辑)、web/pages/api/analyze.ts(流式后端逻辑)
```

---

### Task 1: `packages/analysis` 脚手架

**Files:** Create `packages/analysis/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,test/smoke.test.ts}`

**Interfaces:** Produces 包骨架:`@gladlog/analysis`,deps `{"@gladlog/parser-compat":"0.0.1","lodash":"^4.17.21"}`,devDeps `{"@types/lodash":"^4.17.0","typescript":"^5.5.0","vitest":"^2.0.0","@types/node":"^26.1.1"}`,scripts test/typecheck 同 parser 惯例(`vitest run --passWithNoTests`);tsconfig 参照 parser-compat(strict、ESM、noEmit);`src/index.ts` 先空导出 `export {};`。

- [ ] Step 1: 按上述创建五个文件(tsconfig/vitest 逐字照抄 packages/parser-compat 对应文件);smoke.test.ts 断言 `import * as pkg from "../src/index"` 不炸。
- [ ] Step 2: 根目录 `npm install`;`npm test -w @gladlog/analysis && npm run typecheck -w @gladlog/analysis` PASS。
- [ ] Step 3: Commit `feat(analysis): package scaffold`。

---

### Task 2: 数据层批(控制器提取 + spellEffectData 改造)

**Files:** Create `src/data/{spellTags.ts,arenaGeometry.ts,talentStrings.ts,discoveryRules.ts,dispelFeatureFlags.ts,talentModifiers.ts(util 移入 data? 保持 utils/ 原位),spellEffectOverrides.ts,spellEffectData.ts}` + 实际用到的 JSON;Test `test/data.test.ts`

**流程:**

- [ ] Step 1(控制器):复制 spellTags/arenaGeometry/talentStrings/discoveryRules(改写 L11 为语义等价原创表达)/dispelFeatureFlags 到位;grep 闭包内对 `spellEffectData`/`getEnglishSpellName`/JSON 的全部调用点,产出"被引用法术 id 集合 + 需要的字段"清单写入 `.superpowers/sdd/spelleffect-usage.md`;核对 talentModifiers.json/trinketItemIds.json/spellNames.json 是否被闭包 import,被引用才复制。
- [ ] Step 2(控制器):据 usage 清单手写 `src/data/spellEffectOverrides.ts`——`export const SPELL_EFFECT_OVERRIDES: Record<string, IMinedSpell>`,仅含被引用法术,时长/冷却取暴雪公开事实,文件头注明来源与子项目 5 替换计划。
- [ ] Step 3(agy):改造 `spellEffectData.ts`:删除 `import rawMinedData from './spellEffects.json'`,数据源换 `SPELL_EFFECT_OVERRIDES`;保留 `IMinedSpell` 接口与全部导出函数签名(`spellEffectData`、`getEnglishSpellName` 等)不变;其余文件仅调 import 路径。
- [ ] Step 4(契约,Claude 先写):`test/data.test.ts` —— (a) usage 清单中每个 spellId 在 `SPELL_EFFECT_OVERRIDES` 有条目且 `durationSeconds ?? cooldownSeconds` 至少一项有值;(b) `getEnglishSpellName` 对清单首个 id 返回非空;(c) `ccSpellIds`(spellTags)非空集合;(d) discoveryRules/dispelFeatureFlags 可导入且形状不变(具名导出存在性)。
- [ ] Step 5:`npm test -w @gladlog/analysis && npm run typecheck -w @gladlog/analysis` PASS → Commit `feat(analysis): data layer port with curated spell-effect overrides`。

---

### Task 3: 基础 utils 批

**Files:** Create `src/utils/{binarySearch,utils,dampening,talents,talentBehaviors,spellDanger,enemyInterrupts,losAnalysis}.ts`;Test `test/base-utils.test.ts` + `test/ported/`(自有测试适用者)

- [ ] Step 1(控制器):复制 8 文件到位;移植 `__tests__` 中仅依赖本批+T2 模块的自有测试到 `test/ported/`(import 路径由 agy 调)。
- [ ] Step 2(agy):调 import(规则见全局约束);不改逻辑。
- [ ] Step 3(契约):`test/base-utils.test.ts` —— `computeDampening` 合成断言(0s→0%,已知时长→单调递增)、`binarySearchClosest` 三例精确断言、`getSpecTalentTreeSpellIds` 对任一 healer spec 返回非空(依赖 talentStrings/talentModifiers)。
- [ ] Step 4:全绿 → Commit `feat(analysis): base utils port`。

---

### Task 4: 核心分析批 A(cooldowns / enemyCDs / offensiveWindows)+ legacy fixture 桥

**Files:** Create `src/utils/{cooldowns,enemyCDs,offensiveWindows}.ts`、`test/helpers/legacyFixture.ts`;Test `test/core-a.test.ts`

- [ ] Step 1(控制器):复制 3 文件。
- [ ] Step 2(agy):调 import;创建 `test/helpers/legacyFixture.ts`:读 `packages/desktop/test/fixtures/report-match.json` → 补回空 `rawLines: []` → `toLegacyMatch`(from `@gladlog/parser-compat`;确切签名以 compat 源为准,BLOCKED 上报若形状不符)→ 导出 `loadLegacyMatchFixture(): IArenaMatch`。
- [ ] Step 3(契约):`test/core-a.test.ts` —— fixture 冒烟:`extractMajorCooldowns`(或 cooldowns.ts 实际主导出,agy 报告确切名)返回数组且元素含 timing 标签字段;`specToString(CombatUnitSpec)` 对 fixture 单位全部非空;enemyCDs 时间线对 fixture 产出且时间戳升序;offensiveWindows 状态机对 fixture 不抛且窗口 start<end。
- [ ] Step 4:全绿 → Commit `feat(analysis): core analysis batch A (cooldowns/enemyCDs/offensiveWindows)`。

---

### Task 5: 核心分析批 B(drAnalysis / ccTrinketAnalysis / dispelAnalysis)

**Files:** Create 3 文件;Test `test/core-b.test.ts` + 移植 ccCoverage 等自有测试(控制器改写 NEEDS_SCRUB 行)

- [ ] 流程同 Task 4(控制器复制→agy 调 import→契约:getDRLevel 合成 DR 链精确断言 0/25/50/75;fixture 冒烟 ccTrinket/dispel 不抛且形状字段存在)→ Commit `feat(analysis): core analysis batch B (dr/ccTrinket/dispel)`。

---

### Task 6: 核心分析批 C + buildMatchContext

**Files:** Create `src/utils/{healingGaps,healerOffenseAnalysis,killWindowTargetSelection}.ts`、`src/context/buildMatchContext.ts`、`src/index.ts` 汇总导出;Test `test/context.test.ts`

- [ ] Step 1-2:控制器复制 4 文件;agy 调 import;`src/index.ts` 导出全部公共 API(utils+context+data 类型)。
- [ ] Step 3(契约):`test/context.test.ts` —— `buildMatchContext(loadLegacyMatchFixture(), ...)`(确切签名 agy 从源文件报告)返回字符串:非空、含玩家名、含 "dampening" 或对应段落标题、长度 > 2000;healerOffense 对无 advanced 的 fixture 变体返回禁用态(spec:无 advanced 完全禁用)。
- [ ] Step 4:全绿 → Commit `feat(analysis): batch C + buildMatchContext; public API assembled`。

---

### Task 7: desktop 主进程 ai 模块 + bridge

**Files:** Create `packages/desktop/src/main/ai.ts`;Modify `src/main/index.ts`(注册)、`src/main/ipc.ts`、`src/preload/{index.ts,api.ts}`;deps `@anthropic-ai/sdk`;Test `packages/desktop/test/ai.test.ts`

**Interfaces(bridge 增量):**

```ts
ai: {
  analyze(matchId: string, context: string): Promise<void>;   // 触发;结果走事件
  cancel(): Promise<void>;
  getCached(matchId: string): Promise<{ content: string; model: string; createdAt: number } | null>;
  onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
  onDone(cb: (d: { matchId: string; content: string }) => void): () => void;
  onError(cb: (d: { matchId: string; message: string }) => void): () => void;
}
```

**ai.ts 契约**:`createAiService(deps: { getSettings: () => GladlogSettings; clientFactory?: (key: string) => AnthropicLike; matchesDir: string; emit: (channel, payload) => void })`;`AnthropicLike = { stream(params): AsyncIterable<{ delta?: string }> }` 注入化;无 key → emit error `NO_API_KEY`;流中 delta 逐条 emit;完成写 `matchesDir/<matchId>/analysis.json` 信封 `{ schemaVersion:1, model, promptVersion: PROMPT_VERSION, createdAt, content }`;`cancel()` abort 当前流;同一时刻仅一个分析(新请求取消旧)。真实 client 用 `new Anthropic({ apiKey }).messages.stream({ model, max_tokens: 4096, messages: [{role:'user', content: context}] })` 适配为 AnthropicLike。

- [ ] Step 1(契约先行,Claude 写):fake client(可控 delta 序列/抛错/挂起)注入,断言:无 key 错误;delta 顺序;done 落盘信封;cancel 后不再 emit;新 analyze 取消旧。
- [ ] Step 2(agy):实现 ai.ts + ipc/preload 接线(通道 `gladlog:ai:*`)。
- [ ] Step 3:desktop 全测试+typecheck+build 绿 → Commit `feat(desktop): main-process Anthropic streaming ai service`。

---

### Task 8: AI 面板(逻辑直搬换皮)+ 战报页挂载

**Files:** Create `packages/desktop/src/renderer/src/report/components/AIAnalysisPanel.tsx`;Modify `MatchReport.tsx`(右栏 tab:单位详情 | AI 分析)、`styles.css`;Test `test/report.ai-panel.test.tsx`

- [ ] Step 1(控制器):读旧 `CombatAIAnalysis/index.tsx`,把状态机逻辑(idle/streaming/done/error、缓存优先、重新分析)转述为精确行为清单交 agy;prompt 组装点 = `buildMatchContext`(来自 `@gladlog/analysis`),桥接 `StoredMatch→toLegacyMatch` 在面板内 useMemo。
- [ ] Step 2(契约):jsdom 测试(mock bridge ai 面):无 key → 引导文案;点击分析 → onDelta 注入两段文本渐进出现;getCached 命中 → 直接显示缓存+"重新分析"按钮。
- [ ] Step 3(agy):实现面板(石板黑 token,markdown 渲染用 `<pre>` 白名单降级即可,v1 不引 md 库)+ MatchReport 右栏 tab 化。
- [ ] Step 4:全绿+fixture 模式人工冒烟(控制器截图确认视觉)→ Commit `feat(desktop): AI analysis panel wired to report page`。

---

### Task 9: benchmark 重建 CLI(分层抽样)

**Files:** Create `packages/analysis/scripts/collectBenchmarks.ts`、`src/benchmark/{stratify.ts,metrics.ts}`;Test `test/benchmark.test.ts`

- [ ] Step 1(控制器):复制旧 `collectBenchmarks.ts` 的指标计算部分为 `src/benchmark/metrics.ts` 基底(剥 GCS/下载逻辑,输入改为 IArenaMatch[]);阵容原型分类:简化规则 `healerSpec + 近战数/远程数` 组合串。
- [ ] Step 2(契约):`stratify.ts` 纯函数测试——给定 meta 列表(spec、rating、archetype),按 spec×archetype 分层抽样,尊重 minN(不足全取并标记 insufficient)、每层上限均衡;`metrics.ts` 对 fixture 单场产出全字段(pressure P90/HPS/DPS/timing 分布/never-used/purge/dampening at death)。
- [ ] Step 3(agy):实现 CLI:`--manifest <路径清单> --min-rating 2100 --min-n 30 --out benchmarks/benchmark_data.json`;流程 = 逐文件新 parser+compat 解析 → rating 过滤 → 分层 → 指标聚合 → 输出含 `{ generatedAt, parser: 'gladlog', sampleSizes: perSpec }`;旧 `benchmark_data.json` 由控制器复制入 `benchmarks/benchmark_data.old-parser.json`(不可变基线)。
- [ ] Step 4:10 场小清单端到端 + 全绿 → Commit `feat(analysis): local-corpus benchmark rebuild with stratified sampling`。

---

### Task 10: 数据再对齐第一轮 + 真实 API 冒烟 + 收官(控制器主导)

- [ ] Step 1:控制器全语料跑 `collectBenchmarks`(caffeinate,后台);产出对比脚本(新旧逐 spec 表+漂移%+方向)→ 报告 `docs/reports/2026-07-XX-benchmark-realignment.md`,按 spec 的双重确认规则给 PANIC 阈值结论;agy verify 交叉复核报告结论。
- [ ] Step 2:控制器真实 key 冒烟:app 里对一场真对局跑完整分析流(需用户在设置里填 key,或用户在场时执行——不阻塞其他步骤)。
- [ ] Step 3:最终 whole-branch review(pro)→ findings 闭环;全仓测试+typecheck;打包 mac 冒烟。
- [ ] Step 4:账本 + README(子项目 4 不勾,4b 未做;README 可加"4a ✅(4b eval 工具链待做)"注记)→ Commit `docs: sub-project 4a complete`。

---

## Self-Review(计划自查)

- **Spec 覆盖**:analysis 包(T1-6)、spellEffectOverrides(T2)、主进程流式+缓存+取消(T7)、面板+挂载(T8)、benchmark 分层+不可变基线(T9)、再对齐报告+双重确认(T10)、API 前向兼容(index.ts 导出层不锁形状,T6)。全节有任务。
- **占位符**:移植批任务的"内容"即旧 CLEAN 文件本体,由控制器提取步骤供给——非占位;契约与新代码接口均已给出。确切函数签名(cooldowns 主导出、buildMatchContext、toLegacyMatch)标注了"agy 从源文件报告/BLOCKED 上报"机制,避免我在计划里凭记忆虚构签名。
- **类型一致性**:bridge ai 面(T7)与面板消费(T8)一致;legacyFixture(T4)被 T4-6 共用;stratify/metrics(T9)自洽。
- **风险**:compat 类型名若缺 `CombatExtraSpellAction` 等个别导出 → T4 起 BLOCKED 上报,控制器在 parser-compat 补 re-export(零行为)。lodash ESM 兼容(vitest 下 `import _ from 'lodash'` 可用)。
