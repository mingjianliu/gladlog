import type { MessageParams } from "../index";

// English dictionary for the `common.*` namespace. Must mirror zh/common.ts
// key-for-key (enforced by `satisfies Messages` in en/index.ts).
export const enCommon = {
  "common.save": "Save",
  "common.matchCount": "{n} matches",
  "common.matchCountPlural": (p: MessageParams) =>
    p.n === 1 ? "1 match" : `${p.n} matches`,
};
