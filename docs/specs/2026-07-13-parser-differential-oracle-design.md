# A1 — Parser 差分预言机(LOG 支柱 parity gate)设计

日期:2026-07-13
状态:待用户审阅

## 背景与目标

可验证性路线图(`docs/verifiability-roadmap.md`)Pillar A 第一子项目。**证明新 gladlog parser 把原始战斗日志解析成正确的结构化对局**:在真实日志上并行跑旧 fork 解析器(oracle)与新解析器,对**应用实际消费的字段**做结构化 diff,把 parity 设成**可复跑的门槛**,抓住 golden 测试漏掉的静默解析回归。双受众:除 CI 外,更是**跨 agent 验证/反馈**基元——headless 可跑 + 机器可读 diff。

**这不是从零证明 parity**——M4(`docs/reports/2026-07-10-m4-differential-report.md`,200 日志)与 2026-07-11 e2e(`docs/reports/2026-07-11-e2e-old-vs-new-regression.md`,1190 场)已一次性穷尽证明 Level-1 parity(599/600、零未裁决差异),并留下 ~30 条裁决台账。A1 的价值是把那套**驻旧 fork scratch、一次性、不可复跑**的差分,**产品化为私有仓库里一个驻留、带裁决基线、可 gate 的预言机**,专抓**新引入**的回归。

范围:**Level-1 核心事实 + Level-2 下游 prompt**(用户明确要两层),两层分桶隔离,prompt 层回归不与 parser bug 混淆。

## 合规拓扑(硬约束)

旧 fork(`~/code/wowarenalogs`,CC BY-NC-ND)仅可**本地私用**。边界画法:**唯一触碰旧 fork 代码的文件只有一个,且只吐 JSON。**

- **旧侧 runner** —— 留在 `~/code/wowarenalogs/scratch/parser-diff/runOld.ts`(既有,加固)。它是唯一与旧 fork 耦合的产物;每份日志吐两块 JSON:(a) Level-1 规范化核心事实,(b) 旧 `IArenaMatch`(供 Level-2)。**controller 亲写、controller-only。**
- **私有预言机** —— 住 `~/code/gladlog-eval-private/oracle/`,**100% 不含旧 fork 代码**:它 spawn 旧侧 runner 消费其 JSON;从公开 gladlog workspace import **新**侧(`GladLogParser → toLegacyMatch → IArenaMatch`);做规范化、diff、分类、gate。
- **clean-room:** agy/子 agent **永不读旧 fork**。因预言机只消费旧侧 JSON,子 agent 可安全参与除 `runOld.ts` 外的一切。
- **公开 gladlog** 只得:本设计文档 + 一个可选 `npm run verify:parser-oracle`(私有预言机在则 shell 过去,不在则优雅跳过,同 eval oracle 惯例)。**不进公开 CI**(GitHub runner 无旧 fork);这是本地/pre-merge + agent 可跑的门槛。

## agy 辩论结论(仪式,conversation debate-open,OPPOSE→采纳)

原设计用**聚合包络**(damage 漂移 median≤4%/p90≤14%)+ **布尔结构签名** gate。agy 驳:粒度错,放**假阴性**——(a) 局部 per-match 回归其语料聚合漂移仍落在 median/p90 包络内 → 漏过;(b) 新回归塌进已在白名单的结构签名 → 静默通过。

**采纳 steelman:不是放宽容忍去吸收噪声,而是建模噪声。**

- **Per-match 归约 shim:** M4 已把残差精确隔离到 `#14 periodic 清零`(白名单 = Σ 旧 eff=0 行 amount,**确定性可建模**)等。对每场比对时,把这些**已精确刻画**的旧解析器怪癖以数学 shim 施加到**新**侧输出上(仅为比对),归约后 per-match 数值容忍**收紧到 ~0%(<0.1%)**。局部回归再也藏不进聚合。
- **Incidence bounding:** 结构签名白名单断言**精确 per-match 发生次数**,非布尔类别匹配。签名再现次数超过裁决数(= 新增发生)即算新差异 → FAIL。

**辩护(部分):** `#19 absorbed 扣减跨年代自相矛盾`(M4 冻结为"新侧语义为准")—— M4 记其为"每法术统一偏移 5-13%",**若** per-(spell,era) 可确定性建模则同样走 shim;**若**残差确实无法确定性归约,则退化为**限定到受影响 spell 集**的窄包络(非语料级 damage 全包络)+ incidence 追踪,把容忍严格局限在裁决成因上。

## 组件(`~/code/gladlog-eval-private/oracle/`)

