---
name: agy-review
description: Cross-AI review of a feature diff with agy/Gemini. Use after completing any non-trivial feature/fix before push — export diff, run agy review with a focused prompt, triage findings, apply fixes. Codifies output-truncation traps and adopt/reject criteria.
---

# agy 复核工作流(跨 AI code review)

用户 standing 偏好:尽量多用 agy 做实现/复核(例外:eval 批量 responder/judge
固定 sonnet)。每个非平凡 feature push 前跑一轮。

## 跑法

```bash
git diff <base>^..HEAD > "$SCRATCHPAD/feat-diff.patch"
node ~/.claude/skills/agy/scripts/agy-run.mjs review --model flash \
  --files "$SCRATCHPAD/feat-diff.patch"[,相关 spec 文件] \
  "<聚焦 prompt>" > "$SCRATCHPAD/agy-review.out" 2>&1
```

- **输出必须重定向到文件再读**,不要 `| tail -N` —— findings 会被截断
  (同一天丢过两次第 1 条,还要再花一轮调用找回)。
- prompt 要点名怀疑面:时间单位混用、React key/重渲、谓词是否单源、
  与 spec 的偏差点。泛泛的 "review this" 出不了好结论。
- 大输入 exit 2 → 先裁剪(只给 diff + spec,别塞整个文件树)。
- exec 模式(让 agy 实现)易超时:任务书写明「每完成一项立刻 commit」,
  超时后查 `git log`/`git status` 接续,别重头再来。

## 采纳/驳回标准(踩过的线)

- **采纳**:具体正确性 bug(带失败场景)、数据语义错(如 CR/MMR 混比)、
  与 spec 的硬偏差、可低成本消除的 React 卫生问题(useMemo/稳定 key)。
- **评估后可驳回**:推测性问题(如"DOM 重排会引发 hover 振荡"这类未证实的
  浏览器行为)、体量不匹配的性能担忧(N≤6 的循环)、纯风格偏好。驳回要在
  提交/汇报里写明理由,不静默忽略。
- 修正提交信息注明「agy flash 复核」+ 采纳条数,可追溯。

## 结论被截断时

再发一次 `verify` role 让它复述指定 finding(它能读自己的 transcript);
或直接读 `~/.gemini/antigravity-cli/brain/<conversation>/…/transcript.jsonl`。
