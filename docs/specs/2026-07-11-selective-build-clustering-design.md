# SP-B1.5:选择性 keystone-天赋分组(build-aware 群体基线) — 设计

日期:2026-07-11
状态:设计(待用户复核)
所属:SP-B(Pro Comparison)。SP-B1(群体语料重建)的增补子项目,在 SP-B2(compare 引擎+UI)之前落地,因为它改语料 schema 且预定 SP-B2 的查表契约。

## 目标

一句话:对**天赋build 会实质改变被对比指标**的治疗专精,把群体 cell 再按一个**确定性的 keystone-天赋布尔门**分组(spec × bracket × archetype × buildGroup),让"你的打法 vs 高分群体"在同一 build 家族内比较;对 build 不影响指标的专精保持 archetype-only,不做无谓分裂。

## 背景与动机(实证)

SP-B1 收官后做了一次 build→指标方差研究(3600 场真实 2300+ Solo Shuffle 逐轮记录,**在固定 archetype 内**测,对照随机划分 null):

- **Discipline Priest**:offensiveIndex 明显二分 —— 约 22% 玩家跑一套 build,offensiveIndex 中位 **0.49 vs 标准 0.20(2.4×)**,在所有 archetype 上 permP=0.000。该 build 由 **Voidweaver 系**节点标定:Expiation(82585)、Death's Torment(110277)、Abyssal Reverie(82583),三者在 22% 处共现。
- **Holy Paladin / Restoration Druid / Restoration Shaman**:offensiveIndex 或 ccDensity 上有实质但更薄的 fork(如 Resto Druid 高-CC build 由 **Lycara's Inspiration(92229)** 标定,+1.07 ccDensity,约 10% 玩家)。
- **Mistweaver Monk / Preservation Evoker**:**零**实质 build 效应 —— 一刀切加 build 维度只会白白碎样本。

结论:build 是**真实且大**的混杂因子,但**因专精而异**。把 offensive-build 与标准 Disc 混进同一 cohort,会让标准 build 玩家在被 0.49 拉高的 mixed 基线下误显"进攻偏低"。Disc Priest 是最热门治疗,故这是旗舰案例。

**为何用 keystone 布尔门而非 k-means 聚类**(设计 debate 结论,见文末):k-means/动态 gate 有三处硬伤 —— (1) 每次重建按经验重新划分 → 用户百分位随补丁重建无声漂移(基线应对时间确定);(2) 稀疏二元天赋向量的质心等距 → hybrid build 因无关小天赋被丢进错 cohort;(3) 固定 k 强折叠真实模态。keystone 布尔门确定、O(1)、可解释("对比 offensive-build Disc"),且方差研究里的 fork 恰好都锚定在具名 keystone 节点上,不是弥散组合。

## 范围

**本 spec(SP-B1.5)**:

- **离线发现工具**(维护者侧):方差研究 + 节点分离度排名,产出**候选 keystone 门**供人工复核。
- **keystone-门表**:版本戳、人工复核的静态数据(`spec → keystone 节点 + 布尔算子 → 组标签`)。
- **collector 分组**:对已激活门的专精,cell 再按 buildGroup 分裂;保-build 层级回退;N_floor 守卫。
- **offensiveIndex winsorization**:研究暴露的离群(healing≈0 时比值爆炸)在聚合前截尾。
- **语料 schema 扩展**:cell 加 `buildGroup`;顶层加 `buildGroups`(激活门,供 SP-B2 消费)。

**范围外**:

- SP-B2:运行时把用户 build 判到组(nearest —— 这里是布尔判定)、fail-open 降级、compare 引擎与 UI。本 spec 只定义其**查表契约**,不实现。
- 非 keystone-可分的 fork(弥散中层节点组合):有意**不覆盖**,留 archetype-only —— debate 采纳:此类多为调数/工具偏好噪音而非独立打法。

## 架构与组件

### 1. 离线发现工具(`packages/corpus-tools/scripts/`,维护者侧,不进发布)

复用已有 `collectBuildStudy.ts`(采 SS 逐轮 `{session,player,spec,archetype,talents,metrics}` 行)。新增 `discoverKeystones.ts`:

- 对每个专精,在**固定 archetype 内**对 offensiveIndex / ccDensity 跑置换检验(H 统计 + 随机划分 null,NP≥500);spec 若任一 archetype stratum permP<0.05 且中位 gap ≥ 阈值(offensiveIndex 0.10 / ccDensity 0.30)则标 **forking**。
- 对 forking 专精,对每个天赋节点算 `median(metric | 含节点) − median(metric | 不含)`,按 |diff| 排名;筛**候选 keystone**:prevalence ∈ [8%, 45%](既非核心必点也非极稀有)且 |diff| ≥ 阈值。
- 输出候选门(节点 id + 解析出的天赋名 + prevalence + gap + 关联 metric)到 stdout,供维护者复核后手写进门表。**工具只建议,不自动改门表**。

> 研究已验证:Disc → {82585,110277,82583}(Voidweaver, any);Resto Druid → {92229}(Lycara's Inspiration)。

### 2. keystone-门表(`packages/corpus-tools/data/keystoneGates.json`,版本戳,人工复核)

```jsonc
{
  "wowPatchVersion": "12.1.0.68629", // 门表对应的游戏版本,SP-B2 据此判过期
  "gates": [
    {
      "spec": "Discipline Priest",
      "keystoneNodeIds": [82585, 110277, 82583], // Voidweaver 进攻包(共现)
      "match": "any", // any | all
      "metric": "offensiveIndex", // 该 fork 的主指标(记录用途,便于复核)
      "groupPresent": "offensive",
      "groupAbsent": "standard",
    },
    // Holy Paladin / Resto Druid/Shaman 视 N_floor 守卫结果按需加
  ],
}
```

门表**只在维护者重跑发现工具+人工编辑时**变化 —— 基线对时间确定,补丁不会无声重划分。

### 3. collector 分组(改 `cellAggregator.ts` + `perMatchRecord.ts`)

- `perMatchRecord.combatToRecords`:对每条治疗记录,若其 spec 在门表中,按门(`match` 算子作用于 `keystoneNodeIds` 与该治疗的 `talents`)判 `buildGroup = groupPresent|groupAbsent`;否则 `buildGroup = "*"`。记录带上 `buildGroup`。
- `cellAggregator.aggregateCells`:cell 键变为 `spec|bracket|archetype|buildGroup`。发射的 cell 因专精是否门控而异,且**每个发射的 cell 都在某条回退链上**(不发无用 cell):
  - **非门控专精**(buildGroup 恒 `*`):`spec×bracket×archetype×*` 与 `spec×bracket×*×*` —— 与 SP-B1 完全一致。
  - **门控专精**:`spec×bracket×archetype×buildGroup`(完整)、`spec×bracket×*×buildGroup`(**build 父**:保 build、并 archetype)、`spec×bracket×*×*`(bracket 父)。**不发** `archetype×*`(该 tier 在保-build 回退链上用不到)。
- **回退偏好 = 保 build**(证据支撑):方差研究**证明**了门控专精的 build 效应(Disc offensiveIndex 2.4×),但**未**证明其在某稀有 archetype 上另有大差异;故完整 cell 稀疏时,"跨 archetype 的同 build 组"(`*×buildGroup`)比"同 archetype 的混 build"(`archetype×*`)更诚实。
- **N_floor 守卫(门激活条件,build 期算)**:门控专精的门只有当**其每个 buildGroup 的 `spec×bracket×*×buildGroup`(build 父)cell 都达 N_floor=30** 才**激活**;否则该专精**整体回落为 archetype-only**(cell 只出 `buildGroup="*"`,同非门控),且**不写进语料 `buildGroups`**。保证语料里出现的分组一定有样本支撑。

### 4. offensiveIndex winsorization(改 `cellAggregator.ts`)

聚合每个 (cell, offensiveIndex) 池时,先把值**截尾到池内 p99**(`v = min(v, p99)`),再算 p10/p50/p90。根因:offensiveIndex = 伤害/治疗,当某轮治疗≈0(早死/纯输出轮)比值爆炸(研究见 51.16 离群)。截尾保 p90 不被长尾污染。仅作用于 offensiveIndex(唯一无界比值维);其余维不动。

### 5. 语料 schema 扩展

```jsonc
{
  "wowPatchVersion": "...", "builtAt": "...", "sourceFloor": 2300,
  "buildGroups": {                    // 仅**已激活**(过 N_floor 守卫)的门控专精
    "Discipline Priest": {
      "keystoneNodeIds": [82585,110277,82583], "match": "any",
      "groupPresent": "offensive", "groupAbsent": "standard"
    }
  },
  "cells": [
    { "spec":"Discipline Priest","bracket":"Rated Solo Shuffle","archetype":"hybrid",
      "buildGroup":"offensive", "sampleN":138,"insufficient":false,"metrics":{…},"exemplarCrises":[…] },
    { "spec":"Discipline Priest","bracket":"Rated Solo Shuffle","archetype":"*",
      "buildGroup":"offensive", "sampleN":312, … }  // build 父(跨 archetype),回退用
    // 非门控专精所有 cell buildGroup 恒 "*"
  ]
}
```

## 运行时契约(SP-B2 消费,本 spec 只定义不实现)

- **判组**:`g = corpus.buildGroups[userSpec]` 存在则按 `g.match`/`g.keystoneNodeIds` 对用户 build 的 talents 布尔判定 → `groupPresent|groupAbsent`;否则 `"*"`。
- **回退(保-build 3 级)**:`spec×bracket×archetype×buildGroup` → `spec×bracket×*×buildGroup`(保 build、并 archetype)→ `spec×bracket×*×*` → insufficient("样本不足")。非门控专精为 2 级(`archetype×*` → `*×*`,同 SP-B1)。
- **fail-open(硬约束)**:若 `corpus.wowPatchVersion` 与当前游戏 build 主版本不符,**或** `keystoneNodeIds` 在当前天赋树数据中不存在(节点被移除/改号),则该 spec 静默回落 `buildGroup="*"`,绝不崩、绝不盲评失效节点 id。

## 错误处理与验证门(硬门)

- **门表校验**:`validateCorpus` 扩展 —— 每个 `buildGroups` 条目的 `keystoneNodeIds` 非空、`match ∈ {any,all}`、`groupPresent≠groupAbsent`;语料里出现的每个非 `*` `buildGroup` 必在对应 spec 的 `buildGroups` 声明内;每个非 `*` buildGroup cell(或其 buildGroup 父)`sampleN ≥ N_floor`(守卫的事后断言)。
- **winsorization 断言**:offensiveIndex 分布 p90 ≤ p99 池上限(不可有截尾后仍超界)。
- **schema 兼容**:非门控专精 cell 的 `buildGroup` 恒 `"*"`;`buildGroups` 为空对象时语料退化为纯 SP-B1 形状(向后兼容)。

## 测试

- 发现工具:合成行(planted 一个"含节点 X → 高 metric"的 fork)→ 断言该节点被排为首位候选;无 fork 的合成 spec → 断言不产候选。
- 门判定:`combatToRecords` 对含/不含 keystone 的合成治疗 → 断言 buildGroup 正确;`match:"all"` 与 `"any"` 分别覆盖。
- N_floor 守卫:构造某专精分裂后组 <30 → 断言回落 archetype-only 且不写进 `buildGroups`;≥30 → 断言保留。
- 保-build 回退:构造缺 `archetype×buildGroup` 但有 `*×buildGroup` 的语料 → 断言回退命中 build 父(而非降到 build-agnostic)。
- winsorization:池含 51.16 离群 → 断言 p90 被截、未污染。
- 端到端真跑(维护者门):重建语料,断言 Disc Priest 出 `offensive`/`standard` 两组且均达 floor,Mistweaver 恒 `*`。

## Debate 记录(spec ritual,agy / Gemini 3.1 Pro)

- **第一轮(是否分组)**,conversation 9fe91dff:agy OPPOSE 我的"defer 到 SP-B2 看反馈"。认:silent-failure trap(用户不报基线 bug,直接流失)、archetype-一致性要求同等对待 build。我反驳:build 多样 ≠ 指标发散(未证)。共识:跑**固定 archetype 内**的 build→指标方差研究定夺 → PARTIAL。研究结论:Disc 等实质发散、MW/Evoker 不发散 → 选择性分组。
- **第二轮(设计)**,agy OPPOSE k-means/动态 gate 设计,四点:样本塌陷、动态 gate 基线不稳、质心等距、强制 k=2;steelman = 静态 keystone 门。我认下不稳/等距/强制 k;综合为"方差研究做离线**发现**,keystone 布尔门做运行**机制**"。agy **CONCEDE**:静态 keystone 门提供必要的确定性与性能;"弥散 fork 不覆盖"是健康约束;版本戳**当且仅当** fail-open 降级严格定义时安全(已纳入运行时契约硬约束)。

## SP-B2 预告

读 `corpus.buildGroups` 做布尔判组 → 保-build 回退取 cell → 逐维百分位(build-aware)→ exemplar-led prompt → claimChecker → ProComparisonVerified UI;fail-open 降级;CDN 版本化(比对 wowPatchVersion + 门表版本)。
