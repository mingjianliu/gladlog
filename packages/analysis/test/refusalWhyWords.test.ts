/**
 * `refusalWhy` words the common client refusals (work order 2026-10-14b
 * fix 3): "client reason not translated" stood for 没有目标 / 无效的目标 /
 * 你还不能那么做 / 精华不足 / "Target needs to be in front of you." / "Another
 * action is in progress" on 4 of the 43 kick-eaten rows of the PV382
 * re-eval. The texts are the client's, read off the corpus.
 */
import { describe, expect, it } from "vitest";

import { NOT_READY_REASONS } from "../src/analysis/candidates/shared";
import {
  OTHER_REFUSAL_REASONS,
  REFUSAL_WHY_WORDS,
  refusalWhy,
  REJECT_REASONS,
  REJECT_WHY_UNWORDED,
} from "../src/context/spellOutcomeLines";

describe("refusalWhy — the common client refusals", () => {
  it("the re-eval's six texts are worded", () => {
    expect(refusalWhy("没有目标")).toBe("no target");
    expect(refusalWhy("无效的目标")).toBe("invalid target");
    expect(refusalWhy("你还不能那么做")).toBe("can't do that yet");
    expect(refusalWhy("精华不足")).toBe("not enough essence");
    expect(refusalWhy("Target needs to be in front of you.")).toBe(
      "target not in front",
    );
    expect(refusalWhy("Another action is in progress")).toBe(
      "another action in progress",
    );
  });
  it("a text none of the tables has stays unworded", () => {
    expect(refusalWhy("Must be in Stealth")).toBe(REJECT_WHY_UNWORDED);
  });
  it("every word is one the gate accepts", () => {
    for (const why of Object.keys(OTHER_REFUSAL_REASONS))
      expect(REFUSAL_WHY_WORDS).toContain(why);
  });
  it("no text is in two tables: the not-ready family and the [REJECTED] kinds keep theirs", () => {
    const rejectTexts = new Set(Object.values(REJECT_REASONS).flat());
    for (const texts of Object.values(OTHER_REFUSAL_REASONS))
      for (const t of texts) {
        expect(NOT_READY_REASONS.has(t)).toBe(false);
        expect(rejectTexts.has(t)).toBe(false);
      }
    const all = Object.values(OTHER_REFUSAL_REASONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
