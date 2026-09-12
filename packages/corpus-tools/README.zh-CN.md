# @gladlog/corpus-tools

[English](README.md) · **中文**

**离线维护者工具**,不进桌面 App 发布包。用 gladlog 自己的 parser + analysis metrics,从 wowarenalogs.com 公共 feed 重算全部群体基线,产出版本戳、去-embedding 的静态 `data/reference_vectors.json`,供 SP-B2 的 compare 引擎消费。

> 设计依据:`docs/specs/2026-07-11-pro-comparison-cohort-design.md`
> 发布层零外部依赖——桌面 App 运行时只吃打包/CDN 上的这份静态语料。

## 管线

```
feed(wowarenalogs.com GraphQL, MIN_RATING=2300, 分 bracket)
  → downloadLogText(每场日志文本)
  → GladLogParser(gladlog 自己的 parser,经 parser-compat)
  → computeHealerMetrics + extractRotations/crisisEvents(gladlog analysis)
  → 按 cell 聚合(spec × bracket × enemyCompArchetype + 层级回退)
  → validateCorpus(硬门)
  → 写 data/reference_vectors.json(版本戳,去 embedding)
```

Cell = `spec × bracket × archetype`;该 cell 样本 < N_floor(30)→ 回退到 `spec × bracket`(archetype `"*"`)父 cell;父 cell 仍 < 30 → 标 `insufficient: true`。SP-B2 消费时对 insufficient 组合显示"样本不足、暂不对比",绝不出假百分位。

## 构建语料

```bash
cd packages/corpus-tools
WOW_PATCH=<当前 retail build> MIN_RATING=2300 PER_BRACKET=<每 bracket 采样数> \
  NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx scripts/buildCorpus.ts
```

**环境变量**

| 变量          | 默认      | 说明                                                                                                                                                       |
| ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WOW_PATCH`   | `unknown` | 当前 retail build 版本戳。取自 `packages/analysis/src/data/datagen-manifest.json` 的 `build` 字段(游戏数据管线已拉的当前版本)。让 SP-B2 能判语料是否过期。 |
| `MIN_RATING`  | `2300`    | feed 服务端评分下限(群体 = 高分段)。                                                                                                                       |
| `PER_BRACKET` | `1200`    | 每 bracket 采样场数。见下方"配额与 N_floor"。                                                                                                              |
| `ARCHIVE_LEDGER` | _(未设)_ | 归档账本 `*.jsonl` 所在目录。与 `ARCHIVE_ROOT` 一起设置即改为从我们自己的归档建库,不走 feed —— 见下方"feed 已死"。                                          |
| `ARCHIVE_ROOT`   | _(未设)_ | 存放 `<matchId>.txt.gz` 的目录(按日期分层)。仅在同时设了 `ARCHIVE_LEDGER` 时生效。                                                                          |

`NODE_OPTIONS=--max-old-space-size=4096`:单场 Solo Shuffle 日志可达 ~30MB(6 轮整局),逐场解析后丢弃,但需抬高堆上限避免 OOM。

**输出**:各 bracket stub 数、总 cell 数、体积;`validateCorpus` 0 违规;写出 `data/reference_vectors.json`。验证失败(1.5 哨兵未清零 / 非 ASCII 技能名 / N_floor 标记不一致 / 版本戳缺失)则**在写文件前** `exit 1`,不产半成品。

## feed 已死 —— 改从归档重建(2026-09-11)

上游 2026-09-08 关停 match search:`latestMatches` 对所有查询在 HTTP 200 里回一个
GraphQL `SEARCH_DISABLED` 错误,当天的裁定是停止再问(`docs/DATA-COMPLIANCE.md`)。
所以上面那条 feed 路径已经重建不了任何东西,而且**是静默失败** —— 零 stub、不报错。

剩下的来源是我们自己的归档。把 builder 指过去:

```bash
ARCHIVE_LEDGER=$GLADLOG_EVAL_HOME/archive/ledger \
ARCHIVE_ROOT=$GLADLOG_EVAL_HOME/corpus/archive-gz \
WOW_PATCH=<build> MIN_RATING=2300 PER_BRACKET=1200 OUT=/tmp/rv.json \
  npx tsx scripts/buildCorpus.ts
