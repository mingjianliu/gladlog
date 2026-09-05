# HANDOFF 2026-09-05:Skill Capped 教练判决语料的接力点

> 独立主线,不依赖其它 HANDOFF。本文档自含:所有路径、数字、裁定都能直接落地,新 session 不需要旧对话。
> 语料、脚本、证据帧全部在 `~/code/gladlog/tmp/skillcapped-vod/`(**gitignore 内**,约 5MB;转写与教练原话只存在这里,永不进仓库)。
> **产品代码(`packages/`)一行没动。** 仓库内新增了工具与入口:`tools/coach-corpus/`(Python,npm workspace 之外)与 `docs/commands/ingest-coach-corpus.md`(runbook);仓库外补了 `~/.claude/skills/wow-frame-read/SKILL.md` 三处(见 §七)。
> 两份可视化报告(用户私有 artifact):**教练判决语料**(VoD 线第二版结论)https://claude.ai/code/artifact/12c050e4-db37-4e89-8628-9af97a07ec25 · **教练规则全录**(4015 条逐条可筛)https://claude.ai/code/artifact/3abc7a80-8b94-4f5b-9713-51d3a5269212;本地副本在 `tmp/skillcapped-vod/evidence/`。
> Monolingual Chinese, not yet in bilingual pairs; request an English version at any time.

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

**语料构成**:单排 52 / 3v3 16;12.0 有 63 条(2009 判决)、12.1 只有 **5 条**(92 判决)——12.1 那侧只能当轶事;23 个专精;教练 8 人。

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
| 无任何 gladlog 谓词描述同一事件                  | **71%**       | 62%              | 71% (1483/2101)  |
| 严格匹配(映射器判「谓词会在恰好这个事件上发射」) | —             | —                | **4.2% (88 条)** |
| 第一版 slug 映射得出的数(已作废)                 | 46%           | 45%              | 46%              |

判决极性:失误 45% / 更优解 32% / 做对了 23%。54% 带教练明确的后果归因。64% 需要读画面才能确认前提。

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
代码事实:`positionAnalysis.ts:44-51` `STAYED_IN` = 敌方爆发窗口内拉开 <5 码(`STAY_DELTA_YARDS`)且 `hpMin < 35`(`STAYED_IN_NEAR_DEATH_PCT`,`positionAnalysis.ts:78`,08-20 剂量-反应接地 n=2757 回合,commit `20153fd0`);`candidateFindings.ts:1075` `positionMistakeEvents` 只发射这一支,`MISSED_PUSH / CD_OUT_OF_RANGE` 语料 0/0。**站位过深是爆发之前的位置,柱子/视野在整个类型里没有概念。**
正确表述:不是「拆类型」,是「站位过深和视野从零开始」。

