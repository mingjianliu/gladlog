# DPS 玩家方向 —— 头脑风暴(2026-07-18)

> 现状:AI 复盘管线假定 owner 是治疗(`StructuredAnalysisPanel` 里
> `if (!healer) return null`;`buildMatchContext` 的 richContext 以 healer 为
> 主角)。DPS 玩家 —— 玩家群体的大多数 —— 打开 AI 视图是空的。
> 本文回答:DPS 复盘到底要什么、现有资产哪些直接可用、缺什么、怎么分期。

## 一、DPS 玩家复盘的四个核心问题(jobs-to-be-done)

治疗复盘问"我救没救到";DPS 复盘问的是完全不同的四件事:

1. **我的爆发打进"空气"了吗?**(爆发对齐)
   开了大 CD,但打进了对面的减伤/免疫(Turtle/Ice Block/Obsidian Scales active)、
   或没和队友爆发窗口重叠、或目标满血远离死亡线 —— 全是白给。
   这是 DPS 最贵的错误,每场 2-4 次机会。

2. **该切的时候我切了吗?**(目标选择)
   敌方治疗被变羊的 6 秒里,你 78% 的伤害还打在坦身上 —— kill window 开着,
   伤害没进窗口目标。数据我们全有(kill window 已按目标算团伤)。

3. **我把队友的 CC 踩了吗?**(DR 排轴)
   锤子接在队友沉默/凋零后半时长落地 = 浪费一个 60s CD。drAnalysis 的 DR 链
   已经算得很准,缺的是 **per-caster 归因**:"你的 X 在该目标 DR 50% 时施放,
   实际 2s(满 4s)"。

4. **我的打断被骗了吗?**(kick 管理)
   对面假读条骗掉你的 kick → 真读条自由施放。**castStarts 落地后这成为可做的
   杀手应用**:cast start → 无 success(主动取消)+ 你的 kick 在取消后 0.5s 内
   落空 = 被 juke;反之敌方真读条你 kick 命中 = 好 kick。此前无 cast-start
   数据根本判不了。

外加通用项(已就绪):怎么死的(死亡回顾已覆盖双方)、被控/打断统计(统计表)、
窗口色带、跨场聚合。

## 二、资产盘点

**直接复用(视角无关)**:computeOffensiveWindows + bursts、drAnalysis、
ccTrinketAnalysis(宠物修复后)、dispelAnalysis 双向、deathOutcome/死亡回顾、
统计表、战绩仪表盘、candidateFindings 的 death/cd-waste 类事件。

**治疗专属(DPS 版不适用,保留不动)**:healer_offense(slack-gated)、
healingGaps、healer exposure、HPS 基准。

**要新建的分析(全部有数据基础)**:

- `burstAlignment.ts`:owner 的进攻 CD 施放 × 敌方减伤/免疫 active 区间
  (SPELL_CATEGORIES buffs_defensive/immunities + aura 区间)× 队友爆发窗口
  (enemyCDs 的镜像,对己方算)× 目标当时 HP。产出
  "3 次爆发:1 次打进 Turtle(0 收益)、1 次单开、1 次与队友对齐 → 击杀"。
- `targetAudit.ts`:每个 kill window 内 owner 伤害按目标拆分 vs 窗口目标。
- DR 归因:drAnalysis 输出加 casterName(链数据已有),findings 引用。
- `kickAudit.ts`:castStarts × SPELL_INTERRUPT × cast-cancel 判 juke/好 kick。
  (注意:旧存档无 castStarts,该分析对旧场次自动缺席 —— 同读条条先例。)

## 三、架构改造点(一次泛化,两边受益)

1. **owner 视角泛化**:`buildMatchContext` 把 healer-owner 假设改为
   `ownerRole: "healer" | "dps"` 分支 —— 时间轴/死亡/CC/DR/窗口全部通用,
   仅把 healer_offense 块换成 DPS 的 burst ledger 块。
   `StructuredAnalysisPanel` 的 `if (!healer) return null` 改为按 owner spec
   选视角。
2. **candidateFindings 扩展**:新增事件类型 `burst-into-immunity`、
   `off-target-in-window`、`dr-clipped-cc`、`juked-kick`(每类都是确定性
   谓词产出,LLM 只做叙事 —— 沿用 findings 审计管线,引用不实自动丢弃)。
