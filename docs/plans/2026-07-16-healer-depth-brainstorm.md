# 治疗方向还能做什么 —— 头脑风暴(2026-07-16)

> 治疗是现在产品的主线(prompt/eval/UI 全部围绕 healer owner),基础盘已厚:
> healingGaps、exposure/LoS、healer_offense、驱散覆盖、CC/饰品、死亡回顾、
> kill window、HPS 基准。本文回答:在这个基础上,治疗玩家还缺什么。
> 配套:`2026-07-18-dps-direction-brainstorm.md`(DPS 方向)。

## 零、两个数据事实(本文的地基,已核实)

1. **法力值在原始日志里,但 parser 扔掉了。** advanced 参数行携带
   powerType/currentPower/maxPower(在 maxHp 和 x/y 之间的那段),
   `decodeAdvanced`(`packages/parser/src/l1/decoders.ts:139`)目前只解
   hp/maxHp 然后直接扫到坐标。补 3 个字段 + L3 采样管道 + 重导入,
   就能拿到 owner 的**逐事件法力曲线**(治疗每个 GCD 都出 advanced 行,
   采样密度极高)。同 castStarts 先例:旧档自动缺席,重导入即有。
2. **overheal 在 L1 解了、L3 扔了。** `decodeHeal` 已解析 overheal/absorbed,
   但 GladUnit 的 heal 事件里没带出来。小改一处 plumb-through。

两条都是 parser 改动 → **必须过差分预言机 gate**(新字段 additive,
diff 规则要允许新键)。建议合成一个 parser PR 一次过 gate、一次重导入。

## 一、治疗复盘的下一层问题(现在答不了的)

1. **我的蓝管得好吗?**(法力管理 —— 治疗身份的核心技能,目前完全空白)
   - 法力曲线 vs dampening 曲线:oom 时刻出现在第几分钟、是不是总在
     dampening 20% 后崩;
   - 回蓝 CD(法力潮汐/暗影魔/药水)时机:是不是拖到 90% 蓝才按;
   - 每点蓝的有效治疗(effective healing per mana):高耗蓝技能滥用检测;
   - 喝水检测:法力回升斜率突变 = drink 窗口,和敌方压力时段对照。
     → 依赖事实 0.1。**这是治疗版的"爆发账本"—— 杀手级,且只有 owner 有数据,
     而我们的语料恰好全是 healer owner。**

2. **我奶对人了吗?**(triage 质量)
   - 快照对照:你每次大额治疗落点时,场上最低血的队友是谁 —— "队友 30%
     时你在奶 90% 的 DPS";HP 采样 + healOut by target 数据已有;
   - overheal 率按技能拆(依赖事实 0.2):大 CD 打了 80% overheal = 恐慌按键;
   - 与 healingGaps 互补:gaps 说"你没奶",triage 说"你奶了但奶错了"。

3. **我的读条纪律怎么样?**(castStarts 的治疗侧杀手应用,数据已落地)
   - 被断审计:你被 kick 断掉的读条里,多少是在敌方 kick 明显可用时
     硬读的高价值法术(被断学派锁 X 秒的统计已有,归因没有);
   - fake cast:cast start → 主动取消 → 敌方 kick 落空 → 真读条完成
     = 教科书骗断,应该被表扬([VULNERABLE] 同款"没做也要说"逻辑的反面);
   - 与 DPS 版 kickAudit 是同一套事件几何,两边共享谓词。

4. **敌方开大时我反应多快?**(爆发响应延迟)
   - 敌方进攻 CD 开启(enemyCDs 已有)→ 你的第一个减伤/大奶 GCD 的秒数;
   - 被集火 spike → 破 LoS 的秒数(positions + LoS 谓词已有,
     healer exposure 的反向:exposure 说你站错,响应延迟说你修正得慢不慢)。

5. **驱散质量(不只是覆盖率)**
   - 关键 debuff applied → dispelled 的中位延迟(锁毒 8 秒才驱 ≈ 没驱);
   - 驱散优先级错误:致命 magic 挂着时驱了低价值 debuff;
   - 覆盖门已把"驱没驱"钉死(<80% 场次 104→4),下一层是"驱得多快、对不对"。

6. **进 CC 前的预备**(被控是必然,预备是水平)
   - 进入 CC 瞬间队伍身上的 HoT/盾快照:裸队进羊 vs 满 HoT 进羊,
     后续 5 秒承伤结局对照;aura 区间 + CC instances 数据全有。

## 二、优先级与分期

- **H1(parser 数据补齐,一个 PR)**:power 三字段 + overheal plumb;
  过 oracle gate;重导入。不做这个,#1/#2 半残。
- **H2(确定性分析 + UI,不碰 prompt)**:
  - 回放/HP 曲线加 owner 法力曲线(蓝色细线,oom 标记);
  - 战报"治疗账本"卡:triage 快照表 + 驱散延迟 + 读条纪律,行行可点跳回放
    (与 DPS 爆发账本同构,卡片框架共享);
  - 仪表盘 healer trend:oom 时刻/被断次数/驱散延迟 跨场曲线。
- **H3(AI 层,走 /eval-ab)**:prompt 新增 [MANA] 块与 triage 证据行;
  candidateFindings 新类型 `late-dispel`、`wrong-target-heal`、`panic-cd`、
  `good-fake-cast`(确定性谓词产出,审计管线复用)。healer prompt 已成熟,
  每块单独 A/B,别打包。

## 三、待拍板

1. H1 parser PR 先行吗?(它同时喂 H2/H3,且重导入这事越早越好)
2. 治疗账本 vs DPS 爆发账本谁先做?(卡片框架共享,先做谁另一个就便宜)
3. [MANA] 块要不要赶下轮 baseline 一起验(与 DR legend/FOCUS DISCIPLINE
   的 factAudit 验证同批)?
