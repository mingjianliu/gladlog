---
name: cross-ai-review
description: Cross-AI review of a feature diff — codex first (gpt-6.2-astra by default); when codex is out of quota, agy gemini-4-carbon-high stands in (APPROVE gate unchanged); both out means wait for the reset. Use after completing any non-trivial feature/fix before push — export diff, run the review with a focused prompt, triage findings, apply fixes. Codifies output-truncation traps and adopt/reject criteria.
---

# 跨 AI 复核工作流(code review)

用户裁决(2026-11-10 起只走 codex;2026-11-25 改):复核**先走 codex**,命令一律带 `--backend codex`(别依赖
`cross-run.mjs` 的默认值;用法和失败语义见全局 `cross-ai` skill)。**codex 额度用完时用 agy 的 `gemini-4-carbon-high`
顶替 astra**:`agy --print "<prompt>" --model gemini-4-carbon-high --new-project`(要用模型 id,显示名会被拒;cross-run
的 agy 后端不认这个 id,所以直接调 agy CLI),同一时间只跑一个 agy。agy 的 APPROVE 照样算门,提交和汇报写明审查者是
agy Carbon High;它漏得多,每条意见自己核实,安静不等于没问题。两边都没额度就排队等重置,过审之前不推;不用付费 API
做审查。每个非平凡 feature push 前跑一轮。

型号分档(用户 2026-11-22,两档都是 6.2;规则全文在 `.claude/knowledge/review-tiering.md`):动共享谓词 /
门规 / 指控或菜单候选 / parser 的(菜单 id 没变、但措辞改动增删了指控也算)、方案 / 辩论 / 根因、
拿不准的,用默认 `gpt-6.2-astra`。这些都不沾、只改 id / 措辞 / 测试夹具且 605 菜单 id 差为空的小 diff
才加 `--codex-model gpt-6.2-sol`。提交和汇报写明用的哪档。

## 跑法

```bash
git diff <base>^..HEAD > "$SCRATCHPAD/feat-diff.patch"
node ~/.claude/skills/cross-ai/scripts/cross-run.mjs review --backend codex \
  --files "$SCRATCHPAD/feat-diff.patch"[,相关 spec 文件] \
  "<聚焦 prompt>" > "$SCRATCHPAD/xai-review.out" 2>&1
```

- 真实 diff 的 astra review 要几分钟:用 `run_in_background` 跑,完事读文件。
- **先看头行 `model=` 和退出码**:按实际型号署名。exit 2 = 复核没发生(额度用完也是它),不许当通过;
  codex 额度用完就改走 agy carbon(见上);也没额度就告诉用户恢复时间,等重置后重跑。
- **输出必须重定向到文件再读**,不要 `| tail -N` —— findings 会被截断
  (同一天丢过两次第 1 条,还要再花一轮调用找回)。
- prompt 要点名怀疑面:时间单位混用、React key/重渲、谓词是否单源、
  与 spec 的偏差点。泛泛的 "review this" 出不了好结论。
- 大输入先裁剪(只给 diff + spec,别塞整个文件树)。

## 采纳/驳回标准(踩过的线)

- **采纳**:具体正确性 bug(带失败场景)、数据语义错(如 CR/MMR 混比)、
  与 spec 的硬偏差、可低成本消除的 React 卫生问题(useMemo/稳定 key)。
- **评估后可驳回**:推测性问题(如"DOM 重排会引发 hover 振荡"这类未证实的
  浏览器行为)、体量不匹配的性能担忧(N≤6 的循环)、纯风格偏好。驳回要在
  提交/汇报里写明理由,不静默忽略。
- astra 会夸大范围/计数(「均已退役」实测只有一部分):它报的数自己复算再采纳。
- 修正提交信息注明实际型号 + 采纳条数,可追溯:「codex 6.2-astra 复核,采纳 N 条」。

## 结论被截断 / 要追问时

- codex:`cross-run ask` 不能续上下文;要追问就用头行的 `conversation=codex:<id>`
  走 `debate-reply --backend codex --conversation codex:<id> "复述第 N 条 finding 的原文与失败场景"`。
  原始会话记录在 `~/.codex/sessions/<日期>/rollout-*<id>.jsonl`。