```

账本里每场都带 `bracket` 与 `playerTeamRating`,正是 feed 当初在服务端做的那层过滤,
所以群体定义的形状不变。

**归档做不到的事**:按生产语料自己的门槛复现它。2026-09-11 实测 63,309 场归档 ——
`MIN_RATING=2300` 只有单排 **518** / 3v3 **50** / 2v2 **550**,而 50 场 3v3 会让每个
3v3 cell 都掉到 `N_floor` 以下。按那个门槛真建了一份,结果在每个维度上都劣于线上
(可用 cell 285 → 207、可用 3v3 cell 17 → 1、治疗 cell 104 → 67),而且戒律照样拆不出
英雄树。

**门槛自 2026-09-11 起为 2100(用户裁定)。**归档在这个门槛有 1,624 / 620 / 2,378 场,
这是 3v3 能存在、以及英雄树拆分能够到 `N_floor` 的原因。

这**不是**"拿代表性换覆盖" —— 这里最初就是那么写的,被用户纠正了:本赛季 R1 也就
**2400** 封顶,2300 往上基本排不到队。所以 2100+ **就是**这条天梯的顶端,而原来的
2300 门槛采的是一条几乎空的尾巴 —— 归档的数字正是这个意思(63,309 场里 2300+ 只有
单排 518 / 3v3 50 / 2v2 550)。**这串数要读成天梯的事实,不是我们采集的缺陷。**

UI 与 prompt 里没有任何地方写着这个门槛,它只是语料上的出处元数据(`sourceFloor`)。
等天梯本身的顶端移动了,再回来重估这个门槛。

### 机器装不下整跑时怎么建

`buildCorpus` 会把整跑的每场记录都攒在内存里再聚合,2100 档三赛制整跑在本机被系统
杀过两次(单排日志 ~30MB/场)。cell 不跨赛制,所以一个赛制一个进程建、最后合并:

```bash
for b in "3v3" "2v2" "Rated Solo Shuffle"; do
  BRACKETS="$b" OUT=/tmp/rv_"${b// /_}".json \
  ARCHIVE_LEDGER=$GLADLOG_EVAL_HOME/archive/ledger \
  ARCHIVE_ROOT=$GLADLOG_EVAL_HOME/corpus/archive-gz \
  WOW_PATCH=<build> MIN_RATING=2100 PER_BRACKET=1200 \
  NODE_OPTIONS=--max-old-space-size=4096 \
    npx tsx scripts/buildCorpus.ts
