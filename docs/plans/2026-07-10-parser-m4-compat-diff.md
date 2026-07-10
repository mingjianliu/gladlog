# Parser M4:compat 适配层 + 差分测试 — 实施计划

> 工作方式同前:契约=控制者写;实现=agy exec;禁读旧 parser 源码。**枚举值来源 = `packages/parser-compat/data/legacy-enum-manifest.json`**(在旧仓库私下运行旧包 dump 的运行时值,属互操作事实;dump 脚本在旧 fork `scratch/parser-diff/dumpEnums.ts`)。关键事实:CombatUnitClass/Reaction/Type/Result 为数字枚举且顺序与暴雪官方不同(1=Warrior,2=Hunter…),必须逐值对齐 manifest,不得凭常识写。

## 任务

1. **compat 包骨架 + 枚举**:`packages/parser-compat`(package.json/tsconfig 同 parser 模式,依赖 `@gladlog/parser`)。`src/enums.ts` 按 manifest 静态写出全部 7 个枚举(TS enum:LogEvent/CombatUnitSpec 为字符串枚举,其余数字枚举)。测试:加载 manifest JSON 逐成员断言一致(防漂移),LogEvent=51、Spec=41 成员数断言。
2. **legacy 接口 + toLegacyMatch/toLegacyShuffle**:`src/types.ts` 按 spec 附录 A 最小字段集定义 IArenaMatch/IShuffleRound/IShuffleMatch/AtomicArenaCombat/ICombatUnit/CombatantInfo/动作类型;`src/convert.ts`:GladMatch→IArenaMatch(单位 kind/reaction/class 映射到 manifest 数字值;spec 数字→spec-id 字符串;GladHpEvent→{effectiveAmount,amount,timestamp,spellId,spellName,logLine:{event,timestamp},srcUnitId,destUnitId,…};units 键=unitId;dataType='ArenaMatch'/'ShuffleRound';durationInSeconds 派生)。测试:合成 GladMatch(复用 l3.compose 测试的 collect 辅助思路)转换后逐字段断言。
3. **WoWCombatLogParser 仿形入口**:`src/shim.ts`——class WoWCombatLogParser(wowVersion, timezone?),parseLine(line),事件 'arena_match_ended'(IArenaMatch)/'solo_shuffle_ended'(IShuffleMatch);内部包 GladLogParser+convert。测试:合成 3v3 行序列 → 事件载荷字段断言。
4. **差分 harness(驻旧 fork `scratch/parser-diff/`,不进 gladlog)**:`runOld.ts`(旧包 parse → 规范化核心事实 JSON)、`runNew.ts`(tsx 引 gladlog compat → 同形状 JSON)、`diffCore.mjs`(比对:场次/回合、bracket/zone、单位名单+spec+teamId+reaction、胜负、真死亡数与时刻、每单位 damage/heal effectiveAmount 总量)。规范化排序:单位按 id,事件聚合为总量,时间戳为 epoch ms。先跑 T0 fixtures + 20 个真实日志,分歧逐个裁决(按原始日志),记 `scratch/parser-diff/adjudications.md`。
5. **buildMatchContext 结构化对比**(差分二级):旧 fork 里写 `runContextDiff.ts`——同一日志,旧 parser 输出直接喂 buildMatchContext;新输出经 compat 喂同一函数;对比返回的结构化 context(字符串拼接前),并发事件按 (timestamp,eventName,spellId,srcId) 稳定排序。T1 抽样 50 个先行。
6. **T1 200 文件全量差分 + 报告**:分层抽样 manifest 固定;未裁决差异=0 为过线;报告进 gladlog `docs/reports/`。

## 完成定义

- compat 三任务测试全绿;差分 T0+T1 全部差异有裁决结论;报告落库。
