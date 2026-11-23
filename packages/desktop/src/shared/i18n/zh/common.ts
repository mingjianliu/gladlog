import type { MessageParams } from "../index";

// Baseline (zh) dictionary for the `common.*` namespace. Keys are flat
// dot-strings; the zh dictionary defines the key set (`MessageKey`).
export const zhCommon = {
  "common.save": "保存",
  "common.matchCount": "{n} 场",
  "common.matchCountPlural": (p: MessageParams) => `${p.n} 场`,
};
