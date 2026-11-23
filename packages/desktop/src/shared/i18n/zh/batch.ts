// Baseline (zh) dictionary for the `batch.*` namespace: the batch AI
// analysis bar at the top of the match list.
export const zhBatch = {
  "batch.title": "批量 AI 分析",
  "batch.titleHint":
    "默认从最新往旧取 N 场;在下方列表勾选后改为只分析勾选的对局(shuffle 一勾整场 6 盘)。最多三路并行,输出与手动逐场分析一致(含深挖)。",
  "batch.empty.selected": "勾选的对局都已分析",
  "batch.empty.recent": "没有未分析的对局",
  "batch.running": "批量分析中 {done}/{total}",
  "batch.cancel": "取消",
  "batch.cancelledPrefix": "已取消:",
  "batch.finishedPrefix": "批量完成:",
  "batch.summary": "成功 {ok} · 跳过 {skipped} · 失败 {failed}",
  "batch.dismissAria": "关闭小结",
  "batch.selected": "已勾选 {n} 场",
  "batch.clearSelection": "清除勾选",
  // Around the number input: "最近 [N] 场".
  "batch.recentBefore": "最近",
  "batch.recentAfter": "场",
  "batch.skip": "跳过已分析",
  "batch.skipHint":
    "勾选(默认):已有分析缓存的对局跳过,不重复花钱。取消勾选:重新分析并覆盖旧结果(与单场面板的「重新分析」一致);正在分析中的对局任何模式下都不会重复跑。",
  "batch.startSelected": "分析勾选的 {n} 场",
  "batch.start": "开始",
};
