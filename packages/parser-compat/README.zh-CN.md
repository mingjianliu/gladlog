# @gladlog/parser-compat

[English](README.md) · **中文**

新 parser 与分析代码之间的接缝。`@gladlog/parser` 产出 `GladMatch` / `GladShuffle`;而 `@gladlog/analysis` 里几乎所有代码(以及 `@gladlog/desktop`、`@gladlog/eval` 中调用它的部分)都是按旧的 `ICombatUnit` / `IArenaMatch` 形状写的。这个包负责把前者转成后者,并拥有这些消费方 import 的旧枚举。它唯一的依赖是 `@gladlog/parser`。

## 导出了什么(`src/index.ts`)

| 模块                | 导出                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convert.ts`        | `toLegacyMatch(m: GladMatch): IArenaMatch` 与 `toLegacyShuffle(s: GladShuffle): IShuffleMatch` —— 转换本身,包括单位旗标、法术学派、光环与驱散的额外字段、HP 采样与 advanced action。                                                             |
| `types.ts`          | 旧的文档类型:`ICombatUnit`、`IArenaMatch`、`IShuffleMatch`、`IShuffleRound`、`ILogLine`、`ICombatEvent` 及各事件子类型,外加 `AtomicArenaCombat`(一场竞技场对局或一个 shuffle 回合 —— analysis 的工作单位)。                                     |
| `enums.ts`          | `LogEvent`(事件 token 的字面值)、`CombatUnitPowerType`、`CombatUnitReaction`、`CombatUnitType`、`CombatResult`,以及解码 `COMBATLOG_OBJECT_*` 旗标掩码的 `getUnitType` / `getUnitReaction`。                                                        |
| `enumsGenerated.ts` | `CombatUnitClass` 与 `CombatUnitSpec`,由 `packages/analysis/scripts/datagen/genCombatUnitEnums.ts` 从 Blizzard DB2 生成 —— 不要手改。                                                                                                            |
| `shim.ts`           | `WoWCombatLogParser`,一个保留旧调用形状(`on("arena_match_ended", …)` / `on("solo_shuffle_ended", …)`)的类,包着 `GladLogParser` 并在输出时转换。唯一的消费方是 `packages/analysis/src/utils/utils.ts` 里的 `Utils.parseFromStringArray`(从行数组解析日志,供测试与脚本用);应用本身不经过它。 |

来源在这里很要紧:`enums.ts` 曾经是从 wowarenalogs 抄来的(CC BY-NC-ND,与本仓的 MIT 许可不兼容)。现在每个枚举都锚定到一条各自的 Blizzard 公开事实,`data/legacy-enum-manifest.json` 记录了改了什么 —— 见 `docs/DATA-COMPLIANCE.zh-CN.md`。

## 其它包怎么用它

- **analysis** 到处 import 这些类型与枚举(`ICombatUnit`、`LogEvent`、`CombatUnitReaction` ……),并要求传入已经转换好的文档。
- **desktop** 在 renderer 里通过 `toLegacySafe`(`src/renderer/src/report/derive/legacySource.ts`)转换,它按文档缓存 `toLegacyMatch` 的结果,是唯一被允许的调用点 —— 见 `docs/architecture.zh-CN.md` §5。
- **eval** 与 **corpus-tools** 在回放归档日志时直接调 `toLegacyMatch` / `toLegacyShuffle`(`packages/eval/src/corpus/buildCorpus.ts`、`packages/corpus-tools/src/perMatchRecord.ts`,以及 `packages/eval/scripts/` 下的大多数脚本)。

## 测试

```bash
npm test --workspace=packages/parser-compat
```

Vitest,在 `test/` 下:`convert.test.ts`(逐字段转换)、`enums.test.ts`(枚举值对照 manifest,以及旗标解码器)、`shim.test.ts`(旧事件名以旧类型触发)。
