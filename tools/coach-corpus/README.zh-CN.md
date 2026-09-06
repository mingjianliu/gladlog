# coach-corpus — 把教练视频变成能和 gladlog 对账的语料

Python 工具（标准库 + crv venv 里的 `faster_whisper` + PATH 上的 `ffmpeg` / `yt-dlp` / `claude`）。**刻意放在 npm workspace 之外**：`presubmit` 不 lint、不 typecheck、不测它。数据在 gitignore 的 `tmp/skillcapped-vod/`（可用 `COACH_CORPUS_DATA` 覆盖）；转写含教练原话，永不进仓库 —— 产出只有转述与结构（沿用 arenacoach batch-1 的版权约定）。

Runbook：`docs/commands/ingest-coach-corpus.md`。结论与逐环追踪示例：`docs/HANDOFF-2026-09-05-skillcapped-coach-corpus.md`。

| 步骤 | 工具 | 说明 |
|---|---|---|
| 0 | `gen_type_definitions.py [--selftest]` | **先跑，且每次改过 `buildFindingsPrompt.ts` / `mistakes.ts` 后必跑** —— 映射器只能看真实谓词，不能看类型名（这一步做错时无对应率从 46% 变 71%） |
| 1 | `fetch_catalog.py <course_dump_url>` | 公开 JSON；URL 带时间戳会变 —— 从站点 network 面板里抄 |
| 2 | `fetch_transcribe.py --kind vod\|course` | 用 crv 的 venv python；3 分片约 0.35× 实时；音频转完即删 |
| 3 | `extract_verdicts.py` / `extract_rules.py` | 两段式（盲抽 → 真定义映射）；`--remap-from` 只重跑映射；`--model/--effort` 透传给 `claude -p` |
| 4 | `cluster.py` | 仅 VoD；自由标签 → 20–35 个簇 |
| 5 | `aggregate.py --line vod\|course` · `compare.py` | 报告；簇级百分比带 ±10pp 噪声 |

步骤 2 的解释器：`~/.local/pipx/venvs/claude-real-video/bin/python`。其余都用 `python3`。
