# Parser M2:L2 对局切分器 — 实施计划

> **For agentic workers:** 实现者优先 agy exec(无额度降级 haiku subagent);测试契约=控制者写;禁止阅读旧 wowarenalogs parser 源码。行为契约来自 2026-07-10 探针实证(见 spec L2 节,已更新)。

**Goal:** `Segmenter`:ParsedLine 流 → `Segment`(arena 对局段 / shuffle 回合段序列 + 整场收尾),覆盖四个脏日志场景的行为契约。

## Global Constraints

- 同 M1(仓库、TS strict、零依赖、不读旧源码、commit 规则)。
- 行为契约(探针实证,不得偏离):非 shuffle 双 START=丢前段+`DOUBLE_START` 诊断;shuffle 连续 START=回合边界;END 收整场;winningTeamId=255=无胜者;COMBAT_LOG_VERSION/ZONE_CHANGE 不终止段;EOF 未闭合段丢弃+`UNCLOSED_SEGMENT`。
- 验收 fixture(暴雪日志,可直接用):`one_solo_shuffle.txt`(6 回合)、`double_start.txt`(2v2 重开)、`one_match_synthetic_no_end.txt`(EOF 丢弃)、`shuffle_reloads.txt`(6 回合含 reload)、`shuffle_early_leaver.txt`(2 回合+255)、`two_matches.txt`(连续两场)。路径:`/Users/mingjianliu/code/wowarenalogs/packages/parser/test/testlogs/`(测试通过环境变量 `GLADLOG_FIXTURES` 指向,不复制进仓库——40MB 不入 git;CI 无此变量时跳过这组测试)。

### Task 1: Segment 类型 + Segmenter 状态机

**Files:** Create `packages/parser/src/l2/segmenter.ts`、`src/l2/types.ts`;Test `test/l2.segmenter.synthetic.test.ts`(合成行,不依赖 fixture)

**Interfaces:**

- `interface Segment { kind: 'match' | 'shuffleRound'; bracket: string; zoneId: string; isRated: boolean; startLine: ParsedLine; records: ParsedLine[]; rawLines: string[]; sequenceNumber?: number }`
- `interface ShuffleClose { rounds: Segment[]; end: ParsedLine }`
- `class Segmenter { push(line: ParsedLine, raw: string): void; end(): void; onMatch(cb: (seg: Segment, end: ParsedLine) => void): void; onShuffle(cb: (s: ShuffleClose) => void): void; onDiagnostic(cb: (d: { code: string; lineRef?: string }) => void): void }`
- 状态机:IDLE →(START, 非 shuffle)→ IN_MATCH →(END)→ emit match / (再 START)→ 诊断+重开;IDLE →(START, shuffle)→ IN_SHUFFLE 收集回合,(START)→ 封上一回合开新回合,(END)→ 封末回合 emit shuffle;任何状态遇 COMBAT_LOG_VERSION/ZONE_CHANGE → 仅记录不切换;end() → 未闭合段 `UNCLOSED_SEGMENT` 诊断。

**测试契约(合成行,控制者已定,实现者不得改)**:用最小合成日志行构造序列断言:①非 shuffle 正常一场 → 1 个 match,records 含中间行;②double START → 1 诊断 + 后一场完整;③shuffle 3 个 START + END → ShuffleClose.rounds.length=3,sequenceNumber=0,1,2,END 归整场;④COMBAT_LOG_VERSION 混入不打断;⑤EOF 未闭合 → 诊断,无 emit;⑥END 无匹配 START → 诊断 `ORPHAN_END`,不崩。

### Task 2: fixture 场景验收测试

**Files:** Test `test/l2.fixtures.test.ts`(读 `GLADLOG_FIXTURES` 下六个文件,逐行 parseLine→Segmenter)

**断言(探针实证值)**:one_solo_shuffle → 1 个 shuffle、6 回合、每回合首 6 条 records 为 COMBATANT_INFO、END winningTeamId=0;double_start → 1 match + 1 DOUBLE_START 诊断;no_end → 0 emit + 1 UNCLOSED_SEGMENT;shuffle_reloads → 1 shuffle、6 回合(reload 不切段);early_leaver → 1 shuffle、2 回合、end.arenaEnd.winningTeamId=255;two_matches → 2 个 match。

### Task 3: GladLogParser 外壳接线(spec 公共 API 的 L1+L2 部分)

**Files:** Create `packages/parser/src/api.ts`;Modify `src/index.ts`;Test `test/api.test.ts`

- `class GladLogParser`:push(rawLine) → parseLine → segmenter;事件 `matchSegment`/`shuffleSegments`/`diagnostic`(L3 完成前先发段级事件,M3 把它们升级为 GladMatch);`stats()` 计数(linesTotal/linesDropped/segmentsDropped)。合成行 + 1 个 fixture 冒烟断言。

## 完成定义

- 三任务全绿 + typecheck;fixture 六场景断言全过;commit 逐任务。
