# SP-B1:Pro Comparison 群体语料重建管线 — 设计

日期:2026-07-11
状态:设计(待用户复核)
所属:SP-B(Pro Comparison / compare 子系统)的第一子项目。SP-B2(compare 引擎 + UI)另立 spec。

## 目标

一句话:一个**离线维护者构建工具**,用 gladlog 自己的 parser + 移植的 healerMetrics,从 wowarenalogs.com 的 2300+ 公共 feed 重新计算全部群体基线,产出一份版本戳、去 embedding 的静态 `reference_vectors.json`,供 SP-B2 的 compare 引擎消费。**发布的桌面 App 运行时零外部依赖**——只吃打包/CDN 上的静态语料,与子项目 5(游戏数据管线从 wago.tools 离线拉、打静态 JSON)同构。

## 背景与动机

旧 fork 的 Pro Comparison 已重构成"服务端算数 / LLM 只叙述 / claimChecker 确定性丢弃任何引用了未提供数字或技能的报告"的诚实管线(幻觉 30%→≤4%,exemplar 路径 100 场 A/B 86% 胜出)。这套逻辑无需 Next.js / Firestore(Firestore 仅 web 端回退路径),可整体搬进 gladlog 桌面主进程当 IPC handler(SP-B2)。但它消费的群体语料 `reference_vectors.json` 是**旧 parser** 算的 metrics;而 gladlog 用自己的 parser 量用户。四子项 4a 已证旧/新 parser 指标有系统漂移(重拟合过 spec 基线),若群体用旧 parser、用户用新 parser,百分位对比有系统偏差。故群体必须用 gladlog 管线重算——本 spec 的工作。

## 范围

**本 spec(SP-B1)**:

- 移植 metric 计算(healerMetrics + extractRotations/crisisEvents)进 `@gladlog/analysis`。
- 新建离线 collector 工具:feed 采集 → gladlog parser → gladlog metrics → Python 天赋聚类桥 → 按 cell 聚合 → 写版本戳语料。
- 全语料重建(Solo Shuffle + 2v2 + 3v3 全部用 gladlog parser 重算,不只 arena)。
- 语料验证器(硬门)。

**范围外**:

- SP-B2:compare 引擎(verifiedComparison / exemplar prompt / claimChecker 的桌面 IPC handler)+ ProComparisonVerified UI + CDN 版本化分发。
- SP-A:结构化分析 UI(FindingsList 等)。
- 数据飞轮(用户端可选匿名上报累积样本)——引入轻量上报接口=某种后端,与"零后端"前提冲突,列为 SP-B 远期增强。

## 架构与组件

### 移植进 `@gladlog/analysis`(控制器对子项目 0 审计 CLEAN 提取)

| 源文件(旧 fork,审计 CLEAN)                                                       | 目标                | 说明                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/utils/healerMetrics.ts`                                                  | `@gladlog/analysis` | 6 维:offensiveIndex / reactionLatency / ccDensity / defensiveOverlapRatio / effectiveCastRatio / ccAvoidanceRate。吃 compat 的 legacy match 形状(`.units` / `damageOut.effectiveAmount`),换 parser type import 即可;依赖的 `analyzePlayerCCAndTrinket`/`reconstructEnemyCDTimeline` 已在 analysis。 |
| `shared/utils/matchEmbeddingRecord.ts` 的 `extractRotations` + crisisEvents 抽取 | `@gladlog/analysis` | crisisEvents = 该场的关键危机时刻序列(compare 的 exemplar 选择依据)。embedding 生成不移植(新管线不用)。                                                                                                                                                                                             |

### 新建离线 collector 工具(不进桌面 App)

放**新建 `packages/corpus-tools`**(专用离线包,与桌面 App 构建完全隔离,不进发布包),纯 Node CLI:

```
feed(wowarenalogs.com GraphQL, MIN_RATING=2300, 分 spec 配额)
  → 下载每场日志文本
  → GladLogParser(gladlog 自己的 parser)
  → toLegacyMatch/toLegacyShuffle(compat)
  → computeHealerMetrics + extractCrisisEvents(gladlog analysis)
  → Python 桥 get_spec_clusters.py(天赋聚类 → pythonClusterRank)
  → 按 cell 聚合(见下)
  → 写 reference_vectors.json(版本戳,去 embedding)
