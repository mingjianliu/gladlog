# @gladlog/corpus-tools

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

`NODE_OPTIONS=--max-old-space-size=4096`:单场 Solo Shuffle 日志可达 ~30MB(6 轮整局),逐场解析后丢弃,但需抬高堆上限避免 OOM。

**输出**:各 bracket stub 数、总 cell 数、体积;`validateCorpus` 0 违规;写出 `data/reference_vectors.json`。验证失败(1.5 哨兵未清零 / 非 ASCII 技能名 / N_floor 标记不一致 / 版本戳缺失)则**在写文件前** `exit 1`,不产半成品。

## 配额与 N_floor(产线 vs 冒烟)

archetype 维度只有当每个 archetype-cell 都能凑够 `N_floor=30` 才有价值。经验值 `PER_BRACKET ≥ 30 × 主流archetype数`(约 100–150+/bracket 起,产线建议 1200)。

- **冒烟/管线验证**:`PER_BRACKET=50` 足以端到端跑通、产出**真实但稀疏**的语料(多数 cell 因 N<30 标 `insufficient`——这是正确行为,非缺陷)。用于证明管线在真实 feed 数据上成立。
- **产线重建**:`PER_BRACKET=1200`(默认)。下载量大(SS ~30MB/场 × 1200 × 3 bracket = 数十 GB,数小时),是维护者侧的独立长任务,建议单独机器跑,勿在交互会话内跑到底。

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

## 合规

- **数据源**:wowarenalogs.com feed = 用户**自有旧产品**的公共 API,数据主权在用户;仅构建期、维护者侧、离线调用。
- 提取旧 fork 逻辑只由控制器对着子项目 0 审计(全 CLEAN 文件)做;子代理/agy 不读旧 fork。
