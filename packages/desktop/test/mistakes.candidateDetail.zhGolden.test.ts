// zh output of the mistakes card's sentence frames is pinned byte for byte:
// the golden was written from the zh output before the components were
// migrated (Task 6b), so any wording drift in `candidateDetail` /
// `syncReadyCdsText` under zh shows up here. Every rule × every branch
// variant of the shared matrix (test/support/mistakeDetailMatrix.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  candidateDetail,
  MISTAKE_RULES,
  syncReadyCdsText,
} from "../src/renderer/src/report/derive/mistakes";
import { FACTS, VARIANTS } from "./support/mistakeDetailMatrix";

const GOLDEN = join(
  __dirname,
  "fixtures/mistakes.candidateDetail.zh.golden.json",
);

/** `<rule type>#<variant index>` → zh detail, for the whole matrix. */
function zhMatrix(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of MISTAKE_RULES) {
    VARIANTS.forEach((v, i) => {
      out[`${r.type}#${i}`] = candidateDetail(
        { type: r.type, facts: { ...FACTS, ...v } },
        "zh",
      );
    });
  }
  out["syncReadyCdsText#3"] = syncReadyCdsText(VARIANTS[3]!.readyCds, "zh");
  return out;
}

describe("失误卡句子 zh 金样:逐字节不变", () => {
  it("每条规则 × 每个分支的 zh 输出与金样一致", () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<
      string,
      string
    >;
    expect(Object.keys(golden).length).toBeGreaterThan(60);
    expect(zhMatrix()).toEqual(golden);
  });

  it("默认语言(不传 lang)也是 zh", () => {
    for (const r of MISTAKE_RULES) {
      const c = { type: r.type, facts: { ...FACTS, ...VARIANTS[1] } };
      expect(candidateDetail(c)).toBe(candidateDetail(c, "zh"));
    }
  });
});
