# HANDOFF 2026-09-05:Skill Capped 教练判决语料的接力点

> 独立主线,不依赖其它 HANDOFF。本文档自含:所有路径、数字、裁定都能直接落地,新 session 不需要旧对话。
> 语料、脚本、证据帧全部在 `~/code/gladlog/tmp/skillcapped-vod/`(**gitignore 内**,约 5MB;转写与教练原话只存在这里,永不进仓库)。
> **产品代码(`packages/`)一行没动。** 仓库内新增了工具与入口:`tools/coach-corpus/`(Python,npm workspace 之外)与 `docs/commands/ingest-coach-corpus.md`(runbook);仓库外补了 `~/.claude/skills/wow-frame-read/SKILL.md` 三处(见 §七)。
> 两份可视化报告(用户私有 artifact):**教练判决语料**(VoD 线第二版结论)https://claude.ai/code/artifact/12c050e4-db37-4e89-8628-9af97a07ec25 · **教练规则全录**(4015 条逐条可筛)https://claude.ai/code/artifact/3abc7a80-8b94-4f5b-9713-51d3a5269212;本地副本在 `tmp/skillcapped-vod/evidence/`。
> Monolingual Chinese, not yet in bilingual pairs; request an English version at any time.
>
> ⚠ **2026-09-06 跨 AI 复核(gpt-6-astra 对抗审稿 + 本机独立复算)已改写本文档的若干结论。**
> 六处事实错误已就地更正(每处带「2026-09-06 更正」块):§一 教练人数、§3.1 头条口径、§3.3 的 ①③⑥、§五 第 2 项条数。**发现 ⑥ 已从「最高价值新方向」降级为「过不了可行性门」。**
> 新增 §3.3·⑧(38 条标注负样本)与 §四·认知问题 5(越权外推),是本次复核的新产出。
> 复核的一条总账:**本文档原有的因果链「教练讲了 X → gladlog 没有 X → 该做 X」,中间那一步在 ①③⑥ 上全错**,因为映射器只能在候选类型里选,看不到上下文层。引用本文档任何「gladlog 没有 ⋯」之前,先 grep 一遍 `packages/analysis/src`。

## 〇、这条线在做什么

用户的原始问题(2026-09-04,原话):

> 我想让你帮我读 skillcap 的视频,youtube 和他自己网站的(我有账户)

三次追问后收敛成的真实目标(用户原话):

> 我不是光想给自己提高,是想让你提取知识,用来给我的 gladlog 提取指导
> 教程的话基本是写好的本子,画面只是辅助加一些趣味性,vod 的视频才是应该仔细分析的,**即使我们没有 log**
> 我之后开一个 gladlog 让他去读

所以这条线的产物是**一份给 gladlog 开发 agent 读的证据文档**,不是给 coach 运行时用的知识集。这份 HANDOFF 就是那份文档的接力版:结论 + 从原始流到结论的每一环怎么复现。

**它回答的问题**:职业教练在复盘一场竞技场时会指出什么,其中多少是 gladlog 现有谓词能描述的同一事件,多少是 gladlog 结构上没有概念的。

**它不回答的问题**(§四·认知问题 1):教练指出的东西对不对、有没有胜负判别力。这些对局没有战斗日志,无法对拼。

## 一、数据在哪(全部已在本机)

| 东西                               | 路径                                                                                                            | 规模                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 站点全目录(公开 JSON)              | `tmp/skillcapped-vod/course_dump.json`                                                                          | 258 课 / 1561 教学视频 / 2963 VoD 点评    |
| 12.x VoD 转写(带时间戳段)          | `tmp/skillcapped-vod/transcripts/<uuid>.json`                                                                   | 68 条,1.4MB,**含教练原话,不进仓库**       |
| 判决 v1(slug 映射)                 | `tmp/skillcapped-vod/verdicts/<uuid>.json`                                                                      | 2101 条判决                               |
| **判决 v2(真实谓词映射,以此为准)** | `tmp/skillcapped-vod/verdicts_remap/<uuid>.json`                                                                | 同 2101 条,每条同时保留 `gladlog_type_v1` |
| 盲态两段式偏差探针(8 条)           | `tmp/skillcapped-vod/verdicts_blind/`                                                                           | 见 §四·bug 2                              |
| 35 簇分类法 + 2058 标签分配        | `tmp/skillcapped-vod/taxonomy.json`                                                                             | —                                         |
| 页面用汇总(v2,含 12.0/12.1 分列)   | `tmp/skillcapped-vod/summary_v2.json`                                                                           | —                                         |
| 证据帧与裁切(DH 追踪示例)          | `tmp/skillcapped-vod/evidence/`                                                                                 | 见 §三·追踪示例                           |
| 教程范围配置 | `tools/coach-corpus/courses_tier1.json`(副本亦在 tmp) | 16 门 Must Watch/通用课 + ROAD TO GLADIATOR 非 POV 集 |
| 教程转写 | `tmp/skillcapped-vod/transcripts_courses/<uuid>.json` | 155 条目 / **154 唯一视频**(`5jjhzdfxn4` 被两门课共用)/ 10.1 h,**含原话,不进仓库** |
| 教程规则 v1(Opus-high;4 个类型仍是薄 gloss、三分边界松) | `tmp/skillcapped-vod/rules_opus/` | 1914 条规则 |
| **教程规则 v2(只重跑映射:真谓词 + 派生边界,以此为准)** | `tmp/skillcapped-vod/rules_opus_v2/` | 同 1914 条,`*_v1` 字段保留 |
| 中文旁车(**仅供「教练规则全录」页面渲染;AI 读数据时忽略,数据本体全为英文**) | `tmp/skillcapped-vod/translations_zh/<uuid>.json` | 与 v2 文件一一对应,只含译文 |
| 教程验证课(默认模型、旧三分定义,仅历史参照) | `tmp/skillcapped-vod/rules/` | 9 课 95 条 |
| **类型真实谓词(由源码生成,映射器唯一输入)** | `tools/coach-corpus/type_definitions.json` | 31 条 = 26 来自 `buildFindingsPrompt.ts` + 5 手写(出处见生成器 `HAND`) |
| 已发布的可视化报告(第二版)         | https://claude.ai/code/artifact/12c050e4-db37-4e89-8628-9af97a07ec25 (本地副本 `evidence/coach-corpus-v2.html`) | —                                         |

**取流机制**(2026-09-04 实测,从干净 shell 用 curl 验证,不带 cookie):

```
401  https://www.skill-capped.com/api/video/<uuid>.m3u8            ← 只有 master 要 Firebase JWT
200  https://www.skill-capped.com/api/video/<uuid>/<bitrate>.m3u8  ← 子 playlist 不设防
200  https://d13z5uuzt1wkbz.cloudfront.net/<uuid>/HIDDEN<bitrate>-NNNNN.ts
bitrate ∈ {500(480p), 1500(720p), 2500(1080p), 4500(1080p)}
```

**永远不要去搬那个 JWT**——里面带用户邮箱身份,而且根本不需要(尝试搬运时被安全分类器、Chrome PNA、剪贴板焦点三重拦下,全是白费)。目录 URL 带时间戳(`courses_v2/wow/course_dump_<ts>.json`),要更新就从站点 network 里捞当前的。用户账号 `bumbing`,已在 Chrome 登录。

