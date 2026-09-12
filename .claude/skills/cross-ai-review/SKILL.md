---
name: cross-ai-review
description: Cross-AI review of a feature diff — codex gpt-6-astra first, agy only when codex is out of quota. Use after completing any non-trivial feature/fix before push — export diff, run the review with a focused prompt, triage findings, apply fixes. Codifies output-truncation traps and adopt/reject criteria.
---

# 跨 AI 复核工作流(code review)

用户 standing 偏好(2026-09-12 起):复核**先走 codex `gpt-6-astra`,只有 codex 额度不够才
fallback 到 agy**。路由由 `cross-run.mjs` 自己做(用法、回退语义、两边各自的失败模式见全局
`cross-ai` skill)。每个非平凡 feature push 前跑一轮。

## 跑法

```bash
git diff <base>^..HEAD > "$SCRATCHPAD/feat-diff.patch"
node ~/.claude/skills/cross-ai/scripts/cross-run.mjs review \
  --files "$SCRATCHPAD/feat-diff.patch"[,相关 spec 文件] \
  "<聚焦 prompt>" > "$SCRATCHPAD/xai-review.out" 2>&1
```

- 真实 diff 的 astra review 要几分钟:用 `run_in_background` 跑,完事读文件。
- **先看头行 `backend=`**:`codex` 还是 `agy`(前面会有一行 `codex quota exhausted … fell
back to agy`)。结论要按实际后端采信和署名。exit 2 = 复核没发生,不许当通过。
- **输出必须重定向到文件再读**,不要 `| tail -N` —— findings 会被截断
  (agy 时代同一天丢过两次第 1 条,还要再花一轮调用找回)。
- prompt 要点名怀疑面:时间单位混用、React key/重渲、谓词是否单源、
  与 spec 的偏差点。泛泛的 "review this" 出不了好结论。
- 大输入先裁剪(只给 diff + spec,别塞整个文件树)。
- 让别的 AI **实现**(不是复核)仍走 `agy-run.mjs exec`,易超时:任务书写明「每完成一项
  立刻 commit」,超时后查 `git log`/`git status` 接续,别重头再来。

## 采纳/驳回标准(踩过的线)

- **采纳**:具体正确性 bug(带失败场景)、数据语义错(如 CR/MMR 混比)、
  与 spec 的硬偏差、可低成本消除的 React 卫生问题(useMemo/稳定 key)。
- **评估后可驳回**:推测性问题(如"DOM 重排会引发 hover 振荡"这类未证实的
  浏览器行为)、体量不匹配的性能担忧(N≤6 的循环)、纯风格偏好。驳回要在
  提交/汇报里写明理由,不静默忽略。
- astra 会夸大范围/计数(「均已退役」实测只有一部分):它报的数自己复算再采纳。
- 修正提交信息注明实际后端 + 采纳条数,可追溯:「codex astra 复核,采纳 N 条」或
  「agy flash 复核(codex 额度耗尽),采纳 N 条」。

## 结论被截断 / 要追问时

- codex:`cross-run ask` 不能续上下文;要追问就用头行的 `conversation=codex:<id>`
  走 `debate-reply --conversation codex:<id> "复述第 N 条 finding 的原文与失败场景"`。
  原始会话记录在 `~/.codex/sessions/<日期>/rollout-*<id>.jsonl`。
- agy(fallback 时):`debate-reply --conversation agy:<id>` 同理,或直接读
  `~/.gemini/antigravity-cli/brain/<conversation>/…/transcript.jsonl`。