```

复用旧 fork CLEAN 文件的逻辑,换 parser/utils import:`buildArenaCorpus.ts` + `buildSoloShuffleCorpus.ts`(合并为一个统一 collector,参数化 bracket)、`buildHealerPlaystyleCorpus.ts`(enrich)、`processAndUploadVectors.ts`(聚合;去掉上传/embedding,只留本地聚合写文件)。

### Cell 定义(debate 结论:逃出聚合陷阱)

**问题**:治疗指标画像极度依赖敌方阵容;按 `spec × bracket` 粗聚合会算出不存在于真实对局的"缝合怪基线"。细化到完整 `enemy_comp` 又碎样本。

**解**:cell = `spec × bracket × matchArchetype`,archetype 复用 gladlog buildMatchContext **已有的** 粗粒度分类器(`[MATCH TYPE: cc_swap_burst / dedicated_tunnel / …]`,几个桶,非 39² 种 comp)。给战术上下文又不碎样本。配**层级回退**:

1. 优先用 `spec × bracket × archetype` cell;
2. 该 cell 样本 < N_floor → 回退到 `spec × bracket`(archetype-agnostic)父 cell;
3. 父 cell 仍 < N_floor → 标 `insufficient: true`。

SP-B2 消费时:insufficient 的组合显示"样本不足、暂不对比",绝不出假百分位。

**配额与 N_floor 的张力(实现期须调参)**:archetype 维度只有当每个 archetype-cell 都能凑够 N_floor=30 才有价值。旧 SS collector 的 `SPEC_QUOTA=50/spec` 在摊到 ~4 个 archetype 后每 cell 仅 ~12,大多不达标、退回 bracket-wide。故本管线的采集配额须按 **"让每 spec×bracket 的主流 archetype 各清 N_floor"** 设定(经验值约 `SPEC_QUOTA ≥ 30 × 主流archetype数`,即 100+/spec/bracket);冷门 archetype 允许退回 bracket-wide(接受)。具体配额在实现期按各 spec 实际 archetype 分布定,不是固定常量。

**不引入 embedding 近邻**:那正是旧仓因幻觉 30% 而废弃的老设计;exemplar-led(基于 metrics + crisisEvents 的诚实叙述)是已验证的胜者路径。

## 语料 schema(版本戳 + 去 embedding)

```jsonc
{
  "wowPatchVersion": "11.0.7.58123",   // debate 结论:版本戳,让 SP-B2 能判过期
  "builtAt": "2026-07-11T...",
  "sourceFloor": 2300,                  // MIN_RATING
  "cells": [
    {
      "spec": "RestorationDruid",
      "bracket": "3v3",
      "archetype": "cc_swap_burst",     // 或 "*" 表示 bracket-wide 父 cell
      "sampleN": 47,
      "insufficient": false,            // sampleN < 30
      "metrics": {                      // 每维分布(百分位),非单值
        "offensiveIndex": { "p10": .., "p50": .., "p90": .., "n": 47 },
        "reactionLatency": { "p10": .., "p50": .., "p90": .., "n": 44 }, // 逐维 n(部分场无该维)
        // … 其余 4 维
      },
      "exemplarCrises": [ /* 若干高分玩家的危机时刻样本,供 exemplar 选择 */ ]
    }
    // … 每 (spec,bracket,archetype) 一条 + 每 (spec,bracket,*) 父 cell 一条
  ]
}
```

去 embedding 后约 1.7MB(带 archetype 维度后略增,仍 < 3MB)。

## 数据源与合规

- **主源**:wowarenalogs.com GraphQL feed(用户**自有旧产品**的公共 API,数据主权在用户,非爬竞品;用户已确认 feed 可返日志)。仅构建期、维护者侧、离线调用。
- **回退源**(debate 采纳):用户自采日志语料作冷启动/回退基础,万一 feed 波动。
- **构建期 Python 依赖**:`/Users/mingjianliu/code/wow-talent-gear-collector` 的 `get_spec_clusters.py`(已存在)。维护者侧、离线。
- **发布层**:App 运行时零外部依赖,只吃静态语料。
- **合规**:提取只碰审计 CLEAN 文件(healerMetrics / matchEmbeddingRecord / buildArenaCorpus / buildSoloShuffleCorpus / buildHealerPlaystyleCorpus / processAndUploadVectors 全 CLEAN);`components/icons.tsx`(NEEDS_SCRUB)属 SP-A/SP-B2 UI 范围,不在本 spec。agy/子代理**不得读旧 fork**,提取由控制器做。

## 错误处理与验证门(硬门,CI/收官)

- **feed go/no-go**:B1 第一步冒烟测 feed(能否按 spec 配额返 2300+ 日志)。失败即切回退源或停工报告,不建到一半才发现。
- **每 cell 验证**:`reactionLatency` 的 `0 records === 1.5` 哨兵必须清零(旧 arena bug);crisis 技能名全 ASCII(英文,非 KR/CN 本地化);`sampleN ≥ 30` 否则 insufficient。
- **配额饱和**:collector 各 spec 达配额即停该 spec(旧 SS collector 会浪费翻页到 MAX_PAGES,需提前 kill)。
- **metric 一致性抽查**:对少量 fixture 场,gladlog healerMetrics 输出与移植前旧仓 golden 值比对(允许 4a 已裁决的 parser 漂移包络,但结构/维度一致)。

## 测试

- 移植 `healerMetrics.ts` / `matchEmbeddingRecord.ts` 的 CLEAN 单测(golden 断言,跑在 gladlog-compat fixture 上)。
- collector 对小样本 fixture(几场自采日志)跑端到端,断言 cell 聚合 + 层级回退 + insufficient 标记。
- 语料验证器本身单测(喂构造的坏 cell:1.5 哨兵 / 非 ASCII / N<30,断言全部被抓)。

## 交付策略(subagent-driven-development + agy)

- 走 SDD:每 task 派实现子代理 + task 审查 + 收官全面审查。
- **agy 角色**:`exec`(从控制器给的干净接口/spec 写自足代码,如语料验证器、metric 移植的机械部分)+ `review`/`verify`(跨家族独立复查 diff 与 load-bearing 主张)。今日翻盘仲裁 + meta-eval 已验证 agy 跨家族独立性有效。
- **硬边界**:提取旧 fork 代码只能控制器对着子项目 0 审计做;agy/子代理拿到的是干净接口与 spec,不指向旧文件路径。
- 独立性规则:不用 claude-family alias 复查 Claude 自己的工作。

## Debate 记录(spec ritual,agy / Gemini 3.1 Pro,conversation 4cd1e554)

- **认**:静态打包会随赛季/热修过时("刻舟求剑")→ 语料带 `wowPatchVersion`,分发改 CDN 版本化静默刷新(SP-B2 层);样本饥饿 N<30 出噪音 → N_floor=30 硬门 + insufficient 标记;数据飞轮是好主意但引入后端,列远期。
- **修正 Gemini 假设**:wowarenalogs 是用户自有资产,许可证/爬竞品顾虑不适用;采纳自采语料为回退源。
- **defend + 改进**:聚合陷阱(comp 依赖)→ 不重引 embedding(旧仓因幻觉废弃),改用 gladlog 已有的粗 archetype 分 cell + 层级回退,兼顾战术上下文与样本量。
- 终局 STANCE: PARTIAL(核心架构获认可,聚合陷阱经 archetype-celling 解决)。

## SP-B2 预告(下一 spec,不在本轮)

桌面主进程 IPC handler:`buildCompareLocalContext`(用户对局的 gladlog metrics)→ 查语料匹配 cell(archetype 层级回退)→ `verifiedComparison`(逐维百分位)→ `buildExemplarLedPrompt` → Anthropic 流式 → `claimChecker` 确定性门 → `ProComparisonVerified` UI。CDN 版本化语料刷新(比对 wowPatchVersion)。缓存同 ai.analyze(每对局 + 语料版本)。