**语料构成**:单排 52 / 3v3 16;12.0 有 63 条(2009 判决)、12.1 只有 **5 条**(92 判决)——12.1 那侧只能当轶事;23 个专精;**教练 4 人,且 Keator 一人占 59/68 视频、1776/2101 判决(84.5%)——有效教练数(逆赫芬达尔)= 1.38**。(2026-09-06 更正:原文写「教练 8 人」是错的,8 是全站 2963 条点评的量级,12.x 子集只有 4 人。全站 20+ 教练里 Gelubaba 454 条 > Keator 356 条,12.x 反过来完全是「谁最近发片」——**这不是行业共识样本,是一个教练的教学词汇**。3v3 的 16 条里 15 条来自 Keator,教练与 bracket 几乎绑死。)

## 二、用户裁定索引(新 session 以此为准,勿重新讨论)

| 日期  | 裁定                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------- |
| 09-04 | **只看 12.x**。2963 条点评里 10.x/11.x 有 2895 条,对当前 meta 有害,不用                            |
| 09-04 | **12.0 和 12.1 分开报**。12.1 n=5 明确标轶事                                                       |
| 09-04 | VoD 点评优先于教程课程做细分析;课程「基本是写好的本子」,画面只是配图                               |
| 09-04 | 产出给**开发 agent** 读,不是给 coach 运行时当背景                                                  |
| 09-04 | 方案 A(规则目录)+ B(12.1 meta 知识)一起做;B 严格按 Value-Gate 反着写                               |
| 09-05 | `overall-verdict` 簇移出候选分析,归**跨对局汇总层的输出参照**(不是剔除)                            |
| 09-05 | `talent-build` / `comp-gameplan` 簇归**外部知识层**,后者中可测的部分(「有没有续控制链」)回收       |
| 09-05 | 先修映射(喂真实定义)再做任何下游                                                                   |
| 09-05 | skill 化只做 `wow-frame-read` 补丁;通用方法论**不做成 skill**(三个基线 agent 自行推导出了全部方法) |
| 09-05 | 教程线范围:Tier 1(16 门)+ ROAD TO GLADIATOR 规则集数,共 154 视频 / 10.1 h;各专精手法课 43.9 h 属 B 层,不进第一刀 |
| 09-05 | 教程线全量抽取用 **claude-opus-5 --effort high**(用户依另一 session 的 A/B 判 Opus-high 精度更高;本线为纯文本任务,该结论的迁移性见 §四认知 4) |
| 09-05 | **不记 `claude -p` 收据**(cost/turns/cache)—— 用户裁定不需要 |
| 09-05 | 固化为**仓库内工具 + `docs/commands` runbook**,不写 skill;代码放 `tools/coach-corpus/`(gladlog 侧,因 `type_definitions.json` 由 gladlog 源码生成) |

**版权约定**(沿用 2026-07-27 arenacoach batch1 的既有规矩):只入库结构化判决与转述,**一句教练原话都不进仓库**。转写留在 gitignore 的 tmp 里。

## 三、已收官:结论与证据链

### 3.1 头条数字(v2,以此为准)

|                                                  | 12.0 (n=2009) | 12.1 (n=92,轶事) | 全 12.x          |
| ------------------------------------------------ | ------------- | ---------------- | ---------------- |
| 无任何 gladlog 谓词描述同一事件(全极性)          | 71%           | 62%              | 71% (1483/2101)  |
| **同口径:仅失误极性**(见下)                     | —             | —                | **55.9% (531/950)** |
| 严格匹配(映射器判「谓词会在恰好这个事件上发射」) | —             | —                | 4.2% (88 条)     |
| **同上,仅计真的在发射的谓词**                     | —             | —                | **2.3% (49 条)** |
| 第一版 slug 映射得出的数(已作废)                 | 46%           | 45%              | 46%              |

判决极性:失误 45% / 更优解 32% / 做对了 23%。54% 带教练明确的后果归因。64% 需要读画面才能确认前提。

