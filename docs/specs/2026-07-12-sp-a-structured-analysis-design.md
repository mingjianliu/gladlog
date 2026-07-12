# SP-A:结构化分析 UI — 设计

日期:2026-07-12
状态:设计(待用户复核)
所属:旧 fork 第二个 AI 子系统迁进 gladlog 桌面。与 SP-B(Pro Comparison,已完成)并列;是"把整体 repo 功能搬过来"目标的最后一大件。

## 目标

一句话:把现在最小的 `<pre>` 流式 AI 分析,换成**证据锚定的结构化 findings**——LLM 从对局里"确实发生过"的可验证事件中挑选、排序、解释成卡片,数字确定性接地,教练措辞刻意非因果,渲染进 FindingsList/MatchHero/TimelineStrip/ExportButtons。

## 关键决策(agy debate 定夺,见文末)

- **事实可"按构造诚实",因果不能。** SP-B2 的数值 claimChecker 只抓数字幻觉;教练的真正幻觉面是**定性/因果**判断("你贪了盾""站位错了""因为 X 你死了")——一句没有数字的话会盲目通过。故:
  - **事实层**(事件是否发生、数字)——确定性接地:finding 必须锚定真实抽取事件;数字走 SP-B2 的 `{{占位符}}` 插值。"0:47 你被 Chaos Bolt 秒"在无此施法时不可能出现。
  - **因果层不可确定性校验**(孤立事实的校验无法验证事实之间的逻辑关系;"因为 1:00 浪了盾所以 2:00 死"——若那盾是强制必交,"浪了"就是幻觉)。**故本设计不做强因果断言**(avoid-by-design):prompt 令 LLM 出观察 + 建议式教练,不出"因为/导致/葬送了这局"。一个**因果措辞 lint**(确定性)兜底:解释里出现强因果连接词即判违规——不验因果真值,只强制执行"不下因果断言"策略。
- **不用扁平证据菜单闷死宏观推理**:保留 `buildMatchContext` 已有的**整体 critical-moments 序列**(跨事件:资源在击杀窗口前 15s 就交了)作为富上下文,LLM 能推理对局弧线;同时给结构化事件锚(带 id)供 finding 引用。不是一堆孤立事件的平铺。
- **LLM-as-judge 语义校验**(审因果逻辑)——agy 认为审因果的唯一机制,但非确定、跨家族也只是去相关不消除,且有成本/延迟。**列为 SP-A.1 远期增强**,v1 用 avoid-by-design + 因果 lint。

## 范围

**本 spec(SP-A)**:extractCandidateFindings(结构化可验证事件)+ buildFindingsPrompt(证据菜单 + 富上下文,非因果指令)+ auditFindings(接地 + 数值 claimChecker 复用 + 因果 lint)+ 主进程 analysis-v2 service + FindingsList / MatchHero / TimelineStrip / ExportButtons。替换 `<pre>` AIAnalysisPanel 输出。

**范围外**:SP-B compare(已完成)、SP-A.1(LLM-judge 因果语义审计)、SP-B2.1 CDN。

## 架构与数据流

```
Renderer(已有解析后 match + derive/{summary,timeline,casts,roster})
  → extractCandidateFindings(match) [packages/analysis]:复用 buildMatchContext 里
     已验证的事件抽取(death/missed-interrupt/cd-waste/dispel/positioning…),
     产结构化 CandidateEvent[]:{ id, type, t, units, spell, facts:{…} }
  → IPC gladlog:analysis:run { matchId, candidates, richContext, wowBuild? }
主进程 createAnalysisService(镜像 compare.ts:注入 client、代际取消、版本缓存、原子写):
  → buildFindingsPrompt(candidates, richContext):给事件菜单(带 id)+ buildMatchContext
     富上下文(critical-moments 序列);指令:只选/排序/解释菜单事件,引用 event id;
     数字用 {{event.fact}} 占位符;**禁强因果断言**(观察+建议,不写"因为…这局输了")。
  → stream JSON findings: [{ eventIds[], severity, category, title, explanation }]
  → auditFindings():
     (a) 每个 eventId 必解析到真实 CandidateEvent(接地,LLM 不能引未抽取事件);
     (b) SP-B2 claimChecker:explanation 的 {{key}} 必来自引用事件的 facts,占位符外
         无裸统计数字(数值诚实);
     (c) 因果 lint:explanation 含强因果连接词(because/caused/cost you/lost because…)
         → 该 finding 违规(丢弃或去因果化)。强制 avoid-by-design 策略。
  → interpolate + 按 severity 排序,返回 audited findings + candidate 全集(供 timeline)
Renderer:FindingsList(卡片)· MatchHero(概览)· TimelineStrip(finding 时刻)· ExportButtons
```

**载荷主张**:LLM 从不发明事件或数字(只从预抽取菜单选/排/释);数字确定性接地;**因果断言按策略禁止并由 lint 兜底**——不假装验证了因果,而是不进入因果幻觉这一类。

## 组件与文件

**`packages/analysis/src/analysis/`(纯,单测)**——控制器对审计 CLEAN 提取,换 import:

