import type { MessageParams } from "../index";

// English dictionary for the `dev.*` namespace. Must mirror zh/dev.ts
// key-for-key (enforced by `satisfies Messages` in en/index.ts).
export const enDev = {
  "dev.json.collapse": "Collapse {path}",
  "dev.json.expand": "Expand {path}",
  "dev.json.truncated": (p: MessageParams) =>
    `${p.preview}… (${p.n} ${Number(p.n) === 1 ? "character" : "characters"})`,
};
