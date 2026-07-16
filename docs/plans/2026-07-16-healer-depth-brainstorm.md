# 治疗方向还能做什么 —— 头脑风暴(2026-07-16)

> 治疗是现在产品的主线(prompt/eval/UI 全部围绕 healer owner),基础盘已厚:
> healingGaps、exposure/LoS、healer_offense、驱散覆盖、CC/饰品、死亡回顾、
> kill window、HPS 基准。本文回答:在这个基础上,治疗玩家还缺什么。
> 配套:`2026-07-18-dps-direction-brainstorm.md`(DPS 方向)。

## 零、两个数据事实(已核实)

1. **法力值在原始日志里,但 parser 扔掉了。** advanced 参数行携带
   powerType/currentPower/maxPower(在 maxHp 和 x/y 之间的那段),
   `decodeAdvanced`(`packages/parser/src/l1/decoders.ts:139`)目前只解
   hp/maxHp 然后直接扫到坐标。补 3 个字段 + L3 采样管道 + 重导入即可拿到
   owner 逐事件法力曲线。
   **【裁决 2026-07-16】法力方向搁置:当前版本没人缺蓝,法力管理不构成
   复盘价值。字段解码留作日后 meta 变了再启用(哪个版本 oom 重新成为
   胜负手时,这段就是现成的实施笔记)。**
2. **overheal 在 L1 解了、L3 扔了。** `decodeHeal` 已解析 overheal/absorbed,
   但 GladUnit 的 heal 事件里没带出来。小改一处 plumb-through ——
   这条**仍然要做**,它喂 triage 的"恐慌按大 CD"检测(大额 CD 高 overheal)。

parser 改动须过差分预言机 gate(新字段 additive,diff 规则允许新键)。

## 一、治疗复盘的下一层问题(现在答不了的)

1. **我奶对人了吗?**(triage 质量)
   - 快照对照:你每次大额治疗落点时,场上最低血的队友是谁 —— "队友 30%
     时你在奶 90% 的 DPS";HP 采样 + healOut by target 数据已有;
   - overheal 率按技能拆(依赖事实 0.2):大 CD 打了 80% overheal = 恐慌按键;
   - 与 healingGaps 互补:gaps 说"你没奶",triage 说"你奶了但奶错了"。

2. **我的读条纪律怎么样?**(castStarts 的治疗侧杀手应用,数据已落地)
   - 被断审计:你被 kick 断掉的读条里,多少是在敌方 kick 明显可用时
     硬读的高价值法术(被断学派锁 X 秒的统计已有,归因没有);
   - fake cast:cast start → 主动取消 → 敌方 kick 落空 → 真读条完成
     = 教科书骗断,应该被表扬([VULNERABLE] 同款"没做也要说"逻辑的反面);
   - 与 DPS 版 kickAudit 是同一套事件几何,两边共享谓词。

3. **敌方开大时我反应多快?**(爆发响应延迟)
   - 敌方进攻 CD 开启(enemyCDs 已有)→ 你的第一个减伤/大奶 GCD 的秒数;
   - 被集火 spike → 破 LoS 的秒数(positions + LoS 谓词已有,
     healer exposure 的反向:exposure 说你站错,响应延迟说你修正得慢不慢)。

4. **驱散质量(不只是覆盖率)**
   - 关键 debuff applied → dispelled 的中位延迟(锁毒 8 秒才驱 ≈ 没驱);
   - 驱散优先级错误:致命 magic 挂着时驱了低价值 debuff;
   - 覆盖门已把"驱没驱"钉死(<80% 场次 104→4),下一层是"驱得多快、对不对"。

5. **进 CC 前的预备**(被控是必然,预备是水平)
   - 进入 CC 瞬间队伍身上的 HoT/盾快照:裸队进羊 vs 满 HoT 进羊,
     后续 5 秒承伤结局对照;aura 区间 + CC instances 数据全有。

## 二、优先级与分期

- **H1(parser 小补,一个 PR)**:overheal plumb-through(法力字段搁置,
  见裁决);过 oracle gate;重导入。只喂 triage 的 panic-cd 检测,
  triage 快照对照不依赖它、可先行。
- **H2(确定性分析 + UI,不碰 prompt)**:
  - 战报"治疗账本"卡:triage 快照表 + 驱散延迟 + 读条纪律,行行可点跳回放
    (与 DPS 爆发账本同构,卡片框架共享);
  - 仪表盘 healer trend:被断次数/驱散延迟 跨场曲线。
- **H3(AI 层,走 /eval-ab)**:triage/驱散延迟证据行进 prompt;
  candidateFindings 新类型 `late-dispel`、`wrong-target-heal`、`panic-cd`、
  `good-fake-cast`(确定性谓词产出,审计管线复用)。healer prompt 已成熟,
  每块单独 A/B,别打包。

## 三、待拍板

1. 治疗账本 vs DPS 爆发账本谁先做?(卡片框架共享,先做谁另一个就便宜)
2. overheal plumb 顺路做吗?(小改一处 + 过 gate;不急可并入下次 parser 改动)