| 文件                     | 职责                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidateFindings.ts`   | `extractCandidateFindings(match): CandidateEvent[]`。重构 buildMatchContext 的事件抽取为结构化事件(id/type/t/units/spell/facts)。             |
| `buildFindingsPrompt.ts` | `buildFindingsPrompt(candidates, richContext, specName): string`。证据菜单 + 富上下文 + 占位符/非因果硬规则。                                 |
| `auditFindings.ts`       | `auditFindings(rawFindings, candidates): { findings: Finding[], dropped: DroppedFinding[] }`。接地 + claimChecker + 因果 lint + interpolate。 |
| `causalLint.ts`          | `causalLint(text): string[]`。强因果连接词/断言检出(确定性,执行 avoid-by-design)。                                                            |

复用 `packages/analysis/src/compare/claimChecker.ts` 的 `interpolate`/`claimChecker`(数值层),不重写。

**桌面主进程**:`packages/desktop/src/main/analysis.ts`——`createAnalysisService(deps)` 镜像 `createCompareService`;编排 prompt→stream→auditFindings;信任边界(audit)在主进程。IPC/preload 加 `gladlog:analysis:*`。

**Renderer**(暗色数据密集,复用 `derive/` + `SpellIcon`,与 `ReportHeader`/`Timeline` 互补不重复逻辑):

- `MatchHero.tsx`——概览(derive/summary:spec/comp/结果/时长)+ findings headline(数量/最高严重度)。
- `TimelineStrip.tsx`——finding 引用时刻的紧凑 scrubber;点标记高亮对应卡片(反之亦然)。复用 derive/timeline。
- `FindingsList.tsx`——severity 排序卡片:severity 色条、category、interpolated explanation、证据 chip(SpellIcon + 时间戳,交叉链到 strip)。
- `ExportButtons.tsx`——findings+概览导出 Markdown / 面板导出图片。
- `MatchReport.tsx`——用上述替换现 `AIAnalysisPanel` 的 `<pre>` 输出(compare 面板 `ProComparisonVerified` 保留并存)。

## 诚实模型(三层门)

1. **接地**:finding 的每个 eventId 必解析到真实 CandidateEvent;否则丢弃。(事实存在性,按构造。)
2. **数值**:explanation 数字走 `{{event.fact}}` 插值 + claimChecker 残余扫描裸统计数字。(数值诚实,复用 SP-B2。)
3. **因果 lint**:explanation 不得含强因果断言(确定性关键词/模式);违规丢弃或去因果化。(不验因果真值——因果不可确定验证;而是执行"不下因果断言"。)

违规/无 API key → 渲染确定性 CandidateEvent(无叙述)。

## UI 布局

```
┌ MatchHero ─────────────────────────────────────────────────┐
│ Disc Priest · 3v3 · Win +18 · 4:32   ⟶  "6 findings · 2 high" │
├ TimelineStrip ─────────────────────────────────────────────┤
│  ●───▲──────●────▲───●──   (finding 时刻,点 → 卡片)         │
├ FindingsList ──────────────────────────────────────────────┤
│ ▎HIGH  cc-usage   "首个控制交了饰品…"        [icons][0:47]   │
│ ▎MED   cd-waste   "Pain Suppression 留到…"   [icon][2:10]    │
│  … severity 排序;证据 chip 链到 strip                        │
└ ExportButtons:  Copy Markdown · Export Image ──────────────┘
```

## 错误处理与缓存

- 缓存 key = `(matchId, PROMPT_VERSION)`;prompt 变即失效(同 compare)。
- 无 API key / 无 candidate:渲染确定性事件表,无叙述,不报错。
- 取消:复用代际计数。
- JSON 解析失败(LLM 输出非法 JSON):丢该次,回落确定性事件表 + 记 droppedReason。

## 测试

- `extractCandidateFindings`:golden——给定解析 fixture 断言事件类型/id/facts;与 buildMatchContext 文本抽取一致性抽查(不漏关键事件)。
- `causalLint`:对抗——"because you wasted X you lost" 命中;"at 1:00 you used X; kill came at 2:00" 不命中。
- `auditFindings`:引用不存在 eventId → 丢;explanation 裸统计数字 → 丢;强因果 → 丢;干净 finding → interpolate 通过。
- `analysis.ts`:注入 AnthropicLike 返 canned JSON,断言 audit + 排序 + 缓存 + 取消;非法 JSON → 回落。
- UI:FindingsList 渲染 + 严重度排序 + chip 交叉链;无 finding → 空态;jsdom + native matcher(仓库无 jest-dom)。

## 合规

- 提取旧 fork 只碰**审计 CLEAN** 文件;NEEDS_SCRUB UI(`icons.tsx` 等)控制器 scrub;agy/子代理不读旧 fork,只拿干净接口 + 本 spec。
- 独立性:agy 跨家族 review;不用 claude-family alias 审 Claude 自己的工作。

## Debate 记录(spec ritual,agy / Gemini 3.1 Pro,conversation 2357b056)

- **第一轮**:agy OPPOSE。(3)SP-B2 数值 claimChecker 结构性看不见定性/因果幻觉(无数字的谎言盲过)——教练的真正风险面;(1)扁平证据菜单杀死 buildMatchContext 已有的跨事件宏观合成。
- **第二轮**:我提"分离事实substrate与教练opinion + 对嵌入可查事实的定性claim跑确定性反证 + 纯opinion打标签"。agy OPPOSE:**抽取悖论**(要确定性查散文里的嵌入事实,要么用 LLM 解析=又是非确定 judge,要么逼 LLM 出刚性枚举=又闷死宏观);**因果幻觉**(孤立事实校验无法验证事实间逻辑关系;"因为 A 所以 B"两事实都真但因果可为假;贴"interpretation"标签不保护用户,用户正是为 interpretation 而来)。
- **终局(resolved)**:确定性接地必要但不充分;审因果需语义校验(LLM-judge)。用户选 **avoid-causality-by-design**:v1 不下强因果断言,数值/事实确定性接地,因果 lint 兜底策略;LLM-judge 因果审计列 SP-A.1。

## SP-A.1 预告(远期)

跨家族 LLM-as-judge 因果语义审计:对做因果断言的 finding,用另一家族模型审其因果逻辑对不对得上对局数据,丢/软化不成立的——审因果的唯一(概率性)机制,跨家族去相关。
