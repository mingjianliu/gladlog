# gladlog 子项目 1:战斗日志 Parser 库 — 设计 spec

日期:2026-07-10
状态:待用户审阅
上位文档:[2026-07-10-clean-rewrite-roadmap-design.md](2026-07-10-clean-rewrite-roadmap-design.md)

## 目标与非目标

**目标**:从零实现 WoW 战斗日志解析库,覆盖 **Retail 竞技场(2v2/3v3)与 Solo Shuffle**;自由设计数据模型;另建薄适配层使既有下游代码(AI 分析、eval 工具链)以最小改动接入;以旧管线为私有差分 oracle,核心事实与关键派生指标对齐。

**非目标**:战场(含 Blitz)、Classic 日志分支、上传/云端、录像联动。旧 parser 的 `malformed_arena_match_detected`/`parser_error`/`activity_started` 等事件下游从未订阅,不进适配面(诊断另行设计,见错误处理)。

**合规边界(硬约束)**:实现者(agy 或 subagent)**不得阅读旧 parser 源码**。允许的输入只有:本 spec、暴雪日志格式的社区公开文档(wowpedia COMBAT_LOG_EVENT)、真实日志样本、下游消费面清单(附录 A)。下游消费面里的接口/字段名与枚举值是"你自己代码已引用的 API 事实",可按附录 A 复刻;实现逻辑必须原创。

## 数据模型(全新)

命名前缀 `Glad*`,与上游命名体系无关。所有 timestamp 为时区解析后的 epoch ms。

```ts
// L1 产物
interface LogRecord {
  timestamp: number;
  eventName: string; // 如 'SPELL_CAST_SUCCESS'
  params: string[]; // 原始参数(引号已剥离,嵌套已按顶层逗号切分)
  raw: string; // 原始整行
}
// 事件族解码(在 L1 内按事件名派发):
//   基础三元组:srcGuid/srcName/srcFlags/destGuid/destName/destFlags
//   spell 族:spellId/spellName/spellSchool
//   damage/heal 族:amount/overkill|overheal/absorbed/critical + advanced 载荷(actorGuid/ownerGuid/hp/maxHp/x/y/…)
//   aura 族:auraType('BUFF'|'DEBUFF'), amount?
//   extra-spell 族(INTERRUPT/DISPEL/STOLEN):extraSpellId/extraSpellName
//   COMBATANT_INFO:结构化 JSON-ish 载荷(talents/pvpTalents/equipment/teamId/specId/rating/auras)
//   ARENA_MATCH_START/END、UNIT_DIED、PARTY_KILL、ZONE_CHANGE

// L3 产物
interface GladUnit {
  id: string; // GUID
  name: string;
  ownerId?: string; // 宠物→主人
  kind: UnitKind; // Player | Pet | Guardian | NPC | Object | Unknown
  reaction: Reaction; // Friendly | Hostile | Neutral(以日志所有者视角)
  classId: number; // 暴雪 class ID;0=未知
  specId: number; // 暴雪 spec ID;0=未知
  info?: GladCombatantInfo; // 仅玩家
  damageOut: GladHpEvent[];
  damageIn: GladHpEvent[];
  healOut: GladHpEvent[];
  healIn: GladHpEvent[];
  absorbsOut: GladAbsorbEvent[];
  absorbsIn: GladAbsorbEvent[];
  casts: GladSpellEvent[];
  petCasts: GladSpellEvent[];
  auraEvents: GladAuraEvent[];
  actionsOut: GladSpellEvent[];
  actionsIn: GladSpellEvent[];
  deaths: GladDeathEvent[];
  advancedSamples: GladAdvancedSample[]; // hp/maxHp/x/y 采样
}
interface GladCombatantInfo {
  teamId: number;
  specId: number;
  personalRating: number;
  talents: unknown[];
  pvpTalents: unknown[];
  equipment: unknown[];
  interestingAuras: { casterGuid: string; spellId: number }[];
}
interface GladMatchBase {
  id: string; // 内容哈希
  bracket: string;
  zoneId: string;
  startTime: number;
  endTime: number;
  units: Record<string, GladUnit>;
  playerId: string; // 日志所有者 GUID
  playerTeamId: number;
  winningTeamId: number | null;
  result: MatchResult; // Win | Lose | Draw | Unknown
  linesTotal: number;
  linesDropped: number;
  rawLines: string[];
  hasAdvancedLogging: boolean;
  timezone: string;
}
interface GladMatch extends GladMatchBase {
  kind: "match";
} // 2v2/3v3
interface GladShuffleRound extends GladMatchBase {
  kind: "shuffleRound";
  sequenceNumber: number;
}
interface GladShuffle {
  kind: "shuffle";
  rounds: GladShuffleRound[];
  startTime: number;
  endTime: number;
  rawLines: string[];
}
```