**② CC 与爆发窗口:谓词已修好,教练讲的是它的上游。**
`burst-window-setup`(127) + `cross-cc-coordination`(122) + `healer-lockdown`(76) = 325 条,最大主题。v2:`unsynced-burst` 39(11 high)、`missed-sync-window` 18(3 high)。
代码事实:`unsynced-burst` 的可行性门 `teamCcReadyAt`(`candidates/cooldownTiming.ts:386`)08-22 已落地;`missed-sync-window` 08-15 退役(GH #13)、**09-02 复活重设计**(commit `7b5e8d3f`:kill≤15s 对比 2v2 +7.7 / 3v3 +5.9 / 单排 +4.5 pp,触发率 74%→28.8%,PROMPT_VERSION 49)。
缺口:gladlog 检测的是**进入**已存在的控制窗口;教练讲的是**做出**窗口(「延迟几秒等控好了再开」「趁治疗没徽章时连控」)。3.2 里 t=309.7 那条从 v1 `missed-sync-window` 变 v2 unmapped,就是映射器在正确地收紧。这 325 条是 09-02 新谓词**从未对照过的**专家目标句。

**③ 保人:gladlog 只有「交外减」这一支。**
`peeling` 99 条跨 21 专精,69% unmapped。`external-unused`(队友死亡时有可用外减未交)是保人信号,v2 映 12 条。缺**控制保人**与**站位保人**。

**④ 徽章纪律:对退役的 `wasted-trinket` 不做任何建议。**
v1 31(19 high) → v2 17(**2 high**)。真实谓词是「中立状态下交徽章:全队 HP≥80%、治疗未被控、对方无进攻 CD」;教练讲的徽章纪律是另一个事件,v2 主要映到 `cc-locked`(26) 当上下文。第一版的「翻案」建议建立在 slug 上,**撤回**。

**⑤ `cc-locked`:不做任何主张。**
v1 4 → v2 42(4 high)。第一版「教练几乎不提 ⇒ 佐证退役」是 slug 假象、方向反了,且逻辑本身不成立(教练不评论「你被控住」是因为那不是学生的决策)。08-22 梯度 0.0。**撤回**。

**⑥ 逼出对方冷却:归因率全场最高的视角,gladlog 没有。**
`forcing-enemy-cooldowns` 70 条,**86% 带后果归因**,87% unmapped。gladlog 冷却类信号全看己方资源;「这一轮换掉了对面什么」这个记账方向不存在。日志两边施法都记了,能做。此条不依赖映射,v1→v2 不变。

**⑦ 教练与 gladlog 逐事件重合的四个类型(4.2%)。**
88 条 high 集中在 `cc-held` 19(主要来自 `go-cadence-idle-cooldowns`)、`dr-clipped-cc` 15、`kick-eaten` 13(来自 `own-cast-protection`)、`unsynced-burst` 11。这是最适合拿教练判决当 Value-Gate 目标句去校验现有输出措辞的地方。`cc-avoidable` 08-22 梯度 +2.7/+2.7/+0.7 稳定正向,v2 映 34 但 high 只 2——谓词对、事件粒度不同。

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

## 四、三个方法 bug + 三层认知问题(新 session 绝不能重新踩)

**bug 1(最贵):映射器拿的是类型名不是定义。** 第一版给映射器 29 个 slug,得 46% unmapped;只换映射阶段、喂 `buildFindingsPrompt.ts` 的真实谓词(`type_definitions.json`,4 条缺的从 `mistakes.ts` label + 审计补),得 **71%**,逐条一致率 59%。最大迁移流:`position-mistake→unmapped` 164、`cd-waste→unmapped` 85(真实定义是死亡锚定的保命 CD 未用,不是任何浪费)、`missed-sync-window→unmapped` 55、`missed-kick→unmapped` 30(真实定义是「打断空放」,教练说的「你该打断那个」是**相反**事件)。反向:`cc-locked` 4→42,`unconverted-burst` 0→18、`off-target-in-window` 0→16(第一版词表根本没这两个)。**基线 agent 当时明写了「必须从工具自己的 schema 拉定义」,被忽略了一轮。** 规则:任何按类型名做的对账都不可信,以后吸收任何外部语料同样适用。

**bug 2:抽取与映射同 prompt 的锚定偏差——实测可忽略,但要知道量。** 同 8 条视频用盲态两段式(抽取时完全不给类型清单)重跑:37.4% → 39.8%,+2.4pp,配对 t=0.18,95% CI [−9.5, +11.1]。**被 bug 1 的 +24.9pp 完全盖过。** 附带发现:逐视频 unmapped 率跑间噪声 ±10pp 量级(n≈25 时二项 SD 即 10pp),**只有语料级汇总站得住,簇级百分比一律带 ±sd 读**(页面表已逐行标)。

**bug 3:视频时间 ≠ 回合时间。** 见 3.2。任何时间锚点必须逐帧读 HUD 时钟;更稳的是锚定 HUD 状态 + 日志第 N 个 `ARENA_MATCH_START`(基线 agent 提出,比逐帧 OCR 好,未实施)。

**bug 4:用量上限会让 `claude -p` 静默全灭。** 09-05 映射重跑中途撞上限,后续 103 次调用全部 `rc=1 stdout=60B stderr=''`;我当时的错误文本只记 stdout **长度**,看不见内容,分类器保守地拒绝重放(正确)。修法已固化在 `tools/coach-corpus/common.py::claude_call`:错误文本带 stdout 前 120 字。**看到限额字样再 `/limit-reset`、原命令重放;没看错误文本前不要重放。**

**认知问题 1:教练关心 ≠ 有判别力。** 教练讲的是**可教**的事;gladlog 判别力测的是**是否预测输赢**。一件事可以被反复教、同时在该分段与胜率零相关。第一版把 325 条 CC/爆发判决当成了「gladlog 的 −4.4 测量是错的」的证据——滑步。语料只能证明「这是公认关注点」。

**认知问题 2:`coaching-grounding-audit.md` 落后于代码。** 截至 09-04 至少三行过期:`position-mistake`(仍写「等 #16 接地 85/15/35」,实际 08-20 已接地为 35 单线)、`missed-sync-window`(仍写「−4.4 反向、74%」,那是已死的旧谓词,09-02 新谓词 +4.5~+7.7pp)、`unsynced-burst`(round2 报告发现的可行性缺陷 08-22 当天已修)。另 `death-unused-defensive` 08-29 退役(GH #58)。**引用审计任何一行前先 `git log -S`。**

**认知问题 4:三分对模型不敏感,对定义敏感。** 验证课上 Opus-high 判 60% 日志能判、默认模型 34%,看似模型差 18pp;把三分边界从「日志携带该事实」写死成「gladlog 现有代码已派生该事实」后,Opus-high 也收敛到 34%。另一 session 的 A/B 结论(Opus-high 精度更高)是在**读图**任务上像素级核实的;本线是纯文本,该结论不直接迁移。**配对模型比较目前被 prompt 版本混淆**(`rules/` 用旧三分定义):要干净的单变量比较需用 v2 prompt 重跑默认模型那 9 集的映射,未做。

**认知问题 3:「slug 假象」会同时朝两个方向骗。** 它让 `position-mistake` 虚高(吞下站位一切),也让 `cc-locked` 虚低(名字不像教练用语)。所以第一版基于映射分布做的每一条推论——包括看起来「反向佐证」的——都得重来。

## 五、剩余工作(按价值排序,都还没做)

1. **VoD 线的 1483 条 unmapped 按簇三分**(35 个判断,不是 1483 个)。教程线已从规则侧做完三分(§3.4b),VoD 侧可直接复用同一套「gladlog 已派生」边界与 `tools/coach-corpus/extract_rules.py` 里的 MAP 三分段;三个最大候选:② 的「做出窗口/可行性」(setup 族,三源同向)、⑥ 的「逼出对方 CD」记账、① 的站位过深与柱子/视野。
1b. **把教程线 93 条「日志能判且无类型」分两堆**:法术级规则行(→ 现有手维表的完整性对账,按 Curated-List Completeness Rule 走 `curatedIdRegistry`)vs 真新类型(setup 族)。纯读文件,零 token。
2. **用 88 条 high 匹配当 Value-Gate 目标句**,逐条对照 gladlog 在同类事件上的实际输出措辞。这是唯一不需要新谓词就能立刻做的事;按 CLAUDE.md Value-Gate Rule,任何新信号动工前必须先手写目标结论句——这 88 条是现成的。
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
