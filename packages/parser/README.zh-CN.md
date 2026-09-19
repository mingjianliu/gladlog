# @gladlog/parser

[English](README.md) · **中文**

gladlog 的零运行时依赖战斗日志解析引擎：将魔兽世界原始竞技场战斗日志（`WoWCombatLog*.txt`）解析为结构化、强类型的比赛文档（`GladMatch` 与 `GladShuffle`）。全包采用纯 TypeScript 编写，可运行于 Node.js utility process、worker 线程以及浏览器环境中。

## 核心特性

1. **零运行时依赖**：`package.json` 未声明任何 `dependencies`。解析器仅依赖 JavaScript/TypeScript 原生语法及用于时区解码的 `Intl.DateTimeFormat`。
2. **基于流的推送机制**：通过 `GladLogParser.prototype.push(rawLine)` 实现行级别流式解析。
3. **严格的解析速度预算**：解析包含 20 万行事件的大型对局耗时必须稳定低于 2000ms（见 `test/parseBudget.test.ts`）。
4. **差分预言机验证**：所有涉及解析器的改动均须通过私有仓中的 164 场真实对局差分预言机验证（`oracle/`, `npm run gate`），确保无意外输出漂移。

## 三层分层架构

```
原始日志文本行
      │
      ▼
[ 第一层：行级分词与解码 (src/l1/) ]
  parseLine() / splitLine() / parseTimestamp() / decodeCombatantInfo()
      │  ParsedLine 流
      ▼
[ 第二层：对局分段与状态机 (src/l2/) ]
  Segmenter (ARENA_MATCH_START, ARENA_MATCH_END, ZONE_CHANGE)
      │  Segment (常规竞技场) / ShuffleClose (单排轮次)
      ▼
[ 第三层：文档组装与人员聚合 (src/l3/) ]
  buildMatch() / buildShuffle() / roster 团队解析 / slimMatchParams()
      │
      ▼
GladMatch / GladShuffle (类型化文档)
```

### 第一层：分词与解码 (`src/l1/`)

- **`splitTopLevel.ts` (`splitLine`, `splitTopLevel`)**：支持括号嵌套与引号的高效 CSV 分词器。自动剥离 CRLF 日志行尾的 `\r`（关键特性：避免将假死标志 `"1\r"` 误判为真死 `"1"`）。
- **`timestamp.ts` (`parseTimestamp`)**：将暴雪日志时间戳（`M/D/YYYY HH:MM:SS.mmm` 或 `M/D HH:MM:SS.mmm`）解析为 Epoch 毫秒时间戳，并在缺失时区偏置时自动推导。
- **`decoders.ts`**：解码标准战斗日志事件（`SWING_DAMAGE`、`SPELL_DAMAGE`、`SPELL_HEAL`、`SPELL_AURA_APPLIED`、`UNIT_DIED`、`ARENA_MATCH_START`、`ARENA_MATCH_END` 等），并解析高级参数块（单位坐标、朝向、装等）。
- **`combatantInfo.ts` (`decodeCombatantInfo`)**：解码复杂的 `COMBATANT_INFO` 载荷，提取天赋树、PvP 天赋、装备、宝石与专精 ID。

### 第二层：对局分段与状态机 (`src/l2/`)

- **`segmenter.ts` (`Segmenter`)**：有状态的流式处理器，从连续日志流中划分竞技场对局边界。
- **生命周期事件**：
  - `segmentOpen`：检测到 `ARENA_MATCH_START`（竞技场大门开启）时触发，驱动桌面端 `RecorderService` 启动 OBS 录制。
  - `segmentClose`：检测到 `ARENA_MATCH_END` 时触发，驱动 OBS 录制停止。
- **容错与异常恢复**：自动恢复未正常闭合的对局、连续开始事件（double start）以及无结束标记的换区事件（`ZONE_CHANGE`）。

### 第三层：模型与文档组装 (`src/l3/`)

- **`compose.ts` (`buildMatch`, `buildShuffle`)**：将分段数据组装为经过完整性校验的 `GladMatch` 与 `GladShuffle` 文档。
- **`roster.ts`**：提取参战人员（`GladUnit`），分配阵营/队伍，解析专精与职业，并将宠物 GUID 关联到其主人。
- **`model.ts`**：规范化的数据结构定义。

## 紧凑优化：Born Slim (`src/slim.ts`)

大型竞技场对局可能包含数十万条事件，容易造成 IPC 通道与 V8 堆内存压力。解析器在组装文档时应用 `slimMatchParams()`：
- 剥离事件载荷中冗余的原始参数字符串。
- 精准保留血量时间轴计算、回放坐标插值及下游分析所需的 `SLIM_PARAMS_KEEP` 核心字段。
- 确保在极低内存占用的同时，完整保留全部分析所需的高保真数据。

## 公共 API (`src/api.ts`)

```ts
import { GladLogParser } from "@gladlog/parser";

const parser = new GladLogParser({ timezone: "Asia/Shanghai" });

parser.on("segmentOpen", (info) => {
  // 竞技场大门打开 —— 触发录制
});

parser.on("segmentClose", (info) => {
  // 竞技场对局结束
});

parser.on("match", (match) => {
  // 获得强类型 GladMatch 文档
});

parser.on("shuffle", (shuffle) => {
  // 获得强类型 GladShuffle 文档
});

// 流式推送日志行
parser.push(rawLine);

// 结束流
parser.end();
```

## 不变量与完整性校验 (`src/invariants.ts`, `src/completeness.ts`)

解析器对生成的文档执行核心结构不变量断言：
- 时间戳必须严格单调递增。
- 每场有效竞技场必须具备合法的玩家列表与非零对局时长。
- 战斗人员专精分配与队伍 ID 必须自洽。

## 测试与校验

```bash
npm test --workspace=packages/parser
```

- **单元测试**：`test/l1.*`、`test/l2.*` 与 `test/l3.*` 覆盖分词边界条件、合成事件流及金标准快照回归。
- **性能预算测试**：`test/parseBudget.test.ts` 确保 20 万行事件的大型日志在 `<2000ms` 预算内完成解析。
- **差分预言机**：在私有仓库中，`npm run gate` 针对 164 场真实对局比对新旧解析器的产出一致性。