事件对象(`GladSpellEvent`/`GladHpEvent`/`GladAuraEvent`/…)共同字段:`timestamp`、`eventName`、`spellId`、`spellName`、`srcId`/`srcName`、`destId`/`destName`;HP 事件另有 `amount`(原始)与 `effectiveAmount`(扣除 overkill/overheal 的有效量,语义:effective = amount − overkill|overheal,下限 0);absorb 事件另有 `absorbedAmount`;extra-spell 事件另有 `extraSpellId`/`extraSpellName`;advanced 采样含 `hp`/`maxHp`/`x`/`y`。

## 三层流水线

**L1 行解析器** `parseLine(line, {timezone}): LogRecord | null`——无状态纯函数。职责:时间戳解析(现行格式含年份 `7/2/2026 13:38:30.8888`;按 timezone 参数落 epoch ms)、顶层 CSV 切分(处理双引号内逗号、`[]`/`()` 嵌套)、按事件名解码事件族参数。任何输入不抛异常;无法解析返回 null。未知事件名产出通用 LogRecord(params 原样)。

**L2 对局切分器** `Segmenter`——状态机,输入 LogRecord 流,输出 `Segment { records, rawLines, kind }`。规则:

- `ARENA_MATCH_START` 开启缓冲;再次遇到 START 时丢弃前一段(诊断记录)并重开(对应"double_start"场景)。
- `ARENA_MATCH_END` 闭合段。START 参数区分普通竞技场与 Solo Shuffle(bracket 字段);Shuffle 的 6 个回合在**一对 START/END 内**,回合边界由回合内标志(UNIT_DIED 后重置/交战重开等)判定——具体信号以 fixture(`one_solo_shuffle.txt` 等)实证为准。
- EOF/超时(可配置,默认 30 分钟无新行)未闭合段丢弃并出诊断。
- **边缘场景行为契约(M2 前置探针产出,经 agy 辩论修正)**:对四个已知脏日志场景(`double_start`、`one_match_synthetic_no_end`、`shuffle_reloads`、`shuffle_early_leaver`),M2 的第一步是探针脚本在对应 fixture 与自采日志上实证"日志里究竟发生了什么"(reload 后 START 是否重发、early leaver 后回合如何闭合),据此写下每个场景的**行为契约**(哪些数据可恢复、哪些丢弃、丢弃计入哪个诊断码);L2 的验收 = 行为与契约一致,而非"全部恢复"。任何数据损失必须体现在诊断计数里,不允许静默。"无 START 即合成段"的启发式恢复不进 v1——T1 差分会暴露此类损失的真实规模,规模可观再立项。

**L3 对局构建器** `buildMatch(segment): GladMatch | GladShuffle`——按维度拆分的独立 reducer 模块,各自一个文件,逐条消费 records:
`roster.ts`(单位登记、GUID→kind/reaction 推断、宠物归属)/ `combatantInfo.ts` / `hpEvents.ts` / `auras.ts` / `casts.ts` / `deaths.ts` / `advanced.ts` / `outcome.ts`(胜负:END 参数 + 队伍死亡事实)。`composeMatch.ts` 组装 + 内容哈希。

