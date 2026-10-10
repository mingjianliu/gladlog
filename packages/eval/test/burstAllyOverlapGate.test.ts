import { describe, expect, it } from "vitest";

import { checkBurstAllyOverlap } from "../src/quality/promptQualityCheck";

/**
 * T12 ⑦ (user ruling 2026-10-10): "Aligned with" meant only that a teammate's
 * offensive cooldown overlapped the burst in time. The line now prints the
 * overlap's length and that teammate's top target in it.
 */

const head =
  "  Burst #1 — 0:13–0:31 | Pillar of Frost 0:13–0:25 + Breath of Sindragosa 0:14–0:31";
const targetLine =
  "    Target: Paladin-Realm-CN 100% → 61% | your damage 1.40M";
const overlap = (...items: string[]) =>
  `    Ally CDs overlapping: ${items.join("; ")}`;
const pi =
  "Priest-Realm-CN Power Infusion 8.9s (no damage by them on enemy players in it)";
const voidform =
  "Priest-Realm-CN Voidform 18.4s (their top target in it: Hunter-Realm-CN 0.73M)";

describe("checkBurstAllyOverlap", () => {
  it("passes the two forms an item takes, and a solo burst", () => {
    expect(
      checkBurstAllyOverlap([head, targetLine, overlap(pi, voidform)]),
    ).toEqual([]);
    expect(
      checkBurstAllyOverlap([
        head,
        targetLine,
        "    Solo burst — no ally offensive CD overlapped.",
      ]),
    ).toEqual([]);
  });

  it("**regression** 0e0663e6: the bare word is a failure", () => {
    const fails = checkBurstAllyOverlap([
      head,
      targetLine,
      "    Aligned with: Priest-Realm-CN (Power Infusion), Priest-Realm-CN (Voidform)",
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 3");
    expect(fails[0]).toContain("Aligned with");
  });

  it("fails on an item that states no overlap or no target reading", () => {
    expect(
      checkBurstAllyOverlap([
        head,
        overlap(pi, "Priest-Realm-CN (Voidform)"),
      ])[0],
    ).toContain("有无法解析的条目");
    expect(
      checkBurstAllyOverlap([
        head,
        overlap("Priest-Realm-CN Voidform 18.4s"),
      ])[0],
    ).toContain("有无法解析的条目");
  });

  it("fails when an overlap is longer than the burst it overlaps", () => {
    // the header prints 0:13–0:31: 18 displayed seconds, under 19 raw
    expect(
      checkBurstAllyOverlap([
        head,
        overlap(
          "Priest-Realm-CN Voidform 19.0s (their top target in it: Hunter-Realm-CN 0.73M)",
        ),
      ]),
    ).toEqual([]);
    const fails = checkBurstAllyOverlap([
      head,
      overlap(
        "Priest-Realm-CN Voidform 19.1s (their top target in it: Hunter-Realm-CN 0.73M)",
      ),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("重叠 19.1s 超过所在 burst 的显示长度 18s");
  });

  it("each burst is checked against its own header", () => {
    const fails = checkBurstAllyOverlap([
      head,
      overlap(voidform),
      "  Burst #2 — 1:40–1:46 | Pillar of Frost",
      overlap(voidform),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 4");
  });

  it("ignores the legend's mention of the label", () => {
    expect(
      checkBurstAllyOverlap([
        "  `Target` = … `Ally CDs overlapping` = a teammate's offensive cooldown was running during part of this burst — an overlap in time and nothing more: `Ns` = how long the two ran together",
      ]),
    ).toEqual([]);
  });
});
