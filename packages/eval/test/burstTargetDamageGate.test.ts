import { describe, expect, it } from "vitest";

import {
  checkBurstTargetDamageParts,
  checkVulnerableOwnerDamage,
} from "../src/quality/promptQualityCheck";

/**
 * T12 ⑤ (user ruling 2026-10-10): the burst ledger's `Target:` line prints
 * the absorbed part of `your damage` and the second enemy the burst damaged;
 * the healer view's `your damage on it` is measured on the window's target.
 */

const target = (tail: string, hp = " 100% → 94%") =>
  `    Target: Rohbell-Tichondrius-US${hp} | your damage ${tail}`;

describe("checkBurstTargetDamageParts", () => {
  it("passes every form the producer writes", () => {
    expect(
      checkBurstTargetDamageParts([
        target("0.52M"),
        target("0.52M", ""),
        target("0.52M", " 95% → 69% (low 39% at 0:38)"),
        target("0.70M (0.40M of it absorbed)"),
        target("0.70M | target DIED"),
        target(
          "0.70M (0.40M of it absorbed) | second target: Shalamayne-Sargeras-US 0.67M (0.03M of it absorbed)",
        ),
        target(
          "0.70M | target DIED | second target: Shalamayne-Sargeras-US 0.30M | also hit: Shalamayne-Sargeras-US DIED 0:11 (+1.3s)",
        ),
        target("0.70M | also hit: Shatters DIED 0:11 (+1.3s)"),
      ]),
    ).toEqual([]);
  });

  it("fails when the absorbed part is larger than the figure it is a part of", () => {
    const fails = checkBurstTargetDamageParts([
      target("0.30M (0.40M of it absorbed)"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("absorbed 0.40M 大于 your damage 0.30M");
  });

  it("fails when the second target took more than the target", () => {
    const fails = checkBurstTargetDamageParts([
      target("0.67M | second target: Shalamayne-Sargeras-US 0.70M"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "second target Shalamayne-Sargeras-US 0.70M 大于 Target 的 0.67M",
    );
  });

  it("fails when the second target is the target, or its absorbed part exceeds it", () => {
    expect(
      checkBurstTargetDamageParts([
        target("0.70M | second target: Rohbell-Tichondrius-US 0.30M"),
      ])[0],
    ).toContain("second target 与 Target 是同一单位");
    expect(
      checkBurstTargetDamageParts([
        target(
          "0.70M | second target: Shalamayne-Sargeras-US 0.30M (0.31M of it absorbed)",
        ),
      ])[0],
    ).toContain("absorbed 0.31M 大于它的 0.30M");
  });

  it("fails on a damage clause it cannot read", () => {
    expect(
      checkBurstTargetDamageParts([target("0.70M (0.30M landed)")])[0],
    ).toContain("伤害子句无法解析");
  });

  it("ignores lines that are not a ledger target line", () => {
    expect(
      checkBurstTargetDamageParts([
        "  `Target` = the enemy player your own damage in the burst was highest on, counting what its shields absorbed. `your damage` = that figure",
        "    Solo burst — no ally offensive CD overlapped.",
      ]),
    ).toEqual([]);
  });
});

describe("checkVulnerableOwnerDamage", () => {
  const vulnerable = (team: number, own: string) =>
    `  [VULNERABLE] 2:01–2:14 (13s) on Shadow Priest (Catfiend-Illidan-US): no major defensives, never punished (team damage ${team}k total); ready offensive CDs: Avatar; you cast no CC; ${own}; free 13s of 13s, team min HP 71%.`;

  it("passes when the owner's figure is a part of the team's on that target", () => {
    expect(
      checkVulnerableOwnerDamage([
        vulnerable(0, "your damage on it 0k"),
        vulnerable(8, "your damage on it 3k (+2k absorbed)"),
        vulnerable(8, "your damage on it 8k"),
      ]),
    ).toEqual([]);
  });

  it("fails when the owner's damage on the target exceeds the team's on it", () => {
    const fails = checkVulnerableOwnerDamage([
      vulnerable(0, "your damage on it 208k"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "your damage on it 208k 大于同一目标的 team damage 0k total",
    );
  });

  it("does not read the DPS view's line (no owner clause) or a kill-window line", () => {
    expect(
      checkVulnerableOwnerDamage([
        "  [VULNERABLE] 2:01–2:14 on Shadow Priest (Catfiend-Illidan-US): no major defensives, never punished (team damage 0k total); ready offensive CDs: Avatar.",
        "  [KILL WINDOW] 1:29–1:47 on Fury Warrior (Todory-MoonGuard-US): you cast no CC; your damage on it 480k; free 15s of 18s, team min HP 32%.",
      ]),
    ).toEqual([]);
  });
});