- reaction 推断:以 COMBATANT_INFO 的 teamId 与日志所有者(首个 advanced actorGuid=srcGuid 的玩家,或 START 后首个 COMBATANT_INFO 顺位;实证确定)相对判定;不依赖 flags 时也要能出结果,flags 作交叉验证。

**公共 API**:

```ts
class GladLogParser {
  constructor(opts?: { timezone?: string; wowVersion?: 'retail' });  // wowVersion 仅作透传占位
  push(line: string): void;
  end(): void;                                 // flush EOF 诊断
  on(event: 'match', cb: (m: GladMatch) => void): this;
  on(event: 'shuffle', cb: (s: GladShuffle) => void): this;
  on(event: 'diagnostic', cb: (d: Diagnostic) => void): this;
  stats(): { linesTotal: number; linesDropped: number; segmentsDropped: number };
}
parseText(text, opts): { matches, shuffles, diagnostics }            // 便利函数
parseFile(path, opts): Promise<same>                                 // node-only 入口,流式读
```

自带极简 emitter(核心零运行时依赖、无 Node API;`parseFile` 在 `@gladlog/parser/node` 子入口)。

## 适配层 `@gladlog/parser-compat`

独立包,唯一知道"旧形状"的地方。自行定义下游所需接口(**附录 A 是唯一契约来源**,不 import 上游),导出:

- 类型:`IArenaMatch`/`IShuffleRound`/`IShuffleMatch`/`AtomicArenaCombat`/`ICombatUnit`(附录 A 最小字段集)+ 事件结构类型 + 全部枚举(`LogEvent` 全量 ~48 成员、`CombatUnitSpec` 精确字符串值如 `Priest_Holy='257'`、`CombatUnitReaction/Type/Class`、`CombatResult`、`SpellTag`、`CombatUnitPowerType`)。枚举字符串值为暴雪 ID/事件名等游戏事实。
- 转换:`toLegacyMatch(m: GladMatch): IArenaMatch`、`toLegacyShuffle(s: GladShuffle): IShuffleMatch`。`winningTeamId` 做成一等类型字段(修掉下游 any-cast 的历史包袱,迁移下游时同步改)。
- 入口仿形:`class WoWCombatLogParser`(构造 `(wowVersion, timezone?)`、`.parseLine()`、事件 `arena_match_ended`/`solo_shuffle_ended`)包装 GladLogParser——覆盖全部 7 个既有调用点,迁移即改包名。
- 小工具:`getUnitType(flag)`/`getUnitReaction(flag)`(位标志解码,flag 位含义为暴雪文档事实)。
- **`classMetadata` 不在本包**:它是上游手工维护的数据编译成果,不能带走。compat 导出 `IClassMetadata` 类型与注入点 `setClassMetadata(data)`,数据本体由子项目 5 自建(过渡期下游功能受限的部分明确报"数据未就绪")。

## 差分测试(验收核心)

**驻地**:旧 fork 的 `scratch/parser-diff/`(私有使用旧 parser 合法;工具与结果不进 gladlog 仓库,报告结论可以进)。

**两级对齐**:

1. **核心事实**:对同一日志,新旧两边输出规范化为同一 JSON 形状(场次与回合数、bracket/zoneId、单位名单与 kind/spec/teamId、胜负、每单位死亡次数与时刻、每单位 damage/heal effectiveAmount 总量、火线事件计数)后 diff。目标:T1 语料 100% 一致;不一致逐个裁决——**旧 parser 不是无条件真理**,分歧按原始日志裁决,新 parser 正确时在差分报告记录"旧管线缺陷"而非改新代码迁就。
2. **派生指标**(经 agy 辩论修正):两边输出各自经 compat(旧边恒等)喂入旧 fork 的 React-free `buildMatchContext`,对比其**字符串拼接之前的结构化 context 对象**(canonical 化:同 timestamp 的并发事件按 (timestamp, eventName, spellId, srcId) 稳定排序后再 diff),避免底层数组迭代顺序差异造成的大面积文本乱序假阳性;prompt 文本 diff 降级为冒烟信号。自动覆盖 CC 链、压力窗口、DR 等全部派生指标。**验收标准:每个差异都被裁决、未裁决差异数为 0**——NEW_CORRECT(新对旧错)按根因(spellId/事件类型)键控白名单并附日志证据,记录"旧管线缺陷";NEW_WRONG 修新代码。不用 LLM 评估语义衰退:确定性检查优先于 LLM 判断(项目 eval 纪律)。

