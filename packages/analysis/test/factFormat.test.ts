import { describe, expect, it } from "vitest";

import { FACTS_BLOCK_SEP, serializeFactsBlock } from "../src/analysis/factFormat";

describe("serializeFactsBlock — the one facts→text serializer (2026-09-16)", () => {
  it("a ', ' inside a value never survives as a split point", () => {
    const out = serializeFactsBlock({
      t: 12.5,
      readyCds: "Invoke Chi-Ji, the Red Crane",
      postKick: "acted on another school 2.4s later (Fade; instant or channel)",
    });
    expect(out.split(FACTS_BLOCK_SEP)).toHaveLength(3);
    expect(out).toContain("Invoke Chi-Ji,\u00a0the Red Crane");
    expect(out.startsWith("t=12.5, readyCds=")).toBe(true);
  });
  it("values without a comma are rendered verbatim", () => {
    expect(serializeFactsBlock({ a: 1, b: "x y" })).toBe("a=1, b=x y");
  });
});