> **2026-09-06 更正(跨 AI 复核,gpt-6-astra + 本机独立复算):71% 这个头条被两层口径错误抬高,引用前必须连同下面两条一起引。**
>
> **(a) 人口口径不匹配。** 映射器只拿到 26 条**候选菜单**谓词,而候选菜单按构造只发失误;语料却有 23% 是表扬、32% 是「更优解」。分极性看 unmapped:失误 950 条 **55.9%**、更优解 676 条 76.2%、表扬 475 条 **92.0%**。1483 条「缺口」里 **64% 是表扬和更优解**。**与候选菜单同口径的头条是 55.9%**,不是 70.6%。
> ⚠ 但**不能**把这条写成「gladlog 只做失误检测」——那是认知问题 5 的同一个越权外推,本次复核第一版就犯了,当场自查抓回。产品有明确的表扬通道:`context/burstAnswered.ts` 的 **`[BURST ANSWERED]`**(2026-09-01 用户批准,与 `slow-defensive-response` **共用一个引擎**,`feasible` 门相同、按 `responded` 互补切分 —— 同一谓词的两半,不是两套推导;按危险度选、每回合上限 2 条、要求承压方 grid 最低血确实掉下来过);另有 `killAttempts.ts:406` 的 `forced a full immunity (a win …)`、`killWindowTargetSelection.ts:44` 的「骗出来就是赚」、`verifiedComparison.ts` 的中性措辞纪律。
> **反过来这让 475 条表扬判决更有用**:它们是 `[BURST ANSWERED]` 这条通道的**现成对照集** —— 教练实际会表扬什么 vs 产品每回合只肯说 2 条、且只在爆发窗口这一个形状上说。**这个对照从没做过。**
> **(b) 分母含不发射的谓词 —— 而且有两种不发射机制,只查开关表会少算一半。** 618 条已映射判决里 **214 条(34.6%)根本不会出现在今天的菜单里**:
> - 开关 false(`candidateTypeFlags.ts`):**155 条** —— `cc-held` 83 / `unsynced-burst` 39 / `cd-spent-idle` 29 / `missed-purge` 4;
> - **已摘除接线**(2026-08-19 GH #14,纯函数保留只为渲染旧缓存,开关表里查不到):**59 条** —— `cc-locked` 42 / `wasted-trinket` 17。
>
> 88 条严格匹配里 39 条如此,真实在产的严格重合是 **49 条 = 2.3%**。
> ⚠ 这两类是**手工核对源码**得出的,不保证穷尽 —— 判断任何类型在不在产,正确做法是**跑一遍语料看它实际发射没有**(`kickEatenCostScan.ts` 的做法),别读清单。做一次全类型的观测发射普查是本条的收尾工作,尚未做。
>
> **(c) 误差棒不存在,别编一个。** 设真实缺口率 p、映射器真阳率 a、假阳率 b,观察值只约束 `0.7059 = a·p + b·(1−p)`;**没有人工标注就没有非平凡区间,识别域是 [0%, 100%]**。固定标签按视频重采样得 [67.9, 73.1](本文档旧口径),那**只是视频组成敏感性,不是缺口率的置信区间**,不含抽取错误、映射错误、教练选择与聚类错误。

### 3.2 追踪示例:从流到结论的每一环(DH 视频 `lx1nyn8wrr`)

这是整条管线唯一被端到端手工验证过的一条,也是用户批准全量前看过的 Value-Gate 示例。新 session 复现任何一环都从这里开始。

| 环       | 具体记录                                                                                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 元数据   | `course_dump.json` → commentaries[uuid=lx1nyn8wrr]:12.1 · Solo Shuffle · Cage of Carnage · Keator · Devourer DH + 增强龙 + 戒律牧 vs BM猎 + 恶魔术 + 恢复萨 · 366s                                                                                                                                                         |
| 流       | `https://www.skill-capped.com/api/video/lx1nyn8wrr/1500.m3u8`(720p,71MB,12s 下完);单帧从 `/4500.m3u8` 用 `ffmpeg -ss <t> -i … -frames:v 1` 抽,1.5s                                                                                                                                                                         |
| 转写     | `transcripts/lx1nyn8wrr.json` segments[326.3–345.6]:教练在此处下决定性判决(原话不抄;转述见下行)                                                                                                                                                                                                                            |
| 判决记录 | `verdicts_remap/lx1nyn8wrr.json`,t=318.4–342.3:`semantic=healer-free-cast-instead-of-available-cc`,polarity=mistake,转述「此刻学生仍有 incap 可用,该先打断 fear 再控住萨满,却让治疗波读满」,outcome_claim「控住无徽章的萨满就能拒掉那个治疗波并当场赢下回合」                                                              |
| 映射     | v1 `cc-held`(medium) → v2 `cc-held`(medium)。**同一文件 t=309.7 那条**(`ally-chain-cc-on-trinketless-healer`)v1 映 `missed-sync-window`(low) → v2 **unmapped**(low)——见 3.3·发现②                                                                                                                                          |
| 簇       | `taxonomy.json` assign → 两条都在 `healer-lockdown`(76 条)                                                                                                                                                                                                                                                                 |
| 画面     | `evidence/frames-dh-lx1nyn8wrr/f335_1080.jpg` + `evidence/crops/f335_enemy.jpg`:敌方框架可读 **Mogamu · Restoration · 1,082,487 HP · 徽章 44(在 CD) · 施法条 Healing Wave 约 55%**;Schollashipz(击杀目标)**169,556 HP**(从 230s 的 1,012,452 掉到 ≈17%);`crops/f335_hud.jpg`:**Round 3/6 · Wins 2 · Time Remaining 02:43** |
| 结论     | 教练判决的每一个承重事实(治疗无徽章、正在读治疗波、击杀目标残血)画面上都能独立核对到 —— 这是「专家判决 + 判决时刻可机读特征」配对的实证                                                                                                                                                                                    |

同一视频 230s 处(`f111_1080.jpg`,`crops/f111_hud_1080.jpg`)时钟读 **03:37**;335s 处读 **02:43**:走了 105s 视频,回合只过了 54s。**教练会暂停讲解**,视频时间不能线性推算回合时间(§四·bug 3)。

### 3.3 七条对 gladlog 有话说的发现(第二版;每条都对过截至 09-04 的代码与 08-22/09-02 重测报告)

**① 站位:两个教练关注点在代码里没有任何谓词。**
`position-mistake` v1 225 → v2 59,**0 条高置信**。簇级 unmapped:`spacing-overextension` 7%→67%,`pillar-los` 11%→84%,`kiting-mobility-tools` 32%→84%。
代码事实:`positionAnalysis.ts:44-51` `STAYED_IN` = 敌方爆发窗口内拉开 <5 码(`STAY_DELTA_YARDS`)且 `hpMin < 35`(`STAYED_IN_NEAR_DEATH_PCT`,`positionAnalysis.ts:78`,08-20 剂量-反应接地 n=2757 回合,commit `20153fd0`);`candidateFindings.ts:1075` `positionMistakeEvents` 只发射这一支,`MISSED_PUSH / CD_OUT_OF_RANGE` 语料 0/0。**站位过深是爆发之前的位置,`position-mistake` 这个候选类型里没有柱子/视野。**

> **2026-09-06 更正:原文写「柱子/视野在整个类型里没有概念」「从零开始」是错的。**
> `healerExposureAnalysis.ts:501` 已经在输出 `— LoS break ~{N}yd away (pillar-blocks {敌人})`,几何验证过,且带 ≤30 码的可达性门,只在 Critical/Exposed 窗口提示;`buildMatchContext.ts:587` 已接入产品时间线。**概念存在,只是在上下文层不在候选层。**
> 根因:映射器只能在候选类型清单里选,**看不到上下文行、时间线、派生事实**,所以「没有候选类型匹配」被越权解释成了「产品没有这个概念」——这正是 CLAUDE.md 完备性规则禁止的推理形状(用清单内的检查宣判清单外的世界不存在)。发现 ③⑥ 犯的是同一个错,见下。
> 仍然成立的部分:簇级迁移量(+60.0 / +73.7 / +52.0pp)远超噪声底,**迁移是真的**;「`position-mistake` 候选只覆盖爆发窗口内的一支」也是真的。

**② CC 与爆发窗口:谓词已修好,教练讲的是它的上游。**
`burst-window-setup`(127) + `cross-cc-coordination`(122) + `healer-lockdown`(76) = 325 条,最大主题。v2:`unsynced-burst` 39(11 high)、`missed-sync-window` 18(3 high)。
代码事实:`unsynced-burst` 的可行性门 `teamCcReadyAt`(`candidates/cooldownTiming.ts:386`)08-22 已落地;`missed-sync-window` 08-15 退役(GH #13)、**09-02 复活重设计**(commit `7b5e8d3f`:kill≤15s 对比 2v2 +7.7 / 3v3 +5.9 / 单排 +4.5 pp,触发率 74%→28.8%,PROMPT_VERSION 49)。
缺口:gladlog 检测的是**进入**已存在的控制窗口;教练讲的是**做出**窗口(「延迟几秒等控好了再开」「趁治疗没徽章时连控」)。3.2 里 t=309.7 那条从 v1 `missed-sync-window` 变 v2 unmapped,就是映射器在正确地收紧。这 325 条是 09-02 新谓词**从未对照过的**专家目标句。

**③ 保人:`peeling` 多数未映射成立,但「只有交外减」是错的。**
`peeling` 99 条跨 21 专精,68/99 unmapped(条件区间 58.5–77.4%,多数未映射站得住)。

> **2026-09-06 更正两处。**
> (a) **「缺控制保人与站位保人」是错的**:`burstWindowDecisionPoints.ts:947` 的 `responses` 已经同时记 `wall / external / healCd / **control** / **kite**`——队友对爆发施法者的控制、以及被压目标的拉扯,都已计为保人应对。同 ① 的越权外推。
> (b) **「v2 映 12 条」是分母混用**:12 是 `external-unused` 的**全语料**总数,`peeling` 簇内实际只有 **1 条**。另外 v1→v2 该簇只多了 4 条,差值区间 [−5.9, +13.9]pp,**不能声称这次重映射揭示了稳定的新增缺口**。

**④ 徽章纪律:对退役的 `wasted-trinket` 不做任何建议。**
v1 31(19 high) → v2 17(**2 high**)。真实谓词是「中立状态下交徽章:全队 HP≥80%、治疗未被控、对方无进攻 CD」;教练讲的徽章纪律是另一个事件,v2 主要映到 `cc-locked`(26) 当上下文。第一版的「翻案」建议建立在 slug 上,**撤回**。

**⑤ `cc-locked`:不做任何主张。**
v1 4 → v2 42(4 high)。第一版「教练几乎不提 ⇒ 佐证退役」是 slug 假象、方向反了,且逻辑本身不成立(教练不评论「你被控住」是因为那不是学生的决策)。08-22 梯度 0.0。**撤回**。

**⑥ 逼出对方冷却:~~归因率全场最高、gladlog 没有、最该做~~ → 2026-09-06 降级,三条支撑理由全部证伪。**
`forcing-enemy-cooldowns` 70 条,61/70 unmapped(条件区间 77.6–94.8%,高未映射率本身成立)。

> **本条原是「最高价值新方向」,现降级为「过不了可行性门」。三条理由逐条:**
>
> **(a)「记账方向不存在」错。** `killAttempts.ts:117` 已记 `trinketed / immunityBaited / defensivePopped / externalReceived`;`:406` 字面渲染 **`forced a full immunity (a win — re-open after it drops)`**;`buildMatchContext.ts:810` 已接产品时间线。方向存在,锚在击杀尝试上。
> **(b)「不依赖映射,v1→v2 不变」错 —— 这是本条唯一在 bug 1 之后仍被信任的理由,它是假的。** 实测 `summary_v2.json`:**44 → 61(63% → 87%)**,和其它簇一样依赖映射。
> **(c)「归因率全场最高」是样本排名,不是效应。** 60/70 = 85.7%,第二名 `dampening-attrition` 16/19 = 84.2%,差 1.5pp。
>
> **(d) 设计杀手(必须先解决才谈动工):**`verdicts_remap/2xcc6n29l5.json` 的 `/11 /12 /13` 三条讲的是**同一次交换**——`/11` 表扬「学生用晕逼出了对面冷却」、`/12` 判失误「对面**根本不需要**交,是白送不是被逼」、`/13` 警告「别围绕这种交换做打法,高分队伍不会这么交」。**同一条施法账本事实(我控了→对面交了)同时支撑「做得好,继续」和「别指望这个」。** 只看施法先后的信号在这里必然给出错误教学:施法顺序不提供「为什么交」的反事实。按 CLAUDE.md 价值门第 3 条,这是可行性门在写第一行代码之前就失败。
>
> **(e) 量级也不支持。** 在可行动人口(失误 ∩ unmapped = 531 条)上,本簇只有 **13 条**(占缺口 2.4%);簇内另外 81% 是表扬、更优解与跨回合方针。

**⑦ 教练与 gladlog 逐事件重合的四个类型(4.2%)。**
88 条 high 集中在 `cc-held` 19(主要来自 `go-cadence-idle-cooldowns`)、`dr-clipped-cc` 15、`kick-eaten` 13(来自 `own-cast-protection`)、`unsynced-burst` 11。这是最适合拿教练判决当 Value-Gate 目标句去校验现有输出措辞的地方。`cc-avoidable` 08-22 梯度 +2.7/+2.7/+0.7 稳定正向,v2 映 34 但 high 只 2——谓词对、事件粒度不同。

**⑧(2026-09-06 新增,复核产出)语料里最值钱的东西不是覆盖缺口,是 38 条现役谓词的假阳性反例。**
筛法一行:`gladlog_type != unmapped` 且 `polarity == correct` —— **教练明说这一手做得对,而 gladlog 的谓词会在这里开火**。38 条,跨 25 个视频,其中 5 条 high 置信。
按谓词:`cc-locked` 13 / `kick-eaten` 8 / `burst-into-mitigation` 2 / `slow-defensive-response` 2 / `position-mistake` 2 / 其余 `missed-cleanse`·`missed-purge`·`dr-clipped-cc`·`unconverted-burst`·`missed-purge-kill-window`·`off-target-in-window`·`cc-held`·`attempt-into-trinket`·`cd-hoarded`·`questionable-external` 各 1。

**为什么这比 1483 条 unmapped 值钱**:整个项目一直缺的是「归因对不对」的真值(标定只测发生率、模型行为与确定性)。注意这 38 条筛的是**极性与谓词冲突**(教练判 correct、却落在一个只在失误上发射的候选类型上),与「产品有没有表扬通道」是两件事 —— 表扬通道确实有(见 §3.1 更正 (a)),但它不会把这一手同时又指控一遍;冲突就在这里。这 38 条是**带理由的标注负样本**,而且理由在同一谓词内高度一致,不是随机噪声:

- **`kick-eaten` 8 条**。⚠ 本次复核第一版把这 8 条概括成「理由统一是代价为零」,**是过度压缩,已更正**。逐条读下来是**五种不同理由**,分布很分散:

  | 教练的免责理由 | 条数 | 可判性 |
  | --- | ---: | --- |
  | **锁的学派不重要**(Holy / Fire / Shadow 各一) | 3 | 需要「你下一步要放什么」,现无此事实 |
  | **你把锁定转化好了**(被锁冰系正好去补变形,教练称之为「正确反应」) | 2 | **已可观测** = `postKick="switched"` |
  | 没人承压(大家都满血) | **1** | 可判 = `threatActiveAt` |
  | 骗断本来就是对的打法 | 1 | 交换收益,机器判不了 |
  | 拉扯合理、这断躲不掉 | 1 | 可行性/可反应性 |

  现役 `kick-eaten` **没有任何代价门**:只有 `postKick` 严重度排序(idle > acted > switched)与 `KICK_EATEN_CAP`。
- **`dr-clipped-cc`**(high):「把昏迷交在冰环上是对的,即使控制已经递减,**因为停掉那个读条才是重点**」——缺一个「有没有值得打断的读条」豁免。
- **`cc-locked` 13 条**(最多):与本文档 §3.3·⑤ 记的「08-22 梯度 0.0」独立互证。但 **`cc-locked` 2026-08-19(GH #14)已整个退出菜单**,所以这 13 条**不构成在产误报**。

**「在不在产」有两种退役机制,只查开关表会漏 —— 本次复核在这里也栽过一次。** 一种是 `candidateTypeFlags.ts` 里 flag = false(`unsyncedBurst` / `ccHeld` / `cdSpentIdle` / `missedPurge` / `killReview`);另一种是**直接不接线** —— `cc-locked` 与 `wasted-trinket` 2026-08-19 同日从 `extractCandidateFindings` 的装配里摘除,纯函数与测试保留只为渲染旧缓存,**开关表里查不到它们**。判断任何类型是否在产,**以语料实测发射为准**,别读清单 —— 这正是 Curated-List Completeness Rule 的同一条教训换了个对象。

**在产可核验的上界是 23 条,不是 38 条**:扣掉已退役的 `cc-locked` 13、开关 false 的 `cc-held` 1 与 `missed-purge` 1,再扣同样不发射的类型后,真正能落到在产输出上核验的最多 23 条,其中 `kick-eaten` 8 条最该先查。

**已知的折扣(引用前必读)**:映射器判「这条判决对应 `kick-eaten`」≠「gladlog 在那一刻真会发射 `kick-eaten`」,中间隔着完整前提(时间锚、目标、门槛)。所以这 38 条是**待验证的假阳性线索,不是已证实的误报**;把每条落到真实日志上确认谓词确实发射,是它们变成真值的最后一步。这也正是本文档 §四·bug 1 的教训在新方向上的复现风险。

### 3.4 三个簇不属于对局判据,各有归宿

`talent-build`(48,100% unmapped)→ 外部知识层(日志看得见你点了什么,「构筑错」需要外部的「什么是对的」);`comp-gameplan`(42,98%)→ 外部知识层,但「有没有续控制链」这类可测的回收;`overall-verdict`(62,98%)→ 跨对局汇总层的**输出风格参照**(gladlog 教练输出目前没有任何参照物)。

### 3.4b 教程线(courses):三分与它真正产出的东西

**语料**:17 门课 / 154 视频 / 1914 条规则 → **1306 条 decision**(381 条 mechanic-fact、227 条 mindset 分开计,不入三分分母)。抽取 Opus-high 两段式;映射阶段重跑一次(真谓词 + 派生边界),v2 为准。

**三分(仅 decision,v2)**:日志能判 **443 (34%)** / 需新数据 **724 (55%)** / 结构不可判 **139 (11%)**。映射 unmapped 765 (59%),严格匹配(已映射且 high)85。

**v1→v2**:日志能判 60%→34%,360 条挪去「需新数据」,结构不可判持平 —— 收紧只切在「日志里有 vs gladlog 派生了」这条线上。映射器点名的缺失派生量全是真实的:uptime/时长指标(减速、近战、time-on-target)、坐标派生的距离/LoS 模型、光环「被消耗 vs 空过期」追踪、爆发窗口内 peel 覆盖比例。

**日志能判且无类型 = 93 条**(v1 同口径 249):ENEMY BUFF KNOWLEDGE 31、COUNTER EVERY MELEE 10、COUNTER EVERY RANGED 10、ROAD TO GLADIATOR 10。**大头是法术级反制规则行**(踢 X、晕时上沉默让他按不出 IBF、Wraith Walk 后再定身)—— 形状是 arenacoach 21 条 / `DISPEL_PENALTY_SPELLS` 那种手维表,**受 CLAUDE.md Curated-List Completeness Rule 管辖**,教练语料可作这类表完整性对账的外部来源。真正的新类型只剩 **setup 族**(RTG EP.1:全员瞬发控制同刻落下、一人锁一个对手、控制别放在击杀目标上),形状可判:`Δt 内 ≥2 硬控落在不同敌人`;与 VoD 发现②同向,**三个独立来源指向同一缺口**。

**4 个手写类型 0 命中 = 内容,不是定义**:换真谓词后 cd-waste 3 / missed-kick 8 / missed-purge-kill-window 5 / questionable-external 4,与 v1 持平。`OFFENSIVE DISPELS` 仍 missed-purge-kill-window=0、missed-purge=9:真谓词要求「与己方击杀窗口重叠」,教程规则是无条件的「该 purge X」,映射到退役的 `missed-purge` **是对的**;`CASTER SOLO SHUFFLE` missed-kick=0 同理(教练说「踢 X」,不说「你踢空了」)。

**一般性观察(比任何百分比重要)**:教程规则是**处方形**(do X),gladlog 谓词是**失误形**(you did X wrong)。VoD 判决天然贴谓词;教程线的产出主要是**规则表行**与**缺失派生量清单**,而不是新候选类型。

### 3.5 三个已实测的取材常数

- **720p 不够,HUD 必须 1080p**:同一时刻两个档位,`Round/Time Remaining` 在 720p 放大 7× 仍糊,1080p 清晰;敌方框架、施法条 720p 可读。不需要整片高码率——单帧 1.5s。
- **转写 ≈ 0.35× 实时**(faster_whisper turbo, int8, 3 并行分片);crv 全流程 ≈ 0.6×。VoD 只需转写 + 按判决时刻抽帧,不需要 crv 全量抽帧。
- **判决抽取 ≈ 2 分钟/视频**(`claude -p`),重映射 ≈ 1.5 分钟/视频。

## 四、三个方法 bug + 五层认知问题(新 session 绝不能重新踩)

**bug 1(最贵):映射器拿的是类型名不是定义。** 第一版给映射器 29 个 slug,得 46% unmapped;只换映射阶段、喂 `buildFindingsPrompt.ts` 的真实谓词(`type_definitions.json`,4 条缺的从 `mistakes.ts` label + 审计补),得 **71%**,逐条一致率 59%。最大迁移流:`position-mistake→unmapped` 164、`cd-waste→unmapped` 85(真实定义是死亡锚定的保命 CD 未用,不是任何浪费)、`missed-sync-window→unmapped` 55、`missed-kick→unmapped` 30(真实定义是「打断空放」,教练说的「你该打断那个」是**相反**事件)。反向:`cc-locked` 4→42,`unconverted-burst` 0→18、`off-target-in-window` 0→16(第一版词表根本没这两个)。**基线 agent 当时明写了「必须从工具自己的 schema 拉定义」,被忽略了一轮。** 规则:任何按类型名做的对账都不可信,以后吸收任何外部语料同样适用。

**bug 2:抽取与映射同 prompt 的锚定偏差——实测可忽略,但要知道量。** 同 8 条视频用盲态两段式(抽取时完全不给类型清单)重跑:37.4% → 39.8%,+2.4pp,配对 t=0.18,95% CI [−9.5, +11.1]。**被 bug 1 的 +24.9pp 完全盖过。** 附带发现:逐视频 unmapped 率跑间噪声 ±10pp 量级(n≈25 时二项 SD 即 10pp),**只有语料级汇总站得住,簇级百分比一律带 ±sd 读**(页面表已逐行标)。

**bug 3:视频时间 ≠ 回合时间。** 见 3.2。任何时间锚点必须逐帧读 HUD 时钟;更稳的是锚定 HUD 状态 + 日志第 N 个 `ARENA_MATCH_START`(基线 agent 提出,比逐帧 OCR 好,未实施)。

**bug 4:用量上限会让 `claude -p` 静默全灭。** 09-05 映射重跑中途撞上限,后续 103 次调用全部 `rc=1 stdout=60B stderr=''`;我当时的错误文本只记 stdout **长度**,看不见内容,分类器保守地拒绝重放(正确)。修法已固化在 `tools/coach-corpus/common.py::claude_call`:错误文本带 stdout 前 120 字。**看到限额字样再 `/limit-reset`、原命令重放;没看错误文本前不要重放。**

**认知问题 1:教练关心 ≠ 有判别力。** 教练讲的是**可教**的事;gladlog 判别力测的是**是否预测输赢**。一件事可以被反复教、同时在该分段与胜率零相关。第一版把 325 条 CC/爆发判决当成了「gladlog 的 −4.4 测量是错的」的证据——滑步。语料只能证明「这是公认关注点」。

**认知问题 2:`coaching-grounding-audit.md` 落后于代码。** 截至 09-04 至少三行过期:`position-mistake`(仍写「等 #16 接地 85/15/35」,实际 08-20 已接地为 35 单线)、`missed-sync-window`(仍写「−4.4 反向、74%」,那是已死的旧谓词,09-02 新谓词 +4.5~+7.7pp)、`unsynced-burst`(round2 报告发现的可行性缺陷 08-22 当天已修)。另 `death-unused-defensive` 08-29 退役(GH #58)。**引用审计任何一行前先 `git log -S`。**

**认知问题 4:三分对模型不敏感,对定义敏感。** 验证课上 Opus-high 判 60% 日志能判、默认模型 34%,看似模型差 18pp;把三分边界从「日志携带该事实」写死成「gladlog 现有代码已派生该事实」后,Opus-high 也收敛到 34%。另一 session 的 A/B 结论(Opus-high 精度更高)是在**读图**任务上像素级核实的;本线是纯文本,该结论不直接迁移。**配对模型比较目前被 prompt 版本混淆**(`rules/` 用旧三分定义):要干净的单变量比较需用 v2 prompt 重跑默认模型那 9 集的映射,未做。

**认知问题 3:「slug 假象」会同时朝两个方向骗。** 它让 `position-mistake` 虚高(吞下站位一切),也让 `cc-locked` 虚低(名字不像教练用语)。所以第一版基于映射分布做的每一条推论——包括看起来「反向佐证」的——都得重来。

**认知问题 5(2026-09-06 新增,本次复核的头号教训):候选层的沉默不是产品的沉默。**
映射器只能在 26 条候选谓词图例里选,它**看不到上下文行、时间线、派生事实、渲染层**。所以「没有候选类型匹配」= unmapped,被本文档第一版越权解释成了「gladlog 没有这个概念」。三条主要发现全栽在这一步:① 柱子/视野(`healerExposureAnalysis.ts:501` 一直在输出)、③ 控制保人与站位保人(`burstWindowDecisionPoints.ts:947` 的 `responses.control`/`kite`)、⑥ 逼出对方冷却(`killAttempts.ts:406` 的 `forced a full immunity`)。
**这在形状上就是 CLAUDE.md「手工清单完备性规则」禁止的推理**:用清单内的检查去宣判清单外的世界不存在。那条规则原本管的是法术 id 表,这次是**候选类型清单**——同一个失败形状换了一层皮,而且**本文档在引用那条规则的同时犯了它**。
规程:任何「gladlog 没有 X」的断言,落笔前必须 `grep -rn` 过 `packages/analysis/src` 全包(不只是 `candidateFindings.ts` 和 `buildFindingsPrompt.ts`),并且区分三种沉默 ——「真没有」/「有但在上下文层不在候选层」/「有候选但开关 false」。第三种在本语料里占 618 条已映射的 25%。

**认知问题 6(同批):同一条判决可以既是正例又是反例,聚类抹掉这一点。**
`cluster.py` 按 `semantic` 标签分簇,而不是按完整判决。`2xcc6n29l5` 的 `/11 /12 /13` 同属「逼冷却」语义、讲同一次交换,却分别是「做得好」「对面白送」「别指望」。**「35 个簇 35 个判断」这个省力假设在这里失效**:同簇内的可判性可以完全相反。§五 第 1 项若要产出,必须能对这三条给出三个不同答案;给不出就说明那张表已经失效。

## 三之补、严格匹配的在产分层(2026-09-06 二次复核,**订正的是复核自己的数字**)

§3.1 的 (b) 记「88 条严格匹配里 39 条不在产,真实在产 49 条 = 2.3%」。**这个数也是错的。** 本次按
「发射点 / 展示层规则 / 开关表」三项自动核对(`tmp/skillcapped-vod/high_tiers.json`),88 条分层为:

| 层 | 条数 | 类型 |
| --- | ---: | --- |
| **D 在产**(有发射点 + 展示层有规则) | **16** | burst-into-mitigation 5 · external-unused 3 · missed-sync-window 3 · questionable-external 3 · cc-avoidable 2 |
| C 发射但展示层无规则(进候选菜单,不进失误表) | 21 | kick-eaten 13 · cc-locked 4 · wasted-trinket 2 · death-unused-defensive 1 · missed-cleanse 1 |
| B **已摘除发射**(代码里零发射点) | 16 | **dr-clipped-cc 15** · missed-kick 1 |
| A 开关 false | 35 | cc-held 19 · unsynced-burst 11 · cd-spent-idle 4 · missed-purge 1 |

**真实区间 16–37 条 = 0.8%–1.8%**(下界只算 D,上界含 C)。复核的 49 与本次第一遍复算的 47 **都把
`dr-clipped-cc`(15 条,2026-08-20 GH #17 已摘发射)当成了在产** —— 两个独立的计数犯了同一个错,因为
两次都只查了开关表。这正是 §四认知问题里那条规程要防的:**三种沉默必须分开查**,只查
`candidateTypeFlags.ts` 会连着漏 B、C 两类。

分层是自动核对,已知一处误分类:`missed-kick` 走 `analyzeKickAudit` 的 kick 通道而非
`candidateFindings`,被判进 B 层,实际在产。**任何再次引用这组数字的人,先重跑那个分层脚本,
不要转抄。**

## 四之补、映射器负对照(2026-09-06,本次新增;**证伪了一条曾被列为最强威胁的假设**)

复核期间提出的怀疑:「71% 会不会是映射器过于保守 —— 它把本该映上的事件也判成无对应?」**实测证伪。**

做法(`tools/coach-corpus/negative_control.py`,可复跑):agy/Gemini(**不同模型家族**,避免同源相关)把 17 个在产类型的真实谓词各改写成 4 句**教练口吻**的判决(明令不得复用定义措辞);混入 30 条来自 `talent-build`/`comp-gameplan` 簇的**真实结构外判决**作干扰项;打乱去标签后喂进**与语料完全相同的映射 prompt 与模型**(claude-opus-5/high)。

| | n | 结果 |
| --- | --- | --- |
| 在产类型的教练口吻改写 | 68 | 映回源类型 **97%** · 映到任意类型 **100%** · 映回且 high **87%** |
| 结构外真实判决(干扰项) | 30 | 被硬套到某类型 **3%** |

**映射器把在产事件判成「无对应」的比例是 0%。** 缺口不是映射器胆小造成的;它也不滥映。

**但这个测试的边界必须一并引用**:正样本由定义改写而来,即便换了词,仍是谓词的*干净实例*;真实教练说话更含混、更依赖上下文,所以 97% 是**召回上界**,不是真实语料上的召回率。干扰项也偏易(天赋/阵容明显不属候选层),**没有覆盖「话题相邻但事件不同」的中间地带** —— 那才是映射最容易出错的地方,仍未测。原始数据在 `tmp/skillcapped-vod/negative_control/`(`generated.json` = 靶子,`results.json` = 逐条判定)。

**这条不改任何头条数字**(§3.1 的两层口径订正照旧成立),它只关闭了一个备选解释。

## 五、剩余工作(按价值排序,都还没做)

> **2026-09-06 复核重排。** 原顺序把「1483 条按簇三分」放第一、「88 条目标句」第二。两条都降级,理由分别是:第 1 项的产出是**又一层 LLM 意见,不可证伪**,且「35 个簇 35 个判断」这个省力假设已被 `2xcc6n29l5/11-13` 证伪(认知问题 6);第 2 项的 88 条实际是 45 条,且 high 是模型自评。
> **新的第 0 项(下面)是唯一一条自带真值、零标注成本、能出前后数字的工作。**
> 一个更强的长线选项(gpt-6-astra 建议,尚未排期):做一次小规模**人工盲标**的「真实决策 → 现有产品输出」对照审计,预先固定抽样规则、标注时隐藏映射结果,按同一人工标准报告 v1/v2 错误数。若审计固定 N 条事件、确认 U 条确实缺失、C 条确实覆盖,缺口率可报为 **[U/N, 1−C/N]** —— 这是**不依赖 LLM 映射**的界限,也是唯一能给 §3.1 那个「识别域 [0,100%]」装上误差棒的办法。第 0 项的 38 条正好是它的第一批种子。

0. **【新,最高优先】拿 §3.3·⑧ 的反例校 `kick-eaten`。前数字已跑,第一版方案已被自己的数字否掉;现在的头号候选是「`switched` 该不该发射」,不是威胁门。**
   为什么这一族排第一:(a) 全语料唯一自带**标注真值**的一批(教练明说做得对 ∩ 谓词会开火);(b) 不需要任何新谓词;(c) 降的是**在产**信号的误报,用户直接能感觉到;(d) 形状与已验证有效的 `cc-avoidable` 加门(−68%)完全相同;(e) 能出符合 CLAUDE.md 验证规则的前后数字。
   **仪器已固化**:`packages/eval/scripts/kickEatenCostScan.ts`(不是一次性脚本),直调生产 `extractCandidateFindings`,代价判据复用 `threatAssessment.ts` 单源谓词、同样先 `toRenderSecond`。
   为什么选 `kick-eaten` 而不是数量最多的 `cc-locked`(13 条):`cc-locked` 2026-08-19 已退出菜单、**不发射**,改它不影响任何真实输出;`kick-eaten` 不受开关管、恒开,且是 08-29 梯度测试里少数过关的信号(过关 ⇒ 会持续出现在输出里 ⇒ 误报代价持续)。

   **⚠ 前数字已跑,而它否掉了「只加威胁门」这个第一版方案 —— 接手前必读。**
   `npx tsx packages/eval/scripts/kickEatenCostScan.ts --n 400`(2026-09-06,本机库 400 回合):
   **264 条 `kick-eaten` / 177 个回合触发;落在无威胁瞬间的 21 条 = 8.0%。**
   `U/N = 8.0%` 过了 5% 门槛,但**被抑制的 21 条里约 8 条是进攻性控制读条**(`Sleep Walk` ×5、`Mind Control` ×2、`Cyclone` ×1):被断的代价是「你的控制铺垫废了」,**与队友有没有在挨打无关**。`threatActiveAt` 量的是**防守**危险,拿它当所有 kick 的代价代理是错的,`U/D` 最多约 62%,**达不到 90%**。
   → 修正方向(未做):门只在**被断的是治疗/伤害读条**时适用;进攻性控制读条的代价要另立判据。
   → 而且威胁门只对应上表 5 种理由里的 **1 种(1/8 条)**,声称它「解决三分之一」是错的。

   **同一次扫描指向一个更大的目标(建议先做这个):**`postKick="switched"` 占全部发射的 **174/264 = 65.9%**,而 `candidateFindings.ts` 自己的注释就写着它「几乎不用教」,教练语料也**两次明确表扬**这个行为(被锁冰系→立刻补变形 = 「正确反应」)。排序把它排最后,但它照样在 cap 内发射。真正该问的不是「加不加威胁门」,而是 **`switched` 该不该发射**。
   **量级实测(同一次 400 回合扫描):`switched` 174/264 = 65.9% 的事件;`kick-eaten` 全部为 `switched` 的回合 105/177 = 59.3%。** 也就是说 `switched` 不发射的话,**59.3% 的触发回合会整类失去 `kick-eaten`**;而威胁门只影响 7/177 = 4.0%。**量级差 15 倍。**
   三方证据同向:(i) `candidateFindings.ts` 的 `POST_KICK_SEVERITY` 注释自陈 switched「几乎不用教」;(ii) 教练语料 2 条明确表扬该行为;(iii) 语料实测它占了三分之二的发射量。
   **反方向必须先答的一条**:注释里的语料锚是「切换率跟专精能力上限走(戒律 76–80% vs 神骑 8%)」。神骑能切说明他做了件难事(更不该被指控),所以「switched ⇒ 不可教」跨专精成立;变的只是频率。但这条要在裁决前独立验一次,别照抄注释。
   ⚠ **这是退役一个在产类型的三分之二发射量,按 CLAUDE.md「退役信号是用户裁决,不是聚合数字裁决」,本条只到「已备齐证据、等裁决」为止,不自行动工。**

   **✅ 2026-09-06 已验证「跨专精」那条软肋 —— 结果是问题本身问不出来,因为 `switched` 不在量它名字声称的东西。仪器:`packages/eval/scripts/postKickSwitchAudit.ts`。**
   `ccTrinketAnalysis.ts:944-970` 的判据是「被踢后 5s 内任一 `SPELL_CAST_SUCCESS`,学派掩码与被锁学派零重叠」—— **不要求硬读条**。400 回合实测 292 条 `switched`:
   **只有 16 条(5%)带配对的 `SPELL_CAST_START`(即真的读了条)。**
   触发「switched」判定最多的技能:回响 71 / 火焰吐息 29 / 青翠之拥 18 / 悬空 13 / 逆转 12 / 苦修 10 / 法力茶 10 / 猎豹形态 8 / **角斗士的勋章 6**。
   **一条反例就够,不需要统计**:按 PvP 徽章被判成 `kept playing through the lockout (other school, first cast X s later)`。
   五个专精同向(唤魔 97% / 武僧 100% / 德鲁伊 100% / 戒律 91% / 神牧 73% 无 CAST_START),不是唤魔师样本(200/292)偏斜造成的。

   **两条老实话(这个 95% 是上界,不是净瞬发率):**
   (i) `parser-compat` **完全没有 channel 事件**,引导法术(苦修、法力茶)与瞬发无法区分,会抬高这一桶 —— 当前解析数据量化不了。
   (ii) 我试图用 `empowerEnds` 单独扣掉唤魔师蓄力技,但该字段 **400 回合里非空次数为 0**(字段存在于 163/400,全是空数组),**这个边界是空的**,火焰吐息那 29 条没被排除。「缺失 ≠ 零」—— 与 `castStartEvents` 同一个陷阱,脚本已把覆盖率打印出来防止误读。

   **由此三条结论,和原来的方向都不一样:**
   1. `POST_KICK_SEVERITY` 注释里的语料锚「切换率跟专精能力上限走(戒律 76–80% vs 神骑 8%)」量的是**按了任意异学派瞬发的比率**,不是「打穿锁定」。**整条严重度轴建在一个测错的量上。**
   2. 渲染文本与谓词不一致 —— 正是 CLAUDE.md 共享谓词规则的形状(「锚定到渲染值」)。`firstActionDelayS` 取 `after[0]`,同样可能是瞬发,所以那个秒数也一起失真。
   3. **「退役 `switched`」打错了靶子,撤回。** 它排最不可教,于是一个被彻底打断、只按了个瞬发的玩家反而拿到「你没事,继续打了」的标签 —— 这类事件是**更**该教的。删掉整桶会连这部分一起删。

   **✅ 已落地(2026-09-06,用户批准「就按你说的做」)—— 最小修法,纯渲染,分类一行没动。**
   `candidateFindings.ts` 的 `postKick` 事实由
   `kept playing through the lockout (other school, first cast Xs later)` 改为
   `acted on another school {触发那一发自己的延迟}s later ({技能名}[, hard cast|, instant or channel])`。
   `ccTrinketAnalysis.ts` 新增三个字段记录触发那一发(`switchSpellName` / `switchDelayS` /
   `switchWasHardCast`),写在一处、读在一处,无其它消费者。
   分类判据未变:原先的 `after.some(p)` 改为 `after.find(p)` —— `some(p)` 为真当且仅当
   `find(p)` 有值,只是顺带**点名**了那一发。语料回归:`switched` 菜单条数改前改后同为 174。

   **顺带修掉一个此前没人发现的缺陷:旧文案把两个不同的施法缝在一句话里。** 延迟取自
   `firstActionDelayS`(窗口内第一发),而「异学派」的声称来自第一发**掩码不重叠**的施法 ——
   两者常常不是同一发。实测 `825ca842`:旧文案写 `first cast 0.5s later`,而真正触发判定的
   `Will to Survive` 在 **2.0s**。现已引用触发那一发自己的延迟,并钉了回归测试。

   **`switchWasHardCast` 是三态,不许猜**:`true` 找到 CAST_START;`false` 有数据但没找到
   (瞬发**或引导** —— parser-compat 没有 channel 事件,分不开,所以文案只说 「instant or channel」);
   `null` 该单位没有 cast-start 数据(旧归档),**只点名技能、不加任何限定词**。

   **两项加强当时明确不做**(用户只批了纯文案):① 把窗口内全部施法列进事实行;
   ② 改 `POST_KICK_SEVERITY` 排序。②「例 ③ 排最不可教明显是反的」这个观察仍然成立,
   但它动排序与 cap、影响面大得多,**等文案变真之后单独立项**。

   **同批发现、按批准范围没做的第三项(未测,别当结论)**:`acted` 分支仍写 `waited out the lockout (first cast Xs later)`,而 `acted` 是个**兜底桶** —— 分类要求 `switched` 同时满足「被锁法术掩码已知」与「该次施法掩码已知」且不重叠,
   所以**被打断法术的掩码未知时,窗口内所有施法都会落进 `acted`**,那句「waited out」就成了假设而非观测。
   `switched` 那条的教训(名字/文案与谓词漂移)在这里可能同构。**频率没测**,下一步先跑一遍「`lockedMask === undefined` 占多少」再决定要不要改。

   ~~建议的最小修法(纯渲染,不动谓词,零新数据,待裁决)~~:把那句话改成如实叙述 ——点名那一发是什么、什么时候(例:`acted on another school 1.5s later (Echo)`),而不是断言 `kept playing through the lockout`。谓词不变,声称变真,模型拿到能自己判断的事实。严重度该不该继续把它排最后,等事实诚实之后才谈得上。
   真正按「有没有继续读条」重新分类需要先补 channel 事件(解析层缺口),**是另一个项目,不要在这里顺手做**。
   **验收门槛(gpt-6-astra 2026-09-06 预设,工程决策门槛不是统计显著性):**
   同一批回合、相同排序与 cap 下重放开门前后的菜单,记 `原菜单条数 N / 被移除数 D / 其中确属不值得批评数 U`,
   要求 **`U/N ≥ 5%` 且 `U/D ≥ 90%`,并至少人工核验 10 条被移除事件**。
   只有「无威胁比例约 10%」**不足以过门** —— 必须证明移除得对。
   另两条纪律:审查要看**整个锁定窗口**而非只看门采样的那一瞬间(±3s 外才出现的代价会被漏掉);   「候选层反例」与「最终教练文字误判」**分开计数,禁止合并** —— 菜单发射不等于最终文字判错。
   `cd-spent-idle` 的红线 B6(`matchThreat==='low'` 直接返回 [])**不照抄**:整局低威胁不豁免某一次关键学派锁定;共享同一个事实谓词不等于必须共享全部退出条件。

1. **VoD 线的 1483 条 unmapped 按簇三分**(35 个判断,不是 1483 个)。教程线已从规则侧做完三分(§3.4b),VoD 侧可直接复用同一套「gladlog 已派生」边界与 `tools/coach-corpus/extract_rules.py` 里的 MAP 三分段;三个最大候选:② 的「做出窗口/可行性」(setup 族,三源同向)、⑥ 的「逼出对方 CD」记账、① 的站位过深与柱子/视野。
1b. **把教程线 93 条「日志能判且无类型」分两堆**:法术级规则行(→ 现有手维表的完整性对账,按 Curated-List Completeness Rule 走 `curatedIdRegistry`)vs 真新类型(setup 族)。纯读文件,零 token。
2. **用 high 匹配当 Value-Gate 目标句**,逐条对照 gladlog 在同类事件上的实际输出措辞。按 CLAUDE.md Value-Gate Rule,任何新信号动工前必须先手写目标结论句。**2026-09-06 更正:可用的是 41 条不是 88 条** —— 88 →(去 10 条表扬/更优解极性,谓词只在失误上发射)78 →(去 37 条映到不发射的谓词:开关 false 的 33 条 + 已摘除接线的 `cc-locked` 2 与 `wasted-trinket` 2)**41**。按谓词:`dr-clipped-cc` 14 / `kick-eaten` 9 / `burst-into-mitigation` 5 / `external-unused` 3 / `missed-sync-window` 3 / `questionable-external` 3 / `cc-avoidable` 2 / `missed-kick` 1 / `missed-cleanse` 1。注意 high 是模型自评,且 79 条仍标 `needs_frame`;「high」≠「教练与产品建议一致」,逐条要分开标「事件一致 / 建议一致 / 前提齐全 / 产品当前是否发射」四项。
3. **09-02 的 `missed-sync-window` 新谓词从未对照过专家判决**:`healer-lockdown` 簇 76 条(v2 `unsynced-burst` 16 + `cc-held` 10)是它的对照集。
4. **修审计文档的三行**(认知问题 2)。小活,但不修会继续误导下一个读者。
5. **读帧**(1344 条 `needs_frame=true`):成本最高,等 1–3 落定、明确要验证什么之后再做。`evidence/` 里的 DH 示例是读帧的模板。
6. B 层(12.1 meta 知识:`talent-build` / `comp-gameplan` 90 条 + 教程线 43.9 h 专精手法课)——用户批准过 A+B 一起,但 B 尚未开始;按 Value-Gate 先手写目标句。
7. 干净的模型配对比较(认知 4):用 v2 prompt 重跑 `rules/` 那 9 集的映射(默认模型,便宜),再与 `rules_opus_v2/` 比。只有还想知道「Opus 比默认强在哪」时才值。

## 六、还没做的分析方向

- 12.1 只有 5 条,且每周在涨(最新一条 09-04)。目录 dump 可重拉,`fetch_transcribe.py` 对已处理 uuid 自动跳过,增量成本 ≈ 3.5 分钟/条。
- 2895 条 10.x/11.x 点评:对 meta 有害,但「错误分类学」与版本无关。若要扩大 n 做簇级统计,这是唯一的量来源;需要用户裁定。
- 教程课程(258 门 / 75 小时):用户原话「基本是写好的本子」,转写扛住大部分信息,画面按需。这是**下一条线**(用户 09-05:「然后我们去扒教程视频」),不在本 HANDOFF 范围。

## 七、跑法与坑

**入口是 runbook `docs/commands/ingest-coach-corpus.md`,工具在 `tools/coach-corpus/`**(09-05 从 tmp 里的散脚本固化而来;tmp 里的旧脚本仍在,只作历史复现,新工作一律用 `tools/`)。速查:

```bash
python3 tools/coach-corpus/gen_type_definitions.py --selftest    # 步骤 0,改过 buildFindingsPrompt.ts/mistakes.ts 后必跑
$PY tools/coach-corpus/fetch_transcribe.py --kind vod|course --shard i n     # $PY = crv 的 venv python
python3 tools/coach-corpus/extract_verdicts.py --shard i n --out verdicts    --model claude-opus-5 --effort high
python3 tools/coach-corpus/extract_rules.py    --shard i n --out rules_opus  --model claude-opus-5 --effort high
python3 tools/coach-corpus/extract_rules.py    --remap-from rules_opus --out rules_opus_v3 ...   # 只重跑映射
python3 tools/coach-corpus/cluster.py --in verdicts
python3 tools/coach-corpus/aggregate.py --line vod|course ;  python3 tools/coach-corpus/compare.py --line course --a rules_opus --b rules_opus_v2
```
两段式(盲抽 → 真定义映射)是默认,v1 那种单 prompt 不再存在。固化时用新工具对现有数据重跑了全部报告,数字与本文一致(71% / 4.2% / 34-55-11 / 60→34 / 三分一致 69%)。

坑:

- `cluster.py` 我曾用 `| tail -20` 收尾,把 45 分钟的进度全缓冲住了,零可观测性——长任务别用会缓冲的管道。
- `blind_extract.py` 第一版对缺 `semantic` 字段的判决直接下标崩溃;已加 `setdefault`。
- `claude -p` 每次约 1–2 分钟,6 分片并行时偶发 7 个 worker(shell 计数含父进程),不是 bug。
- 一条 v1 判决被标成不存在的 `cd-held`(模型编的),v2 已归零;任何 LLM 映射都要对声明清单做校验。
- **`wow-frame-read` 补丁**(仓库外,`~/.claude/skills/wow-frame-read/SKILL.md`,备份 `/tmp/SKILL.md.bak`):Step 2 把 Match HUD 单独拎出并附两档位实测表;反模式新增「别从本文件读出『720p 只损失图标识别』」;出处声明补「原语料是直录,未验证重编码」。经 RED 3/3 失败 → GREEN 3/3 通过验证。通用方法论(音轨画面分取、按需抽帧、先生成后聚类、留 unmapped 出口)**不做成 skill**——三个无 skill 基线 agent 全部自行推导出来,写了只会占上下文。

## 八、已挂账到产品 BACKLOG

**未挂账。** 本 HANDOFF 未改 `docs/BACKLOG.md`。建议接手 session 在 BACKLOG #18(arenacoach 吸收 batch 2)之后新开一条「Skill Capped 教练语料 batch 3」,内容即 §五 1、1b、2、4;另开一条「`coaching-grounding-audit.md` 与代码漂移」(§四认知 2)。是否挂账由用户裁定。