done
npx tsx scripts/mergeCorpora.ts --out data/reference_vectors.json /tmp/rv_*.json
```

`mergeCorpora` 会拒绝 build 或评分门槛不一致的输入,也拒绝赛制重叠的输入 ——
这正是合并能静默污染出处的两种方式。

## 配额与 N_floor(产线 vs 冒烟)

archetype 维度只有当每个 archetype-cell 都能凑够 `N_floor=30` 才有价值。经验值 `PER_BRACKET ≥ 30 × 主流archetype数`(约 100–150+/bracket 起,产线建议 1200)。

- **冒烟/管线验证**:`PER_BRACKET=50` 足以端到端跑通、产出**真实但稀疏**的语料(多数 cell 因 N<30 标 `insufficient`——这是正确行为,非缺陷)。用于证明管线在真实 feed 数据上成立。
- **产线重建**:`PER_BRACKET=1200`(默认)。下载量大(SS ~30MB/场 × 1200 × 3 bracket = 数十 GB,数小时),是维护者侧的独立长任务,建议单独机器跑,勿在交互会话内跑到底。

## 按专精/分数下载他人 log(fetch-pvp-logs)

```bash
SPEC=Shaman_Restoration MIN_RATING=2100 LIMIT=20 npx tsx scripts/fetchPvpLogs.ts
```

从同一 feed 按 bracket/评分档(服务端)+ 专精(compQueryString 服务端预筛 +
recorder/any 客户端细筛)批量下载原始 log 到 `$GLADLOG_EVAL_HOME/downloads/`,
带 manifest(评分/MMR/全员 spec/GCS 时区 meta)与断点续传。参数、评分档位语义、
7 天保留期等坑见 `.claude/skills/fetch-pvp-logs`。

## 冒烟门(go/no-go)

跑产线前先冒烟测 feed 可用性:

```bash
npx tsx scripts/smokeFeed.ts
```

确认三个 bracket 都能按 minRating 返日志、日志可下载可解析。失败即切回退源(用户自采日志语料)或停工报告,勿建到一半才发现 feed 波动。

## 测试

```bash
npx vitest run   # cellAggregator / validateCorpus / feedClient / perMatchRecord
```

`combatToRecords` 用合成 combat(纯函数)测,不依赖真实日志 fixture(隐私/体积);`buildPerMatchRecords` 是 parse 包装。

## Build-aware 分组(SP-B1.5)

对**天赋 build 会实质改变被对比指标**的治疗专精,cell 再按一个确定性的 keystone-天赋布尔门分成 buildGroup(如 Discipline Priest 的 `offensive`/`standard`),让"你的打法 vs 群体"在同一 build 家族内比较;对 build 不影响指标的专精(Mistweaver、Preservation Evoker)保持 archetype-only,不碎样本。

**门表**:`data/keystoneGates.json`(版本戳、人工复核)。schema:`{ wowPatchVersion, gates: [{ spec, keystoneNodeIds, match: "any"|"all", metric, groupPresent, groupAbsent }] }`。当前已激活:Discipline Priest → Voidweaver 包 `[82585,110277,82583]`(any)→ `offensive`/`standard`。

**发现流程(维护者,补丁后重跑)**:

```
STUDY_LOGS=600 STUDY_OUT=<rows.json> npx tsx scripts/collectBuildStudy.ts   # 采逐轮 {spec,archetype,talents,metrics}
STUDY_ROWS=<rows.json> npx tsx scripts/discoverKeystones.ts                  # 按 metric 分离度排候选 keystone
# 人工复核候选 → 手编 data/keystoneGates.json(工具从不自动写)
```

**cell 分裂 + N_floor 守卫**:门控专精发 `archetype×buildGroup`、`*×buildGroup`、`archetype×*`、`*×*` 四种 cell,回退偏好保 build 但保留 archetype 基线(`archetype×buildGroup` → `*×buildGroup` → `archetype×*` → `*×*`)。门**逐 bracket** 激活:某 buildGroup 的 build 父(`*×buildGroup`)cell < N_floor=30 则该 (spec,bracket) 回落 archetype-only(记录变 `buildGroup="*"`)。语料顶层 `buildGroups` 声明已激活门(spec 在任一 bracket 分裂即列入),供运行时(SP-B2)判组;`archetype×*` 的存在保证未分裂 bracket 仍有 archetype 基线可回退。

**offensiveIndex winsorization**:聚合前按池 p99 截尾(伤害/治疗在某轮治疗≈0 时会爆炸)。仅保护达标 cell;极小的 insufficient cell(如 n=4)p99≈max,截尾无效但该 cell 不被消费。

**运行时(SP-B2,本包不实现)**:读 `corpus.buildGroups` 对用户 build 做 O(1) 布尔判组;**fail-open** —— 门表版本与游戏 build 不符、或 keystone 节点已失效时,静默回落 `buildGroup="*"`。

## 合规

- **数据源**:wowarenalogs.com feed = **第三方志愿者项目**的公共 API(本仓只 fork 过其代码,数据并非自有——2026-07-29 更正,此前误记"自有产品");数据为玩家自愿公开上传。仅构建期、维护者侧、离线调用,频率克制。
- 提取旧 fork 逻辑只由控制器对着子项目 0 审计(全 CLEAN 文件)做;子代理/agy 不读旧 fork。

## PvP log 长期归档(archivePvpLogs)

每 6 小时扫一次 feed,把新出现的公开对局以原始 gzip 字节下载并归档到 Google Drive。
用法、环境变量、运维注意见 [PvP log 归档](../../docs/pvp-log-archive.zh-CN.md);设计见
`docs/superpowers/specs/2026-08-01-pvp-log-archive-design.md`,合规见
[`docs/DATA-COMPLIANCE.zh-CN.md`](../../docs/DATA-COMPLIANCE.zh-CN.md)。