- `runOld`(旧 fork 内) → 旧核心事实 JSON + 旧 `IArenaMatch` JSON。
- `runNew.ts` → gladlog 解析 + `toLegacyMatch` → 新核心事实 + 新 `IArenaMatch`。
- `align.ts` → 两侧 match/round 对齐:死亡签名 LCS over `(file, index)`(沿用 e2e 方法)。
- `reconcile.ts` → **per-match shim**:把 `#14` 等已刻画怪癖施加到新侧(或从旧侧扣除),产出可 ~0% 比对的规范值;shim 规则表 = `baseline.json` 的一部分,每条引用其 M4 裁决号。
- `normalize.ts` → Level-1 核心事实规范化 + 枚举序 canon(构造上消灭 enum-order 桶)。
- `diffLevel1.ts` → 核心事实逐字段 diff(shim 后)→ 分类 `Divergence`。
- `diffLevel2.ts` → 两侧 `IArenaMatch` 喂**同一个** gladlog `buildMatchContext`(timeline 变体)→ prompt 行 diff → 分类。
- `classify.ts` → C 机制:每差异分桶 `identical | enum-canon | numeric{within|over} | structural{known-sig|new}`;结构桶带 **incidence** 比对。
- `baseline.json` → 机器可读裁决基线:shim 规则 + 数值容忍(shim 后 ~0%,#19 残差的窄 per-spell 包络)+ 结构签名白名单(**每条含 expected incidence**),每条引 M4/e2e 裁决号。
- `gate.mjs` → 编排;读 `corpus/manifest.txt`(默认 seeded T1-200,`--full` = 全 1190);出 `report.json` + `summary.md`;有任何**新未裁决差异**则非零退出。
- `adjudications.md` → 移植的人读台账(基线每条的"为什么")。

## 数据流

`manifest → 每份日志:{runOld(spawn)→JSON, runNew→JSON} → 对齐 matches → reconcile(shim 已刻画怪癖) → Level-1 规范化+diff+分类 → Level-2 buildMatchContext(两侧)+行 diff+分类 → 分类差异 vs baseline.json(shim 后 ~0% 数值 + incidence-bounded 结构签名)→ report.json + summary.md → 退出 0(全裁决)/ 1(有新差异)`。

## Gate(C + agy 采纳,具体)

- **Level-1 核心事实**(依 M4):对局切分、名单/单位集、spec、teamId、胜负、真死亡(排除 unconscious)、伤害&治疗总量。
  - *类别*字段(名单/spec/队伍/胜负/死亡数):**精确**;任何 mismatch → 结构签名,须在白名单**且 incidence 未超** 否则 FAIL。
  - *数值*总量:**先 reconcile shim**(#14 等)→ per-match 容忍收紧 `<0.1%`;超即 FAIL。治疗 shim 后应 ≈0(M4:中位 0.00%/p90 0.00%)。`#19` 残差:优先 per-spell shim;不可建模部分走限定到受影响 spell 集的窄包络 + incidence。
- **Level-2 prompt**:行 diff 分桶 `numericDrift`(受同一 shim/容忍约束)、`enum-canon`(规范化消除)、`structural`(签名白名单 + incidence)。新结构签名(如整块消失,类 e2e R1/R2)或已知签名 incidence 超标 → FAIL。
- **结构签名** = `{level, category, normalized-locus}` + `expectedIncidence` —— locus 跨场稳定、非 per-match 逐条,故合法差异塌成一签名、基线小而可复核;incidence 防"塞进已有签名"。

## 错误处理与确定性

- 旧 runner 崩溃 / 日志不可解析 → 记 `oracle-error`,**不静默跳过、不计过**。
- 对齐失败(单位集不合) → 作结构差异(M4 #1–5 类)浮出 → 裁决或 FAIL。
- 旧 fork 缺失 → 硬报错并给清晰信息;公开 wrapper 优雅跳过。
- 确定性钉死:时区 UTC、抽样 seed `20260710`、prompt 变体 `timeline`、datagen/build manifest —— 复跑逐字节可复现。

## 测试(私有仓库内,**不含旧 fork**——合成 `IArenaMatch` 对)

- 单元:`normalize`/enum-canon;`reconcile` shim(合成含 #14 型 eff=0 行 → shim 后两侧相等);`classify`(合成对 → 正确桶);基线匹配器(已知签名+正确 incidence 过,新签名/超 incidence 挂);shim 后 <0.1% 容忍。
- **有牙齿证明:** 注入合成的**新侧回归** —— (a) 删一个死亡、(b) 把某伤害总量抬到 shim 后 >0.1%、(c) 删一个 prompt 块 —— gate **必须 FAIL** 且分类正确。仿 C1 的撒谎渲染测试。

## 范围外

- **不**从零重裁语料(M4 已做);基线从既有 `adjudications.md` 移植。
- **不**修任何本 gate 发现的 prompt 回归(如 R1/R2/R3)—— 入 backlog,同 e2e 处置。
- **不**进公开 CI(无旧 fork);本地 + agent 可跑 + 私有。
- Level-2 之外的下游(replay/export 等)不在本 gate。

## 未决事项

- `#19` 是否 per-(spell,era) 可确定性建模,实现期用真实语料实证:可 → 并入 shim、容忍全程 <0.1%;不可 → 限定窄 per-spell 包络(记录受影响 spell 集 + 成因)。二者皆闭合假阴性(容忍不再是语料级全包络)。
