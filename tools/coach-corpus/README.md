# coach-corpus — turning coaching video into a gladlog-aligned corpus

Python tools (stdlib + `faster_whisper` via crv's venv + `ffmpeg`, `yt-dlp`, `claude` on PATH). Deliberately
**outside the npm workspace**: not linted, typechecked or tested by `presubmit`. Data lives in the gitignored
`tmp/skillcapped-vod/` (override with `COACH_CORPUS_DATA`); transcripts contain the coaches' words and never
enter the repo — outputs are paraphrase + structure only (the arenacoach batch-1 copyright rule).

Runbook: `docs/commands/ingest-coach-corpus.md`. Findings and the traced example: `docs/HANDOFF-2026-09-05-skillcapped-coach-corpus.md`.

| step | tool | notes |
|---|---|---|
| 0 | `gen_type_definitions.py [--selftest]` | **run first, and after any change to `buildFindingsPrompt.ts` / `mistakes.ts`** — the mapper must see real predicates, never slugs (46%→71% unmapped when this was wrong) |
| 1 | `fetch_catalog.py <course_dump_url>` | public JSON; URL timestamp changes — read it off the site's network tab |
| 2 | `fetch_transcribe.py --kind vod\|course` | crv venv python; 3 shards ≈ 0.35× realtime; audio deleted after |
| 3 | `extract_verdicts.py` / `extract_rules.py` | two-stage (blind → real-definition map); `--remap-from` reruns stage 2 only; `--model/--effort` pass through to `claude -p` |
| 4 | `cluster.py` | VoD only; free labels → 20–35 clusters |
| 5 | `aggregate.py --line vod\|course` · `compare.py` | reports; cluster % carry ±10pp noise |

Interpreter for step 2: `~/.local/pipx/venvs/claude-real-video/bin/python`. Everything else runs on `python3`.

`translations_zh/` (written by `translate_zh.py`, read only by `build_listing.py`) is a display-only Chinese sidecar for the listing page. **The corpus itself stays English** — that is what an agent should read.
