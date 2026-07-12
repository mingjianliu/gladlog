# SP-B2:Pro Comparison compare 子系统 — 设计

日期:2026-07-12
状态:设计(待用户复核)
所属:SP-B(Pro Comparison)。消费 SP-B1(群体语料)+ SP-B1.5(build-aware 分组)产出的 `reference_vectors.json`。

## 目标

一句话:桌面端"你的打法 vs 高分群体"——主进程读打包语料,按 build-aware cell 算逐维百分位,用 **template 插值**(模型只写占位符、主进程填真值)生成不可幻觉的诚实叙述,渲染进报告的 `ProComparisonVerified` 面板。

## 范围

**本 spec(SP-B2)**:compare 引擎(cellLookup 回退 + verifiedComparison)、template-插值 prompt + claimChecker 门、主进程 IPC handler、`ProComparisonVerified` UI、fail-open 版本降级。语料为**打包静态资源**。

**范围外**:

- **CDN 版本化分发**(拉取/版本比对/静默刷新/回退)→ SP-B2.1(fail-open 版本检查本 spec 就做,故过期打包语料能优雅降级)。
- **SP-A**:结构化分析 UI(FindingsList 等)。
- 用户端匿名上报(数据飞轮)——远期。

## 背景与关键决策

- **信任边界在主进程**:claimChecker(确定性诚实门)与语料读取在主进程,不可被 renderer 绕过。现有 `ai.analyze(matchId, context)` 在 renderer 建 context;compare 更重且安全敏感,故走**新主进程管线**。
- **claimChecker = template 插值(agy debate 结论,见文末)**:旧 fork 的"事后 token 成员检查"有两处硬伤——(1)语义对调假阴性("你的进攻指数 0.49 排在 30 百分位":数字都在集合里却把用户值与群体中位数对调,成员检查放行);(2)自然语言假阳性("约 0.3""几乎一半":四舍五入/口语数字不在精确集合→整篇误丢)。改为:模型只写具名占位符 `{{key}}`,主进程从 facts 字典确定性插值真值。**数值/判定幻觉按构造不可能**;claimChecker 缩为"所有 `{{key}}` 可解析 + 残余扫描模型仍写的裸统计数字"。
- **用户指标在 renderer 算无漂移**:用户对局与群体**同一** `@gladlog/analysis` 算指标,彼此无漂移(4a 的漂移是旧/新 parser 之间,此处不适用)。claimChecker 守的是 **LLM 叙述**;用户篡改自己客户端伪造自己战绩不在威胁模型内(个人分析工具)。故指标 renderer 侧算、随 IPC 传入。

## 架构与数据流

```
Renderer(已有解析后的 match + @gladlog/analysis)
  → IPC gladlog:compare:run { matchId, healerMetrics, spec, talents[], bracket, archetype, wowBuild }
主进程 createCompareService:
  1. loadCorpus()             打包 reference_vectors.json(内存缓存)
  2. failOpenCheck()          corpus.wowPatchVersion vs wowBuild;keystone 节点在天赋数据中失效 → 该 spec 强制 buildGroup="*"
  3. assignBuildGroup()       corpus.buildGroups[spec] 的 keystone 布尔门作用于 talents(fail-open 后可能 "*")
  4. lookupCell()             4 级回退:archetype×buildGroup → *×buildGroup → archetype×* → *×*;命中 insufficient 或全空 → 无 cohort
  5. verifiedComparison()     逐维:用户值、cohort p10/p50/p90、百分位秩、确定性 verdict 标签 → facts 字典(具名 key)
  6. buildExemplarLedPrompt() facts 字典 + 该 cell 的 exemplar crisisEvents;指令:只用 {{key}} 占位符,禁写裸数字/自评
  7. stream(AnthropicLike)    复用 ai.ts 的注入式 client + 代际取消
  8. interpolate()            流式:占位符 span 完整时即以 facts 字典填真值(缓冲 `{{`…`}}`)
  9. claimChecker()           (a) 每个 {{key}} 必在字典;(b) 残余扫描:占位符外的裸"统计样"数字(数字+%/percentile/维度名邻接)→ 违规
  → 违规或无 API key:丢叙述,回落**确定性数字表**(verifiedComparison 直接渲染);
  → 返回 { verifiedComparison, report?, droppedReason?, cellMeta:{spec,bracket,archetype,buildGroup,sampleN,insufficient,fellBackTo} }
Renderer → ProComparisonVerified 面板渲染(叙述 or 数字表回落),标注命中 cell 的 build/archetype/样本量
```

## 组件与文件

**新建 `packages/analysis/src/compare/`(纯,无 Electron,单测)**——控制器对子项目 0 审计 CLEAN 提取旧 fork 逻辑,换 import:

| 文件                        | 职责                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cellLookup.ts`             | `lookupCell(corpus, {spec,bracket,archetype,buildGroup}, nFloor): { cell, fellBackTo }`。4 级回退,跳过 insufficient。                             |
| `verifiedComparison.ts`     | `verifiedComparison(metrics, cell): { dims: PerDim[], facts: FactsDict }`。逐维百分位秩 + 确定性 verdict;产 facts 字典(所有可叙述真值,具名 key)。 |
| `buildExemplarLedPrompt.ts` | `buildExemplarLedPrompt(vc, cell, specName): string`。facts + exemplar crises;强制占位符、禁裸数字。                                              |
| `claimChecker.ts`           | `interpolate(text, facts): string`(流式安全);`claimChecker(rawText, facts): { ok, violations[] }`。                                               |

**桌面主进程**:

- `packages/desktop/src/main/compare.ts`——`createCompareService(deps)`,镜像 `createAiService`(注入 client、缓存、代际取消)。编排步骤 1–9。
- `main/ipc.ts` + `preload/api.ts`——注册 `gladlog:compare:run` / `:cancel` / `:getCached`;`GladlogApi.compare` 桥。
- 语料打包:`reference_vectors.json` 作主进程可读资源(构建期复制进包)。

**Renderer**:

- `renderer/src/report/components/ProComparisonVerified.tsx`——报告内**新增**"vs 高分群体"区,与现 `AIAnalysisPanel` **并存**(非替换)。渲染逐维条(用户值 vs cohort p10–p90 + 百分位)、诚实叙述或数字表回落、cell 元信息(build/archetype/N,insufficient 时显"样本不足")。

## facts 字典与 verdict(claimChecker 的确定性基座)

`verifiedComparison` 产每维:`{ key, value, p10, p50, p90, percentile, verdict }`。facts 字典是**扁平具名 key → 已格式化字符串**,如:

```jsonc
{
  "offensiveIndex": "0.31",
  "offensiveIndex.cohortMedian": "0.49",
  "offensiveIndex.percentile": "30th percentile",
  "offensiveIndex.verdict": "below your build's cohort",
  // …其余 5 维;verdict 由确定性阈值算(如百分位 <25 "well below" / 25–75 "in line with" / >75 "well above")
}
```

prompt 指令模型只用 `{{offensiveIndex.verdict}}` 之类占位符;主进程 `interpolate` 用字典填。未知 `{{key}}` 或占位符外裸统计数字 → claimChecker 违规 → 丢叙述回落数字表。

## fail-open(SP-B1.5 契约,硬约束)

- `wowBuild` 取**打包的游戏数据 manifest**(`packages/analysis/src/data/datagen-manifest.json` 的 `build`,随 App 更新,与语料同为打包+版本戳资源)——比对两者即检出语料过期,自足、无需查游戏进程。
- `corpus.wowPatchVersion` 主版本 ≠ `wowBuild`,**或** `corpus.buildGroups[spec].keystoneNodeIds` 在当前天赋数据中不存在(被移除/改号)→ 该 spec 静默回落 `buildGroup="*"`(archetype-only 比对)。绝不崩、绝不盲评失效节点 id。
- 过期打包语料 → 降级为 archetype-only 而非给错 build 基线。

## 错误处理与缓存

- **缓存**:key = `(matchId, corpus.wowPatchVersion, PROMPT_VERSION)`;语料或 prompt 变即失效(同 `ai.getCached`)。
- **无 API key**:直接出确定性数字表(无叙述),不报错。
- **cell insufficient / 无匹配**:面板显"该 build×档位×阵容样本不足,暂不出百分位",可选退到更粗父 cell 的数字(标注)。
- **取消**:复用 `ai.ts` 代际计数。

## 测试

- `cellLookup`:构造缺 `archetype×buildGroup` 但有 `*×buildGroup` / `archetype×*` 的语料,断言 4 级回退命中顺序 + `fellBackTo`;insufficient cell 被跳过。
- `verifiedComparison`:golden——给定 metrics + cell,断言百分位秩、verdict 阈值、facts 字典 key 齐全。
- `claimChecker` / `interpolate`(对抗):模型输出含未知 `{{key}}` → 违规;占位符外写裸 "0.3"/"85%" → 违规;纯占位符 + 口语数字("first 2 minutes")→ 通过;`interpolate` 流式半个 `{{` 缓冲正确。
- `compare.ts`:注入 `AnthropicLike` 返 canned 模板文本,断言 interpolate + claimChecker + 缓存 + 取消;违规文本 → 回落数字表。
- fail-open:stale-version 语料 / 失效 keystone → 断言 buildGroup 回落 "*"。

## 合规

- 提取旧 fork 只碰**审计 CLEAN** 文件(verifiedComparison / exemplar prompt / claimChecker 逻辑 CLEAN);UI(`icons.tsx` 等 NEEDS_SCRUB)由控制器提取并 scrub,agy/子代理**不读旧 fork**,只拿干净接口与本 spec。
- 独立性:不用 claude-family alias 复查 Claude 自己的工作(评审走 agy 跨家族)。

## Debate 记录(spec ritual,agy / Gemini 3.1 Pro,conversation 93137a32)

- agy **OPPOSE** 事后 token 成员 claimChecker,举两反例:语义对调假阴性(数字都在集合、含义颠倒仍放行)、自然语言假阳性(四舍五入/口语数字致误丢整篇)。steelman = **template 插值**(占位符 + 确定性填值,幻觉按构造不可能)。
- 采纳 template 插值;verdict 标签也确定性化(防定性方向被颠倒)。renderer 算指标:agy 引 4a 漂移,经辨析不适用(用户与群体同一 parser),自篡改不在威胁模型;保留 renderer 算、IPC 传入。

## SP-B2.1 预告(下一 spec)

CDN 版本化语料:按 `wowPatchVersion` + 门表版本静默刷新,打包语料为回退;主进程拉取+校验+原子替换。运行时零其它外部依赖不变。