**语料分层**:

- **T0**(每次测试跑):上游 14 个 `.txt` fixture(暴雪输出,可移植;旧 `.test.ts` 断言文件不可移植,但其文件名标注的行为意图——double_start、no_end、early_leaver、reloads、dedup——作为 L2 状态机的测试场景清单)+ 若干手工构造的合成行。
- **T1**(回归):从自采语料(`benchmarks/logs/` 5160 个 + `playstyle-logs-cache/` 1050 个,共 ~104GB)按 bracket×专精×时长分层抽样 ~200 个,manifest 固定。
- **T2**(里程碑一次性):全量扫荡,只验"零崩溃 + 诊断计数合理 + 核心事实自洽",不做逐场 diff。

## 错误处理与性能

- `push()` 永不抛异常;坏行 `linesDropped++` 并出 `diagnostic`(行号、原因码);坏段丢弃出诊断。诊断原因码枚举:`BAD_TIMESTAMP`/`BAD_CSV`/`UNKNOWN_EVENT_SHAPE`/`UNCLOSED_SEGMENT`/`DOUBLE_START`。
- 性能:T1 单文件吞吐 ≥ 50k 行/秒(M 系 Mac 基准,远超实时 tail 需求;旧 parser 为数千行/秒量级,不以其为上限);`parseFile` 流式,内存 O(当前段)。基准脚本入库,数字进 CI 产物。
- TS strict、`noUncheckedIndexedAccess`;核心包 0 运行时依赖。

## 仓库布局与实施方式

```
gladlog/
  package.json           # npm workspaces
  packages/parser/       # @gladlog/parser  (src/l1 src/l2 src/l3 src/api node子入口)
  packages/parser-compat/# @gladlog/parser-compat
```

实施按用户既定工作方式:**具体代码优先派 agy(`agy exec`)编写**(每次派单附带完整任务代码/精确接口,产出必须抽查),agy 无额度时降级为便宜模型 subagent;架构决策、审查、集成由 Claude 负责。TDD:每个 L1 事件族/每个 L3 reducer 先写失败测试(vitest)。

## 里程碑切分(各自独立可验)

M1 L1 行解析器 + T0 合成行测试 + 104GB 信噪比扫荡(经 agy 辩论修正:非空行类型化解码成功率 ≥ 99.9%、未知事件率单独报告、按事件族的覆盖统计——全返 null 的解析器无法通过;"零崩溃"只是前提不是指标)
M2 L2 切分器(含 shuffle 回合边界实证)+ T0 场景测试
M3 L3 reducers + GladMatch 组装 + T0 黄金断言
M4 compat 包 + 差分 harness + T1 两级对齐
M5 性能基准 + T2 扫荡 + 差分报告定稿

## 设计决策辩论记录(agy debate 仪式)

2026-07-10,conversation `f62c2649`,两轮(PARTIAL → OPPOSE),三点全部吸收进 spec:

1. **让步:M1"零崩溃"是虚荣指标**——设计上屏蔽了异常的系统里测崩溃率无意义,全返 null 也能"通过"。已改为信噪比指标(≥99.9% 类型化解码成功率 + 未知事件率 + 事件族覆盖)。
2. **让步:L2 承诺自相矛盾**——不能既承诺通过 reload/early-leaver fixture 又硬编码"无 START 即丢弃"。已改为"探针实证 → 行为契约 → 验收=符合契约",启发式恢复推迟到差分数据证明其必要。
3. **让步:prompt 文本 diff 会被并发事件排序噪音淹没**——已改为对比字符串拼接前的结构化 context 对象 + canonical 排序;文本 diff 降级为冒烟。**辩护成立**的部分:拒绝用 LLM eval 做验收(agy 第一轮建议),确定性回归信号优先——agy 第二轮已接受此点。

