# ingest-coach-corpus — 把教练视频变成可与候选类型对账的语料

把一个教练站点（现为 Skill Capped）的 VoD 复盘与教程课程转成结构化语料：每条判决/规则都映射到 gladlog 候选类型的**真实谓词**（或标为无对应），教程规则还判「违反它日志今天能不能判」。工具在 `tools/coach-corpus/`（Python，不在 npm workspace 内），数据在 gitignore 的 `tmp/skillcapped-vod/`。背景、结论与逐环追踪示例见 `docs/HANDOFF-2026-09-05-skillcapped-coach-corpus.md`。

**先读三条约定**
- **不搬凭据。** 只有 master playlist 要 JWT；`/api/video/<uuid>/<bitrate>.m3u8` 与分片不设防。永远不要把浏览器里的 token 搬出来 —— 不需要，且会被安全分类器/Chrome PNA 拦。
- **原话不进仓库。** 转写留在 `tmp/`；进仓库的只有转述与结构（arenacoach batch-1 的版权约定）。
- **映射器只吃真实谓词，不吃类型名。** 步骤 0 不是可选项：2026-09-05 用 slug 映射得 46% 无对应，换真定义得 71%。

## Steps

### 0. 重生成类型定义（每次改过 `buildFindingsPrompt.ts` / `mistakes.ts` 后必做）

```bash
python3 tools/coach-corpus/gen_type_definitions.py            # 写 tools/coach-corpus/type_definitions.json，记录源文件 git 版本
python3 tools/coach-corpus/gen_type_definitions.py --selftest # 花名册每个类型都有定义；mistakes.ts 声明的类型都在花名册
```
自检失败有两种：缺定义 → 该类型没有 prompt 定义，去发射代码读谓词，加进 `gen_type_definitions.py` 的 `HAND` 块并写 `file:function` 出处；`declared-but-not-in-roster` → gladlog 新增/改名了类型，更新 `common.py` 的 `ACTIVE`/`RETIRED`。**四条手写定义（cd-waste / missed-kick / missed-purge-kill-window / questionable-external）是唯一会静默腐烂的部分** —— 它们的源码变了自检不会红，要人工对。

### 1. 拉目录

站点从 CloudFront 拉一份公开 JSON，URL 带时间戳。浏览器打开 `skill-capped.com/wow/browse/video`，network 里搜 `course_dump`，复制完整 URL：
```bash
python3 tools/coach-corpus/fetch_catalog.py "https://d20k8dfo6rtj2t.cloudfront.net/courses_v2/wow/course_dump_<ts>.json"
```

### 2. 转写（零 token，本机 whisper；用 crv 的 venv）

```bash
PY=~/.local/pipx/venvs/claude-real-video/bin/python
# VoD 复盘：默认只取 patch 12.x；3 分片并行 ≈ 0.35× 实时
for i in 0 1 2; do nohup $PY tools/coach-corpus/fetch_transcribe.py --kind vod --shard $i 3 > /tmp/tr$i.log 2>&1 & done
# 教程：范围由 tmp/skillcapped-vod/courses_tier1.json 决定（16 门 Must Watch/通用课 + ROAD TO GLADIATOR 非 POV 集）
for i in 0 1 2; do nohup $PY tools/coach-corpus/fetch_transcribe.py --kind course --shard $i 3 > /tmp/tc$i.log 2>&1 & done
```
已转写的 uuid 自动跳过，可随时中断续跑。完成判据：`ls tmp/skillcapped-vod/transcripts_courses | wc -l` 等于目标数减去跨课共用的视频（现为 155 条目 / 154 唯一）。

### 3. 抽取 + 映射（这一步花 token）

```bash
# 先跑 1 门课验证 schema，再放全量（Value-Gate）
python3 tools/coach-corpus/extract_rules.py --course "MELEE DPS SOLO SHUFFLE COURSE" --out rules_check
# 全量，6 分片；--model/--effort 透传给 claude -p（2026-09-05 用户裁定 claude-opus-5 high）
for i in 0 1 2 3 4 5; do nohup python3 tools/coach-corpus/extract_rules.py --shard $i 6 --out rules_opus --model claude-opus-5 --effort high > /tmp/er$i.log 2>&1 & done
for i in 0 1 2 3 4 5; do nohup python3 tools/coach-corpus/extract_verdicts.py --shard $i 6 --out verdicts --model claude-opus-5 --effort high > /tmp/ev$i.log 2>&1 & done
```
两个抽取器都是**两段式**：盲抽（不给类型清单）→ 用真定义映射。只想重跑映射（改了定义或三分边界后）用 `--remap-from <dir> --out <newdir>`，旧字段保留为 `*_v1`。

撞到用量上限时所有调用会以 `rc=1 stdout(60B)=...` 失败并**打印 stdout 内容** —— 看到限额字样就等 `/limit-reset`，然后原命令重放（缓存跳过已完成的）。**不要**在没看错误文本前重放：如果是 prompt 问题，会白烧一整轮。

### 4. 聚类（仅 VoD）

```bash
python3 tools/coach-corpus/cluster.py --in verdicts     # 约 45 分钟；输出 tmp/skillcapped-vod/taxonomy.json
```
不要 `| tail` 收尾 —— 会把进度全缓冲住。

### 5. 报告

```bash
python3 tools/coach-corpus/aggregate.py --line vod    [--patch 12.0]          # 簇覆盖、映射、needs_frame；小样本自动打横幅
python3 tools/coach-corpus/aggregate.py --line course                          # 三分（仅 decision）、日志能判且无类型、手写类型命中
python3 tools/coach-corpus/compare.py  --line course --a rules_opus --b rules_opus_v2   # 同批规则的映射/三分迁移流
```
读数规矩：语料级合计站得住；**簇级百分比带 ±10pp 跑间噪声**（n≈25 时二项 SD 即 10pp）。`compare.py` 比的是形状不是准确度 —— 没有规则级 ground truth；两臂 prompt 版本不同时比较被混淆，写结论要注明。

## 已知坑（都踩过）

- **视频时间 ≠ 回合时间。** 教练会暂停，105 秒视频只走了 54 秒回合。读画面时逐帧读 HUD 时钟；更稳的是锚定 HUD 状态 + 日志第 N 个 `ARENA_MATCH_START`。
- **HUD 要 1080p。** 720p 下 `Round / Time Remaining` 放大 7 倍仍不可读；敌方框架 720p 可读。单帧 `ffmpeg -ss <t> -i .../4500.m3u8 -frames:v 1` 只要 1.5 秒，不需要整片高码率。
- **三分分母只算 `kind=decision`。** 「震荡波晕 2 秒」这类事实日志能核但不可违反，混进去会虚高「日志能判」。
- **三分边界是「gladlog 已派生」不是「日志里有」。** 松定义下 Opus 判 60% 日志能判、默认模型 34%；收紧后两者收敛到 34%。那 18pp 是定义敏感，不是模型敏感。
- **教练关心 ≠ 有判别力。** 语料证明的是「这是公认关注点」，不能反驳 gladlog 的胜负判别力测量。
- **`coaching-grounding-audit.md` 会落后于代码。** 引用任何一行前先 `git log -S`。