3. **prompt 版图**:PROMPT_VERSION bump(新块);治疗 prompt 不动,
   DPS prompt 是新变体 —— 互不影响,eval 分开跑。

## 四、eval 侧(别跳过)

- 语料:现有 70 日志是 healer 视角记录,但 **owner 可以换**(日志记录者是谁
  不影响以其他玩家为分析主角的确定性部分;不过 [YOU] 视角的资源/意图信息只有
  记录者有)。第一期用"记录者本人是 DPS"的日志最干净 —— 需要收集一批
  DPS-owner 日志(或用现有日志里 owner 的 DPS 队友做降级验证)。
- rubric:7 维通用,但 sufficiency 锚点要 DPS 化(爆发对齐数据在不在、
  DR 归因在不在);judge-instructions 出 DPS 变体。
- 老规矩:确定性门先行(burst-into-immunity 率、off-target 率都可以门规化),
  LLM 判官只管叙事质量。

## 五、分期建议

- **D1(纯 UI,无 prompt 风险)**:burstAlignment/targetAudit/kickAudit 三个
  derive + 战报视图的 "爆发账本" 卡(每次爆发一行:时刻/目标/对齐状态/收益,
  可点跳回放)。DPS 玩家立刻有确定性复盘可看,不动 AI。
  **✅ 账本三件 2026-07-16 完成**:analysis `burstLedger.ts`(爆发分组复用
  enemyCDs 的 BURST_CLUSTER_SECONDS/CD 谓词;免疫命中用真实 aura 区间
  `buildAuraIntervals`)+ `kickAudit.ts`(landed = SPELL_INTERRUPT 镜像;
  juked 用 castStartEvents,回溯常量与读条条 CAST_BAR_MAX_MS 断言相等);
  parser-compat 补可选 `castStartEvents`;战报卡 `BurstLedgerCard`(玩家分页、
  三节、行行 ▶ 跳回放)。旧档 kick 判 unknown,重导入即有读条数据。
  **✅ 回放视觉两件 2026-07-16 完成**:敌方进攻 CD active 红光脉冲环
  (span = burstCastSpan,与账本审计同一区间)+ 同秒集火金色虚线环
  (2+ 敌对玩家同一整秒打同一目标;宠物归主人)。**D1 全部收官。**
- **D2(AI 泛化)**:owner 视角泛化 + 4 类新 candidate events + DPS prompt
  变体;/eval-baseline DPS 版跑通。
  **✅ 2026-07-16 完成**:owner=日志记录者(治疗 prompt 字节不变,单测钉死);
  DPS owner 得 `<burst_ledger>` 块 + 四类新事件(legend 按在场类型动态);
  PROMPT_VERSION 4。eval:`buildCorpus --owner dps`(降级语料 176 场)+
  门规主语三修 + 插值盲区补网格 → 几何门 0/2665;6 场 sonnet 冒烟全部
  以账本为骨架(runId 2026-07-16-dps-smoke)。
  **✅ 正式 DPS baseline 2026-07-16 收官**(runId 2026-07-16-dps-public):
  60 场真 DPS 记录者公开对局(wowarenalogs 公开通道),DPS judge 变体,
  全 sonnet。acc 4.52(与治疗基线持平)/ suff 4.60 / focus 4.98 /
  outcome 4.97;hard flag 1;factAudit 166v/14r/0u;账本为 60/60 回复骨架。
  Top 修复项(全确定性):kickAudit 宠物 kick src + 队友踢断误判 juke、
  off-target 窗口截断在目标死亡、[HEALER EXPOSURE] 饰品主语、野生 CC 覆盖
  尾巴排查。详见 eval-report.md。
- **D3(闭环)**:DPS findings 进「最常犯的问题」聚合与「本场目标」
  (backlog #12–#19 的教练闭环对 DPS 同样成立)。

## 待拍板

1. D1 先行(确定性爆发账本,不碰 AI)还是直接 D2(全线泛化)?
2. DPS-owner 语料:你有 DPS 视角的日志吗,还是先用队友降级验证?
3. 第一个目标 spec(建议挑你常一起打的搭子专精,rubric 锚点好写)。