---

## 附录 A:适配层最小契约(来自 2026-07-10 下游消费面侦察,90 个消费文件)

| 类别               | 必须提供                                                                                                                                                                                                                                             | 明确剪掉(下游零引用)                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 入口               | `new X(wowVersion, timezone?)`、`.parseLine(line)`、事件 `arena_match_ended`+`solo_shuffle_ended`                                                                                                                                                    | `.flush()`、`.resetParserStates()`、其余全部事件                                                      |
| 对局容器           | `startTime`,`endTime`,`units`,`startInfo.{bracket,zoneId}`,`playerId`,`playerTeamId`,`result`,`dataType`,`winningTeamId`,`rawLines`,`sequenceNumber`(round),`rounds`(shuffle match),`wowVersion`,`hasAdvancedLogging`,`durationInSeconds`,`timezone` | `endInfo`,`killedUnitId`,`scoreboard`,`shuffleMatchEndInfo`,`shuffleMatchResult`                      |
| 单位 `ICombatUnit` | `id`,`name`,`ownerId`,`type`,`class`,`spec`,`reaction`,`info`(窄化),`damageIn`,`damageOut`,`healOut`,`healIn`,`absorbsIn`,`absorbsOut`,`auraEvents`,`spellCastEvents`,`petSpellCastEvents`,`actionIn`,`actionOut`,`deathRecords`,`advancedActions`   | `isWellFormed`,`affiliation`,`supportDamage*`,`supportHeal*`,`absorbsDamaged`,`consciousDeathRecords` |
| 动作               | `spellId`,`spellName`,`timestamp`,`logLine.{event,timestamp}`,`srcUnitId`,`destUnitId`,`srcUnitName`,`destUnitName`,`srcUnitFlags`,`destUnitFlags`,`spellSchoolId`                                                                                   | —                                                                                                     |
| 伤害/治疗          | `effectiveAmount`,`amount`                                                                                                                                                                                                                           | `isCritical`                                                                                          |
| advanced           | `advancedActorCurrentHp`,`advancedActorMaxHp`,`advancedActorPositionX/Y`,`advanced`                                                                                                                                                                  | `advancedActorPowers`,`advancedActorFacing`,`advancedActorItemLevel`,`advancedOwnerId`                |
| 吸收               | `absorbedAmount` + 继承 `effectiveAmount`                                                                                                                                                                                                            | `critical`,`shieldOwnerUnit*`,`shieldSpell*`                                                          |
| extra-spell        | `extraSpellId`,`extraSpellName`                                                                                                                                                                                                                      | —                                                                                                     |
| CombatantInfo      | `teamId`,`talents`,`pvpTalents`,`equipment`,`personalRating`,`specId`,`interestingAurasJSON`                                                                                                                                                         | ~20 个原始属性字段                                                                                    |
| 枚举               | `LogEvent`(全量),`CombatUnitReaction/Type/Class`,`CombatUnitSpec`(精确字符串值),`CombatResult`,`SpellTag`,`CombatUnitPowerType`                                                                                                                      | `CombatUnitAffiliation`                                                                               |
| 数据/工具          | `getUnitType(flag)`,`getUnitReaction(flag)`;`IClassMetadata` 类型 + `setClassMetadata` 注入点(数据本体=子项目 5 自建)                                                                                                                                | 其余全部导出(hash/query/dps 助手等)                                                                   |

完整侦察报告(逐字段引用计数、7 个调用点位置、语料库存明细)存旧 fork `scratch/parser-consumption-inventory.md`。

## 未决事项

- Shuffle 回合边界的确切信号:实现计划里先做探针实证(M2 前置步骤)。
- T1 抽样 manifest 的分层维度权重:实现计划里定。
