import type { MessageParams } from "../index";

// Baseline (zh) dictionary for the `common.*` namespace. Keys are flat
// dot-strings; the zh dictionary defines the key set (`MessageKey`).
export const zhCommon = {
  "common.save": "保存",
  "common.matchCount": "{n} 场",
  "common.matchCountPlural": (p: MessageParams) => `${p.n} 场`,
  // Month-day date label (match-list day groups, batch item labels).
  "common.monthDay": "{month}月{day}日",
};
