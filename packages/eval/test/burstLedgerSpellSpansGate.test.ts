/** checkBurstLedgerSpellSpans (codex post-hoc 60-POSTHOC-03 U3): every CD
 * span of a multi-CD burst-ledger header lies inside the header's. */
import { describe, expect, it } from "vitest";

import { checkBurstLedgerSpellSpans } from "../src/quality/promptQualityCheck";

describe("checkBurstLedgerSpellSpans", () => {
  it("fails a span that starts after the header ends (a post-round press, 32-3-165)", () => {
    expect(
      checkBurstLedgerSpellSpans([
        "  Burst #7 — 2:35–2:42 | Metamorphosis (Demonic) 2:35–2:42 + Metamorphosis 2:44–2:42",
      ]),
    ).toHaveLength(2);
  });
  it("fails spans that start before or end after the header (codex 20-F15-20)", () => {
    expect(
      checkBurstLedgerSpellSpans([
        "  Burst #1 — 0:10–0:20 | Avatar 0:05–0:20 + Recklessness 0:10–0:25",
      ]),
    ).toHaveLength(2);
  });
  it("passes spans inside the header, and a single bare-named CD", () => {
    expect(
      checkBurstLedgerSpellSpans([
        "  Burst #1 — 0:11–0:41 | Dark Transformation 0:11–0:26 + Army of the Dead 0:11–0:41",
        "  Burst #2 — 1:11–1:41 | Army of the Dead",
      ]),
    ).toEqual([]);
  });
});
